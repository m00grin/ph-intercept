import asyncio
import json
import logging
import os
from datetime import datetime

import httpx

from .config import ADGUARD_BASE, ADGUARD_IGNORE_DOMAIN_PATTERNS, ADGUARD2_BASE

logger = logging.getLogger(__name__)

_adguard_ws_clients: set = set()
_adguard_last_q_time: float = 0.0

# Second AdGuard instance (2-player local mode); mirrors the P1 state above.
_adguard2_ws_clients: set = set()
_adguard2_last_q_time: float = 0.0

_BLOCKED_REASONS = frozenset([
    "FilteredBlackList",
    "FilteredSafeBrowsing",
    "FilteredParental",
    "FilteredSafeSearch",
    "FilteredBlockedService",
])


def _auth() -> tuple[str, str]:
    return (
        os.environ.get("ADGUARD_USERNAME", ""),
        os.environ.get("ADGUARD_PASSWORD", ""),
    )


def _auth2() -> tuple[str, str]:
    return (
        os.environ.get("ADGUARD2_USERNAME", ""),
        os.environ.get("ADGUARD2_PASSWORD", ""),
    )


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


async def _fetch_stats(http_client: httpx.AsyncClient, base: str, auth: tuple[str, str]) -> dict | None:
    try:
        stats_resp, status_resp, filtering_resp = await asyncio.gather(
            http_client.get(f"{base}/stats", auth=auth),
            http_client.get(f"{base}/status", auth=auth),
            http_client.get(f"{base}/filtering/status", auth=auth),
        )
        if stats_resp.status_code == 401:
            return None
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
    return await _fetch_stats(http_client, ADGUARD_BASE, _auth())


async def get_p2_stats(http_client: httpx.AsyncClient) -> dict | None:
    return await _fetch_stats(http_client, ADGUARD2_BASE, _auth2())


_reenable_task: asyncio.Task | None = None
_reenable2_task: asyncio.Task | None = None


async def _reenable_after(http_client: httpx.AsyncClient, base: str, auth: tuple[str, str], delay: int) -> None:
    await asyncio.sleep(delay)
    try:
        await http_client.post(
            f"{base}/protection",
            content=json.dumps({"enabled": True, "duration_ms": 0}),
            headers={"Content-Type": "application/json"},
            auth=auth,
        )
    except Exception:
        logger.exception("scheduled re-enable failed")


async def _post_protection(http_client: httpx.AsyncClient, base: str, auth: tuple[str, str], enable: bool) -> dict:
    resp = await http_client.post(
        f"{base}/protection",
        content=json.dumps({"enabled": enable, "duration_ms": 0}),
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
        result = await _post_protection(http_client, ADGUARD_BASE, _auth(), enable)
        if "error" in result:
            return result
        if not enable and timer and timer > 0:
            _reenable_task = asyncio.create_task(_reenable_after(http_client, ADGUARD_BASE, _auth(), timer))
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
        result = await _post_protection(http_client, ADGUARD2_BASE, _auth2(), enable)
        if "error" in result:
            return result
        if not enable and timer and timer > 0:
            _reenable2_task = asyncio.create_task(_reenable_after(http_client, ADGUARD2_BASE, _auth2(), timer))
        return result
    except Exception:
        logger.exception("toggle_p2_blocking failed")
        return {"error": "internal error"}


async def _do_filter_update(http_client: httpx.AsyncClient, base: str, auth: tuple[str, str]) -> dict:
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
    return await _do_filter_update(http_client, ADGUARD_BASE, _auth())


async def trigger_p2_gravity_update(http_client: httpx.AsyncClient) -> dict:
    return await _do_filter_update(http_client, ADGUARD2_BASE, _auth2())


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
            try:
                q.put_nowait(None)
            except asyncio.QueueFull:
                pass
            clients.discard(q)


def add_ws_client(q: asyncio.Queue) -> None:
    _adguard_ws_clients.add(q)


def remove_ws_client(q: asyncio.Queue) -> None:
    _adguard_ws_clients.discard(q)


def add_p2_ws_client(q: asyncio.Queue) -> None:
    _adguard2_ws_clients.add(q)


def remove_p2_ws_client(q: asyncio.Queue) -> None:
    _adguard2_ws_clients.discard(q)


async def drop_session(_http_client: httpx.AsyncClient) -> None:
    pass  # Basic Auth is stateless; nothing to invalidate


async def drop_p2_session(_http_client: httpx.AsyncClient) -> None:
    pass  # Basic Auth is stateless; nothing to invalidate


def reset_watermark() -> None:
    global _adguard_last_q_time
    _adguard_last_q_time = 0.0


def reset_p2_watermark() -> None:
    global _adguard2_last_q_time
    _adguard2_last_q_time = 0.0


async def _poll_tick(
    http_client: httpx.AsyncClient, base: str, auth: tuple[str, str], last_q_time: float
) -> tuple[float, list[dict] | None]:
    """Run one query-log poll. Returns (new_watermark, events).

    events is None when there is nothing to broadcast (error, no data, first poll,
    or no newer queries); it may be an empty list when every new query was ignored.
    """
    resp = await http_client.get(f"{base}/querylog?limit=50", auth=auth, timeout=1.5)
    if resp.status_code == 401:
        logger.debug("query_poller: 401 from AdGuard; check credentials")
        return last_q_time, None
    if resp.status_code != 200:
        return last_q_time, None

    body = resp.json()
    queries = body.get("data") or []
    if not queries:
        return last_q_time, None

    timed_qs = [(q, _parse_time(q.get("time", ""))) for q in queries]

    if last_q_time == 0.0:
        return max(t for _, t in timed_qs), None

    new_timed_qs = [(q, t) for q, t in timed_qs if t > last_q_time]
    if not new_timed_qs:
        return last_q_time, None

    new_watermark = max(t for _, t in new_timed_qs)

    events: list[dict] = []
    for q, _ in new_timed_qs[:20]:
        domain = q.get("question", {}).get("name", "unknown")
        if ADGUARD_IGNORE_DOMAIN_PATTERNS and any(
            p.search(domain) for p in ADGUARD_IGNORE_DOMAIN_PATTERNS
        ):
            continue
        reason = q.get("reason", "")
        is_blocked = reason in _BLOCKED_REASONS
        is_cached = q.get("cached", False)
        client_label = q.get("client_info", {}).get("name") or q.get("client", "")
        if is_blocked:
            source = "blocked"
        elif is_cached:
            source = "cache"
        else:
            source = "upstream"
        events.append({
            "domain": domain,
            "status": "blocked" if is_blocked else "allowed",
            "source": source,
            "client": client_label,
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
                http_client, ADGUARD_BASE, _auth(), _adguard_last_q_time
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
                http_client, ADGUARD2_BASE, _auth2(), _adguard2_last_q_time
            )
            if events:
                await _broadcast(events, _adguard2_ws_clients)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.debug("query_p2_poller tick error", exc_info=True)
