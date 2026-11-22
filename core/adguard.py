import asyncio
import json
import logging
import time
from datetime import datetime

import httpx

from .config import (
    ADGUARD_BASE, ADGUARD_USERNAME, ADGUARD_PASSWORD, ADGUARD2_BASE,
    ADGUARD2_USERNAME, ADGUARD2_PASSWORD, HIDE_CLIENT, P2_PLACEHOLDER, env_prefix, ignore_patterns,
)
from .notice import clear, warn_once
from .settings import display_url
from .redact import public_domain

logger = logging.getLogger("ph-intercept")

_E1, _E2 = env_prefix("ADGUARD", 1), env_prefix("ADGUARD", 2)
_IGNORE = {1: ignore_patterns("adguard", 1), 2: ignore_patterns("adguard", 2)}

_adguard_ws_clients: set = set()
_adguard_last_q_time: float = 0.0

# Second AdGuard instance (2-player local mode); mirrors the P1 state above.
_adguard2_ws_clients: set = set()
_adguard2_last_q_time: float = 0.0

# Watermark meaning "connected while the query log was empty" (real times are Unix timestamps).
_EMPTY_LOG = 1e-9

_BLOCKED_REASONS = frozenset([
    "FilteredBlackList",
    "FilteredSafeBrowsing",
    "FilteredParental",
    "FilteredSafeSearch",
    "FilteredBlockedService",
])


def _auth() -> tuple[str, str]:
    return (ADGUARD_USERNAME, ADGUARD_PASSWORD)


def _auth2() -> tuple[str, str]:
    return (ADGUARD2_USERNAME, ADGUARD2_PASSWORD)


class _SessionAuth(httpx.Auth):
    """Log in once and reuse AdGuard's session cookie.

    AdGuard Home checks a Basic Auth password with bcrypt on every request, which
    pins the CPU on small devices at our poll rate. A session cookie is a cheap
    lookup. When login answers without a cookie (auth disabled, or a proxy in
    front that only speaks Basic Auth), Basic Auth is used for a minute.

    Every other login failure (wrong password, rate limit, server down) backs off,
    2 s doubling to 30 s (60 s after HTTP 429), and requests go out without a
    password meanwhile, so a bad setup can't turn every poll into a password check.
    """

    _FALLBACK_SECONDS = 60
    _BACKOFF_FIRST, _BACKOFF_MAX, _BACKOFF_RATE_LIMITED = 2.0, 30.0, 60.0

    def __init__(self, base: str, creds: tuple[str, str]):
        self.base = base
        self.creds = creds
        self.cookie: str | None = None
        self._basic_until = 0.0
        self._retry_at = 0.0
        self._delay = 0.0
        self._lock = asyncio.Lock()

    def _with_cookie(self, request: httpx.Request, cookie: str) -> httpx.Request:
        request.headers["Cookie"] = f"agh_session={cookie}"
        return request

    def _backoff(self, rate_limited: bool = False) -> None:
        self._delay = self._BACKOFF_FIRST if not self._delay else min(self._delay * 2, self._BACKOFF_MAX)
        if rate_limited:
            self._delay = max(self._delay, self._BACKOFF_RATE_LIMITED)
        self._retry_at = time.monotonic() + self._delay
        self._basic_until = 0.0

    def _without_credentials(self, request: httpx.Request) -> httpx.Request:
        request.headers.pop("Cookie", None)
        request.headers.pop("Authorization", None)
        return request

    async def async_auth_flow(self, request: httpx.Request):
        cookie = self.cookie
        if cookie:
            response = yield self._with_cookie(request, cookie)
            if response.status_code not in (401, 403):
                self._delay = 0.0
                return
            if self.cookie == cookie:
                self.cookie = None
        now = time.monotonic()
        if now < self._basic_until:
            self._check_basic(request, (yield self._basic(request)))
            return
        if now < self._retry_at:
            yield self._without_credentials(request)
            return
        async with self._lock:
            if not self.cookie and time.monotonic() >= self._retry_at and time.monotonic() >= self._basic_until:
                # Assume failure until proven otherwise, so a dropped connection backs off too.
                self._backoff()
                login = yield httpx.Request(
                    "POST", f"{self.base}/login",
                    json={"name": self.creds[0], "password": self.creds[1]},
                    headers={"User-Agent": request.headers.get("User-Agent", "ph-intercept")},
                )
                if login.status_code == 200:
                    # The back-off itself resets only once an authenticated request works.
                    self._retry_at = 0.0
                    self.cookie = login.cookies.get("agh_session")
                    if not self.cookie:
                        self._basic_until = time.monotonic() + self._FALLBACK_SECONDS
                elif login.status_code == 429:
                    self._backoff(rate_limited=True)
        if self.cookie:
            yield self._with_cookie(request, self.cookie)
        elif time.monotonic() < self._basic_until:
            self._check_basic(request, (yield self._basic(request)))
        else:
            yield self._without_credentials(request)

    def _basic(self, request: httpx.Request) -> httpx.Request:
        request.headers.pop("Cookie", None)
        return next(httpx.BasicAuth(*self.creds).auth_flow(request))

    def _check_basic(self, request: httpx.Request, response: httpx.Response) -> None:
        # Rejected, or not AdGuard answering: stop sending the password with every request.
        json_reply = "json" in response.headers.get("content-type", "")
        if response.status_code in (401, 403) or (request.method == "GET" and not json_reply):
            self._backoff()
        elif response.status_code < 400:
            self._delay = 0.0


