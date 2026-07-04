import asyncio
import json
import logging
import time
from collections import deque

import httpx

from .config import (
    TECHNITIUM_BASE, TECHNITIUM_TOKEN, TECHNITIUM_USER, TECHNITIUM_PASSWORD,
    TECHNITIUM_TOTP, TECHNITIUM_LOG_APP, TECHNITIUM_LOG_CLASS,
    TECHNITIUM2_BASE, TECHNITIUM2_TOKEN, TECHNITIUM2_USER, TECHNITIUM2_PASSWORD,
    TECHNITIUM2_TOTP, TECHNITIUM2_LOG_APP, TECHNITIUM2_LOG_CLASS,
    TECHNITIUM_IGNORE_DOMAIN_PATTERNS,
)

logger = logging.getLogger(__name__)

# Query log entries are returned newest-first with only second-granular
# timestamps, so there is no reliable monotonic watermark. Instead we dedup by a
# composite key and remember the last N keys seen. Matches how Pi-hole/AdGuard
# skip already-seen queries, just keyed differently.
_SEEN_LIMIT = 500
_STATS_TYPE = "LastDay"
_ENTRIES_PER_PAGE = 50


class _Instance:
    """Per-instance Technitium state. One for the primary instance, one for the
    second (2-player local) instance. Wrapping it here keeps the two from needing
    duplicated module globals, which matters because Technitium carries more
    per-instance state (session token, dedup set, re-enable task) than the other
    providers."""

    def __init__(self, base, token, user, password, totp, log_app, log_class):
        self.base = base
        self.static_token = token or None   # permanent API token, if configured
        self.user = user
        self.password = password
        self.totp = totp
        self.log_app = log_app
        self.log_class = log_class

        self.token = token or None          # active session token
        self.login_token = False            # True when token came from a login (droppable)
        self.auth_lock = asyncio.Lock()
        self.ws_clients: set = set()
        self.seen_keys: deque = deque()
        self.seen_set: set = set()
        self.warm = False                   # False until the log baseline is recorded
        self.reenable_task: asyncio.Task | None = None
        self.temp_disable_until: float | None = None  # monotonic deadline of a timed disable
        self.last_error: str | None = None


_p1 = _Instance(
    TECHNITIUM_BASE, TECHNITIUM_TOKEN, TECHNITIUM_USER, TECHNITIUM_PASSWORD,
    TECHNITIUM_TOTP, TECHNITIUM_LOG_APP, TECHNITIUM_LOG_CLASS,
)
_p2 = _Instance(
    TECHNITIUM2_BASE, TECHNITIUM2_TOKEN, TECHNITIUM2_USER, TECHNITIUM2_PASSWORD,
    TECHNITIUM2_TOTP, TECHNITIUM2_LOG_APP, TECHNITIUM2_LOG_CLASS,
)


# ── Auth ─────────────────────────────────────────────────────────────────────

async def _ensure_auth(http_client: httpx.AsyncClient, inst: _Instance) -> bool:
    if inst.token:
        return True
    if not inst.base:
        inst.last_error = "url_missing"
        return False
    if not (inst.user and inst.password):
        inst.last_error = "auth_required"
        return False
    async with inst.auth_lock:
        if inst.token:
            return True
        params = {"user": inst.user, "pass": inst.password, "includeInfo": "false"}
        if inst.totp:
            params["totp"] = inst.totp
        try:
            resp = await http_client.get(f"{inst.base}/api/user/login", params=params, timeout=5.0)
            data = resp.json()
        except Exception:
            inst.last_error = "auth_failed"
            logger.debug("Technitium login failed", exc_info=True)
            return False
        if data.get("status") == "ok" and data.get("token"):
            inst.token = str(data["token"])
            inst.login_token = True
            inst.last_error = None
            return True
        inst.last_error = str(data.get("status") or "auth_rejected")
        return False