_sessions: dict[tuple[str, tuple[str, str]], _SessionAuth] = {}


def _session(base: str, creds: tuple[str, str]) -> _SessionAuth:
    s = _sessions.get((base, creds))
    if s is None:
        s = _sessions[(base, creds)] = _SessionAuth(base, creds)
    return s


def _p1_auth() -> _SessionAuth:
    return _session(ADGUARD_BASE, _auth())


def _p2_auth() -> _SessionAuth:
    return _session(ADGUARD2_BASE, _auth2())


def _label(base: str) -> str:
    return "AdGuard 2" if base == ADGUARD2_BASE and base != ADGUARD_BASE else "AdGuard"


def _env(base: str) -> str:
    return _E2 if _label(base) == "AdGuard 2" else _E1


def _report(key: str, base: str, resp: httpx.Response | None) -> bool:
    if resp is None:
        warn_once(key, f"{key}: could not reach {display_url(base)}. Check {_env(base)}_URL")
        return False
    if resp.status_code in (401, 403):
        warn_once(key, f"{key}: login rejected (HTTP {resp.status_code}). Check {_env(base)}_USERNAME and {_env(base)}_PASSWORD")
        return False
    if resp.status_code != 200:
        where = ("the address of your AdGuard Home web interface" if _env(base).startswith("BLOCKER")
                 else "the control API (ends in /control)")
        warn_once(key, f"{key}: unexpected HTTP {resp.status_code} from {display_url(base)}. Check {_env(base)}_URL points at {where}")
        return False
    clear(key)
    return True


def _parse_time(s: str) -> float:
    """Convert AdGuard's ISO 8601 timestamp (with nanoseconds) to a Unix float."""
    try:
        s = s.rstrip("Z")
        if "." in s:
            base, frac = s.split(".", 1)
            s = f"{base}.{frac[:6]}+00:00"
        else:
            s = s + "+00:00"
        return datetime.fromisoformat(s).timestamp()
    except Exception:
        return 0.0