async def _drop_session(http_client: httpx.AsyncClient, inst: _Instance) -> None:
    # Only session tokens from a login can (and should) be logged out; a permanent
    # configured token is left alone.
    if not (inst.token and inst.login_token):
        inst.token = inst.static_token
        inst.login_token = False
        return
    token = inst.token
    inst.token = inst.static_token
    inst.login_token = False
    try:
        await http_client.get(
            f"{inst.base}/api/user/logout",
            headers={"Authorization": f"Bearer {token}"},
            timeout=1.0,
        )
    except Exception:
        pass


async def _api_call(
    http_client: httpx.AsyncClient, inst: _Instance, path: str,
    params: dict | None = None, *, retry: bool = True, timeout: float = 3.0,
) -> dict | None:
    """Call an /api/ endpoint. Returns the parsed JSON envelope, or None on any
    failure. Re-authenticates once on an expired session token."""
    if not inst.base:
        inst.last_error = "url_missing"
        return None
    if not await _ensure_auth(http_client, inst):
        return None
    try:
        resp = await http_client.get(
            f"{inst.base}/api/{path.lstrip('/')}",
            params=params,
            headers={"Authorization": f"Bearer {inst.token}"},
            timeout=timeout,
        )
        data = resp.json()
    except Exception:
        inst.last_error = "unreachable"
        logger.debug("Technitium call failed: %s", path, exc_info=True)
        return None
    if data.get("status") == "invalid-token":
        inst.last_error = "invalid-token"
        if retry and inst.login_token:
            inst.token = None  # force a fresh login and retry once
            return await _api_call(http_client, inst, path, params, retry=False, timeout=timeout)
        return None
    if data.get("status") not in (None, "ok"):
        inst.last_error = str(data.get("status") or "error")
        return None
    inst.last_error = None
    return data


def _response(envelope: dict | None) -> dict:
    if not envelope:
        return {}
    body = envelope.get("response")
    return body if isinstance(body, dict) else {}


# ── Stats ────────────────────────────────────────────────────────────────────

async def _fetch_stats(http_client: httpx.AsyncClient, inst: _Instance) -> dict | None:
    try:
        stats_env = await _api_call(
            http_client, inst, "dashboard/stats/get",
            {"type": _STATS_TYPE, "utc": "true"}, timeout=5.0,
        )
        if stats_env is None:
            return None
        stats = _response(stats_env).get("stats") or {}
        queries = int(stats.get("totalQueries") or 0)
        blocked = int(stats.get("totalBlocked") or 0)
        gravity = int(stats.get("blockListZones") or 0) + int(stats.get("blockedZones") or 0)

        # A timed disable keeps enableBlocking=true server-side, so track it locally
        # to report the live countdown and a consistent off-state.
        remaining = _temp_disable_remaining(inst)
        if remaining is not None:
            blocking, block_timer = False, remaining
        else:
            settings = _response(await _api_call(http_client, inst, "settings/get", timeout=5.0))
            blocking = bool(settings.get("enableBlocking", True))
            block_timer = None

        return {
            "queries": queries,
            "blocked": blocked,
            "percent": round(blocked / queries * 100, 1) if queries else 0.0,
            "gravity": gravity,
            "blocking": blocking,
            "block_timer": block_timer,
        }
    except Exception:
        logger.exception("Technitium stats failed")
        return None


def _temp_disable_remaining(inst: _Instance) -> int | None:
    if inst.temp_disable_until is None:
        return None
    remaining = inst.temp_disable_until - time.monotonic()
    if remaining <= 0:
        inst.temp_disable_until = None
        return None
    return int(remaining)


# ── Blocking control ─────────────────────────────────────────────────────────

async def _set_blocking(http_client: httpx.AsyncClient, inst: _Instance, enable: bool, timer: int | None) -> dict:
    # Cancel any pending re-enable unless we are that task re-enabling ourselves.
    current = asyncio.current_task()
    if inst.reenable_task and inst.reenable_task is not current and not inst.reenable_task.done():
        inst.reenable_task.cancel()
    inst.reenable_task = None

    if not enable and timer and timer > 0:
        # Technitium disables in whole minutes; round up so we never fall short.
        minutes = max(1, (timer + 59) // 60)
        data = await _api_call(
            http_client, inst, "settings/temporaryDisableBlocking",
            {"minutes": str(minutes)}, timeout=5.0,
        )
        if data is None:
            return {"error": "api request failed"}
        inst.temp_disable_until = time.monotonic() + timer
        inst.reenable_task = asyncio.create_task(_reenable_after(http_client, inst, timer))
        return {"blocking": False, "block_timer": timer}

    data = await _api_call(
        http_client, inst, "settings/set",
        {"enableBlocking": "true" if enable else "false"}, timeout=5.0,
    )
    if data is None:
        return {"error": "api request failed"}
    inst.temp_disable_until = None
    return {"blocking": enable}


async def _reenable_after(http_client: httpx.AsyncClient, inst: _Instance, delay: int) -> None:
    await asyncio.sleep(delay)
    try:
        await _set_blocking(http_client, inst, True, None)
    except Exception:
        logger.debug("Technitium scheduled re-enable failed", exc_info=True)


async def _force_update(http_client: httpx.AsyncClient, inst: _Instance) -> dict:
    data = await _api_call(http_client, inst, "settings/forceUpdateBlockLists", timeout=10.0)
    return {"ok": True} if data is not None else {"error": "api request failed"}


# ── Query log -> events ──────────────────────────────────────────────────────

def _source_for(response_type: str) -> str:
    rt = (response_type or "").strip().lower()
    if "blocked" in rt or rt == "dropped":
        return "blocked"
    if rt == "cached":
        return "cache"
    return "upstream"  # Recursive, Authoritative, anything else


def _entry_key(entry: dict) -> str:
    fields = (
        entry.get("timestamp"), entry.get("clientIpAddress"), entry.get("protocol"),
        entry.get("responseType"), entry.get("rcode"), entry.get("qname"),
        entry.get("qtype"), entry.get("qclass"), entry.get("answer"),
    )
    return "|".join("" if v is None else str(v) for v in fields)


def _remember(inst: _Instance, key: str) -> bool:
    if key in inst.seen_set:
        return False
    while len(inst.seen_keys) >= _SEEN_LIMIT:
        inst.seen_set.discard(inst.seen_keys.popleft())
    inst.seen_keys.append(key)
    inst.seen_set.add(key)
    return True


def _entry_to_event(entry: dict) -> dict | None:
    domain = entry.get("qname") or "unknown"
    if TECHNITIUM_IGNORE_DOMAIN_PATTERNS and any(
        p.search(domain) for p in TECHNITIUM_IGNORE_DOMAIN_PATTERNS
    ):
        return None
    source = _source_for(str(entry.get("responseType") or ""))
    return {
        "domain": domain,
        "status": "blocked" if source == "blocked" else "allowed",
        "source": source,
        "client": entry.get("clientIpAddress") or "",
    }


async def _fetch_events(http_client: httpx.AsyncClient, inst: _Instance) -> list[dict]:
    data = await _api_call(
        http_client, inst, "logs/query",
        {
            "name": inst.log_app, "classPath": inst.log_class,
            "pageNumber": "1", "entriesPerPage": str(_ENTRIES_PER_PAGE),
            "descendingOrder": "true",
        },
        timeout=5.0,
    )
    if data is None:
        return []
    entries = _response(data).get("entries")
    if not isinstance(entries, list) or not entries:
        inst.warm = True
        return []

    # First poll after (re)connect: record the current window as the baseline and
    # emit nothing, so a client does not get flooded with backlog on connect.
    if not inst.warm:
        for entry in entries:
            _remember(inst, _entry_key(entry))
        inst.warm = True
        return []

    events: list[dict] = []
    for entry in reversed(entries):  # oldest-first so ships spawn in order
        if _remember(inst, _entry_key(entry)):
            event = _entry_to_event(entry)
            if event:
                events.append(event)
    return events[:20]


# ── Broadcast / SSE plumbing ─────────────────────────────────────────────────

async def _broadcast(inst: _Instance, events: list[dict]) -> None:
    if not events or not inst.ws_clients:
        return
    payload = json.dumps(events)
    for q in list(inst.ws_clients):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            try:
                q.put_nowait(None)  # sentinel so generate() can exit cleanly
            except asyncio.QueueFull:
                pass
            inst.ws_clients.discard(q)


async def _run_poller(http_client: httpx.AsyncClient, inst: _Instance) -> None:
    while True:
        await asyncio.sleep(0.5)
        if not inst.ws_clients:
            continue
        try:
            await _broadcast(inst, await _fetch_events(http_client, inst))
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.debug("Technitium poller tick error", exc_info=True)


def _reset(inst: _Instance) -> None:
    inst.warm = False
    inst.seen_keys.clear()
    inst.seen_set.clear()


# ── Public surface (primary instance) ────────────────────────────────────────

async def get_stats(http_client: httpx.AsyncClient) -> dict | None:
    return await _fetch_stats(http_client, _p1)


async def toggle_blocking(http_client: httpx.AsyncClient, enable: bool, timer: int | None = None) -> dict:
    return await _set_blocking(http_client, _p1, enable, timer)


async def trigger_filter_update(http_client: httpx.AsyncClient) -> dict:
    return await _force_update(http_client, _p1)


async def query_poller(http_client: httpx.AsyncClient) -> None:
    await _run_poller(http_client, _p1)


def add_ws_client(q: asyncio.Queue) -> None:
    _p1.ws_clients.add(q)


def remove_ws_client(q: asyncio.Queue) -> None:
    _p1.ws_clients.discard(q)


async def drop_session(http_client: httpx.AsyncClient) -> None:
    await _drop_session(http_client, _p1)


def reset_watermark() -> None:
    _reset(_p1)


# ── Public surface (second instance, 2-player local) ─────────────────────────

async def get_p2_stats(http_client: httpx.AsyncClient) -> dict | None:
    return await _fetch_stats(http_client, _p2)


async def toggle_p2_blocking(http_client: httpx.AsyncClient, enable: bool, timer: int | None = None) -> dict:
    return await _set_blocking(http_client, _p2, enable, timer)


async def trigger_p2_gravity_update(http_client: httpx.AsyncClient) -> dict:
    return await _force_update(http_client, _p2)


async def query_p2_poller(http_client: httpx.AsyncClient) -> None:
    await _run_poller(http_client, _p2)


def add_p2_ws_client(q: asyncio.Queue) -> None:
    _p2.ws_clients.add(q)


def remove_p2_ws_client(q: asyncio.Queue) -> None:
    _p2.ws_clients.discard(q)


async def drop_p2_session(http_client: httpx.AsyncClient) -> None:
    await _drop_session(http_client, _p2)


def reset_p2_watermark() -> None:
    _reset(_p2)


# ── Second-instance reachability probe (2P config validation) ────────────────

_AUTH_ERRORS = frozenset(
    ["url_missing", "auth_required", "auth_failed", "auth_rejected", "invalid-token", "unreachable"]
)


async def probe_p2(http_client: httpx.AsyncClient) -> str | None:
    """Validate that the second Technitium instance is reachable, authenticated,
    and exposes the query-log app. Returns a user-facing error string or None."""
    if not await _ensure_auth(http_client, _p2):
        return "Technitium 2 authentication failed. Check TECHNITIUM2_TOKEN or TECHNITIUM2_USER / TECHNITIUM2_PASSWORD"
    logs = await _api_call(
        http_client, _p2, "logs/query",
        {"name": _p2.log_app, "classPath": _p2.log_class, "pageNumber": "1", "entriesPerPage": "1"},
        timeout=5.0,
    )
    if logs is None:
        if _p2.last_error in _AUTH_ERRORS:
            return "Could not reach or authenticate with Technitium 2. Check TECHNITIUM2_URL and credentials"
        return ("Could not read the Technitium 2 query log. Install the 'Query Logs (Sqlite)' DNS app "
                "and check TECHNITIUM2_QUERY_LOG_APP / TECHNITIUM2_QUERY_LOG_CLASS")
    return None