async def _fetch_stats(http_client: httpx.AsyncClient, base: str, auth: httpx.Auth) -> dict | None:
    try:
        try:
            stats_resp, status_resp, filtering_resp = await asyncio.gather(
                http_client.get(f"{base}/stats", auth=auth),
                http_client.get(f"{base}/status", auth=auth),
                http_client.get(f"{base}/filtering/status", auth=auth),
            )
        except httpx.TransportError:
            _report(_label(base), base, None)
            return None
        if stats_resp.status_code == 401:
            _report(_label(base), base, stats_resp)
            return None
        _report(_label(base), base, stats_resp)
        stats = stats_resp.json()
        status = status_resp.json()
        filtering = filtering_resp.json()

        queries = stats.get("num_dns_queries", 0)
        blocked = (
            stats.get("num_blocked_filtering", 0)
            + stats.get("num_replaced_safebrowsing", 0)
            + stats.get("num_replaced_parental", 0)
            + stats.get("num_replaced_safesearch", 0)
        )
        percent = round(blocked / queries * 100, 1) if queries > 0 else 0.0
        gravity = sum(f.get("rules_count", 0) for f in filtering.get("filters", []))
        protection_enabled = status.get("protection_enabled", True)
        duration_ms = status.get("protection_disabled_duration", 0) if not protection_enabled else 0
        block_timer = (duration_ms // 1000) if duration_ms and duration_ms > 0 else None

        return {
            "queries": queries,
            "blocked": blocked,
            "percent": percent,
            "gravity": gravity,
            "blocking": protection_enabled,
            "block_timer": block_timer,
        }
    except Exception:
        return None


async def get_stats(http_client: httpx.AsyncClient) -> dict | None:
    return await _fetch_stats(http_client, ADGUARD_BASE, _p1_auth())


async def get_p2_stats(http_client: httpx.AsyncClient) -> dict | None:
    return await _fetch_stats(http_client, ADGUARD2_BASE, _p2_auth())


_reenable_task: asyncio.Task | None = None
_reenable2_task: asyncio.Task | None = None


async def _reenable_after(http_client: httpx.AsyncClient, base: str, auth: httpx.Auth, delay: int) -> None:
    await asyncio.sleep(delay)
    try:
        await http_client.post(
            f"{base}/protection",
            content=json.dumps({"enabled": True, "duration": 0}),
            headers={"Content-Type": "application/json"},
            auth=auth,
        )
    except Exception:
        logger.exception("scheduled re-enable failed")


async def _post_protection(
    http_client: httpx.AsyncClient, base: str, auth: httpx.Auth, enable: bool, timer: int | None = None,
) -> dict:
    duration = timer * 1000 if not enable and timer and timer > 0 else 0
    resp = await http_client.post(
        f"{base}/protection",
        content=json.dumps({"enabled": enable, "duration": duration}),
        headers={"Content-Type": "application/json"},
        auth=auth,
    )
    if resp.status_code == 401:
        return {"error": "auth failed"}
    if resp.status_code not in (200, 204):
        return {"error": f"status {resp.status_code}"}
    return {"blocking": enable}


async def toggle_blocking(http_client: httpx.AsyncClient, enable: bool, timer: int | None = None) -> dict:
    global _reenable_task
    if _reenable_task and not _reenable_task.done():
        _reenable_task.cancel()
    _reenable_task = None
    try:
        result = await _post_protection(http_client, ADGUARD_BASE, _p1_auth(), enable, timer)
        if "error" in result:
            return result
        if not enable and timer and timer > 0:
            _reenable_task = asyncio.create_task(_reenable_after(http_client, ADGUARD_BASE, _p1_auth(), timer))
        return result
    except Exception:
        logger.exception("toggle_blocking failed")
        return {"error": "internal error"}


async def toggle_p2_blocking(http_client: httpx.AsyncClient, enable: bool, timer: int | None = None) -> dict:
    global _reenable2_task
    if _reenable2_task and not _reenable2_task.done():
        _reenable2_task.cancel()
    _reenable2_task = None
    try:
        result = await _post_protection(http_client, ADGUARD2_BASE, _p2_auth(), enable, timer)
        if "error" in result:
            return result
        if not enable and timer and timer > 0:
            _reenable2_task = asyncio.create_task(_reenable_after(http_client, ADGUARD2_BASE, _p2_auth(), timer))
        return result
    except Exception:
        logger.exception("toggle_p2_blocking failed")
        return {"error": "internal error"}


async def _do_filter_update(http_client: httpx.AsyncClient, base: str, auth: httpx.Auth) -> dict:
    try:
        resp = await http_client.post(
            f"{base}/filtering/refresh",
            content=json.dumps({"whitelist": False}),
            headers={"Content-Type": "application/json"},
            auth=auth,
            timeout=10.0,
        )
        if resp.status_code == 401:
            return {"error": "auth failed"}
        if resp.status_code not in (200, 204):
            return {"error": f"status {resp.status_code}"}
        return {"ok": True}
    except httpx.TimeoutException:
        return {"error": "timeout"}
    except Exception:
        logger.exception("trigger_filter_update failed")
        return {"error": "internal error"}


async def trigger_filter_update(http_client: httpx.AsyncClient) -> dict:
    return await _do_filter_update(http_client, ADGUARD_BASE, _p1_auth())


async def trigger_p2_gravity_update(http_client: httpx.AsyncClient) -> dict:
    return await _do_filter_update(http_client, ADGUARD2_BASE, _p2_auth())


async def _broadcast(events: list[dict], clients: set | None = None) -> None:
    if clients is None:
        clients = _adguard_ws_clients
    if not events or not clients:
        return
    payload = json.dumps(events)
    for q in list(clients):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            q.get_nowait()   # full: make room, so the close sentinel always lands
            q.put_nowait(None)
            clients.discard(q)


def add_ws_client(q: asyncio.Queue) -> None:
    _adguard_ws_clients.add(q)


def remove_ws_client(q: asyncio.Queue) -> None:
    _adguard_ws_clients.discard(q)


def add_p2_ws_client(q: asyncio.Queue) -> None:
    _adguard2_ws_clients.add(q)


def remove_p2_ws_client(q: asyncio.Queue) -> None:
    _adguard2_ws_clients.discard(q)


async def _logout(http_client: httpx.AsyncClient, base: str, creds: tuple[str, str]) -> None:
    s = _sessions.get((base, creds))
    if not s or not s.cookie:
        return
    cookie, s.cookie = s.cookie, None
    try:
        await http_client.get(f"{base}/logout", headers={"Cookie": f"agh_session={cookie}"}, timeout=1.5)
    except Exception:
        pass


async def drop_session(http_client: httpx.AsyncClient) -> None:
    await _logout(http_client, ADGUARD_BASE, _auth())


async def drop_p2_session(http_client: httpx.AsyncClient) -> None:
    await _logout(http_client, ADGUARD2_BASE, _auth2())


def reset_watermark() -> None:
    global _adguard_last_q_time
    _adguard_last_q_time = 0.0


def reset_p2_watermark() -> None:
    global _adguard2_last_q_time
    _adguard2_last_q_time = 0.0


async def _poll_tick(
    http_client: httpx.AsyncClient, base: str, auth: httpx.Auth, last_q_time: float
) -> tuple[float, list[dict] | None]:
    """Run one query-log poll. Returns (new_watermark, events).

    events is None when there is nothing to broadcast (error, no data, first poll,
    or no newer queries); it may be an empty list when every new query was ignored.
    """
    key = f"{_label(base)} query log"
    try:
        resp = await http_client.get(f"{base}/querylog?limit=50", auth=auth, timeout=1.5)
    except httpx.TransportError:
        _report(key, base, None)
        raise
    if resp.status_code == 401:
        logger.debug("query_poller: 401 from AdGuard; check credentials")
        _report(key, base, resp)
        return last_q_time, None
    if not _report(key, base, resp):
        return last_q_time, None

    body = resp.json()
    queries = body.get("data") or []
    if not queries:
        # Empty log at connect: everything logged from now on is new.
        return (_EMPTY_LOG if last_q_time == 0.0 else last_q_time), None

    timed_qs = [(q, _parse_time(q.get("time", ""))) for q in queries]

    if last_q_time == 0.0:
        return max(t for _, t in timed_qs), None

    new_timed_qs = [(q, t) for q, t in timed_qs if t > last_q_time]
    if not new_timed_qs:
        return last_q_time, None

    new_watermark = max(t for _, t in new_timed_qs)

    ignore_domains, ignore_clients = _IGNORE[2 if _label(base) == "AdGuard 2" else 1]
    events: list[dict] = []
    for q, _ in new_timed_qs[:20]:
        domain = q.get("question", {}).get("name", "unknown")
        if ignore_domains and any(p.search(domain) for p in ignore_domains):
            continue
        reason = q.get("reason", "")
        is_blocked = reason in _BLOCKED_REASONS
        is_cached = q.get("cached", False)
        client_name = q.get("client_info", {}).get("name") or ""
        client_ip = q.get("client", "")
        if ignore_clients and any(
            p.search(c) for p in ignore_clients for c in (client_name, client_ip) if c
        ):
            continue
        client_label = client_name or client_ip
        if is_blocked:
            source = "blocked"
        elif is_cached:
            source = "cache"
        else:
            source = "upstream"
        events.append({
            "domain": public_domain(domain),
            "status": "blocked" if is_blocked else "allowed",
            "source": source,
            "client": "" if HIDE_CLIENT else client_label,
        })
    return new_watermark, events


async def query_poller(http_client: httpx.AsyncClient) -> None:
    global _adguard_last_q_time
    while True:
        await asyncio.sleep(0.5)
        if not _adguard_ws_clients:
            continue
        try:
            _adguard_last_q_time, events = await _poll_tick(
                http_client, ADGUARD_BASE, _p1_auth(), _adguard_last_q_time
            )
            if events:
                await _broadcast(events, _adguard_ws_clients)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.debug("query_poller tick error", exc_info=True)


async def query_p2_poller(http_client: httpx.AsyncClient) -> None:
    global _adguard2_last_q_time
    while True:
        await asyncio.sleep(0.5)
        if not _adguard2_ws_clients:
            continue
        try:
            _adguard2_last_q_time, events = await _poll_tick(
                http_client, ADGUARD2_BASE, _p2_auth(), _adguard2_last_q_time
            )
            if events:
                await _broadcast(events, _adguard2_ws_clients)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.debug("query_p2_poller tick error", exc_info=True)


async def p2_config_error(http_client: httpx.AsyncClient | None) -> str | None:
    """Validate the second AdGuard's config and probe it. Returns an error string,
    or None when the instance is usable."""
    if not ADGUARD2_BASE:
        return f"{_E2}_URL is not set in your configuration"
    if P2_PLACEHOLDER in ADGUARD2_BASE:
        return f"{_E2}_URL still has the default placeholder value. Update it in your compose.yaml"
    if not (ADGUARD2_BASE.startswith("http://") or ADGUARD2_BASE.startswith("https://")):
        return f"{_E2}_URL must start with http:// or https://"
    if not ADGUARD2_PASSWORD:
        return f"{_E2}_PASSWORD is not set in your configuration"
    if http_client:
        try:
            resp = await http_client.get(
                f"{ADGUARD2_BASE}/status",
                auth=(ADGUARD2_USERNAME, ADGUARD2_PASSWORD),
                timeout=10.0,
            )
            if resp.status_code == 401:
                return f"AdGuard 2 authentication failed. Check {_E2}_USERNAME and {_E2}_PASSWORD"
            if resp.status_code != 200:
                return f"Could not reach AdGuard 2. Check {_E2}_URL"
        except Exception:
            return f"Could not reach AdGuard 2. Check {_E2}_URL"
    return None
