import asyncio
import json
import logging
import os

import httpx

from .config import PIHOLE_BASE, IGNORE_DOMAIN_PATTERNS

logger = logging.getLogger(__name__)

_pihole_sid: str | None = None
_pihole_auth_lock: asyncio.Lock = asyncio.Lock()
_pihole_ws_clients: set = set()
_pihole_last_q_time: float = 0.0

_BLOCKED_STATUS_STR = frozenset(["BLOCK", "GRAVITY", "REGEX", "DENYLIST", "SPECIAL", "EDE"])
_BLOCKED_STATUS_INT = frozenset([1, 4, 5, 6, 7, 8, 9, 10, 11, 15, 16, 18])
_CACHE_STATUS_INT   = frozenset([3, 17])
_CACHE_STATUS_STR   = frozenset(["CACHE"])


async def _pihole_ensure_auth(http_client: httpx.AsyncClient) -> bool:
    global _pihole_sid
    if _pihole_sid is not None:
        return True
    async with _pihole_auth_lock:
        if _pihole_sid is not None:
            return True
        try:
            resp = await http_client.post(
                f"{PIHOLE_BASE}/auth",
                content=json.dumps({"password": os.environ.get("PIHOLE_PASSWORD", "")}),
                headers={"Content-Type": "application/json"},
            )
            session = resp.json().get("session", {})
            if session.get("valid"):
                # sid is None when Pi-hole has no password (open/passwordless mode)
                _pihole_sid = session.get("sid") or ""
                return True
        except Exception:
            pass
        return False


async def _pihole_drop_session(http_client: httpx.AsyncClient) -> None:
    global _pihole_sid
    sid, _pihole_sid = _pihole_sid, None
    if not sid:
        return
    try:
        await http_client.delete(
            f"{PIHOLE_BASE}/auth",
            headers={"X-FTL-SID": sid},
            timeout=0.5,
        )
    except Exception:
        pass


async def get_pihole_stats(http_client: httpx.AsyncClient) -> dict | None:
    try:
        if not await _pihole_ensure_auth(http_client):
            return None
        headers = {"X-FTL-SID": _pihole_sid} if _pihole_sid else {}
        summary, blocking_resp = await asyncio.gather(
            http_client.get(f"{PIHOLE_BASE}/stats/summary", headers=headers),
            http_client.get(f"{PIHOLE_BASE}/dns/blocking", headers=headers),
        )
        if summary.status_code == 401:
            await _pihole_drop_session(http_client)
            return None
        data = summary.json()
        b = blocking_resp.json()
        q = data.get("queries", {})
        return {
            "queries": q.get("total", 0),
            "blocked": q.get("blocked", 0),
            "percent": round(q.get("percent_blocked", 0), 1),
            "gravity": data.get("gravity", {}).get("domains_being_blocked", 0),
            "blocking": None if b.get("error") else (b.get("blocking") == "enabled"),
            "block_timer": None if b.get("error") else b.get("timer"),
        }
    except Exception:
        return None


async def toggle_blocking(http_client: httpx.AsyncClient, enable: bool, timer: int | None = None) -> dict:
    try:
        if not await _pihole_ensure_auth(http_client):
            return {"error": "auth failed"}
        resp = await http_client.post(
            f"{PIHOLE_BASE}/dns/blocking",
            content=json.dumps({"blocking": enable, "timer": timer}),
            headers={**( {"X-FTL-SID": _pihole_sid} if _pihole_sid else {} ), "Content-Type": "application/json"},
        )
        if resp.status_code == 401:
            await _pihole_drop_session(http_client)
            return {"error": "session expired"}
        data = resp.json()
        return {"blocking": data["blocking"] == "enabled" if "blocking" in data else enable}
    except Exception:
        logger.exception("toggle_blocking failed")
        return {"error": "internal error"}


async def trigger_gravity_update(http_client: httpx.AsyncClient) -> dict:
    try:
        if not await _pihole_ensure_auth(http_client):
            return {"error": "auth failed"}
        resp = await http_client.post(
            f"{PIHOLE_BASE}/action/gravity",
            headers={"X-FTL-SID": _pihole_sid} if _pihole_sid else {},
            timeout=10.0,
        )
        if resp.status_code == 401:
            await _pihole_drop_session(http_client)
            return {"error": "session expired"}
        if resp.status_code not in (200, 202, 204):
            return {"error": f"status {resp.status_code}"}
        return {"ok": True}
    except httpx.TimeoutException:
        return {"error": "timeout"}
    except Exception:
        logger.exception("trigger_gravity_update failed")
        return {"error": "internal error"}


async def _broadcast(events: list[dict]) -> None:
    if not events or not _pihole_ws_clients:
        return
    payload = json.dumps(events)
    for q in list(_pihole_ws_clients):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            try:
                q.put_nowait(None)  # sentinel so generate() can exit cleanly
            except asyncio.QueueFull:
                pass
            _pihole_ws_clients.discard(q)


def add_ws_client(q: asyncio.Queue) -> None:
    _pihole_ws_clients.add(q)


def remove_ws_client(q: asyncio.Queue) -> None:
    _pihole_ws_clients.discard(q)


async def drop_session(http_client: httpx.AsyncClient) -> None:
    await _pihole_drop_session(http_client)


def reset_watermark() -> None:
    global _pihole_last_q_time
    _pihole_last_q_time = 0.0


async def query_poller(http_client: httpx.AsyncClient) -> None:
    global _pihole_last_q_time
    while True:
        await asyncio.sleep(0.5)
        if not _pihole_ws_clients:
            continue
        try:
            if not await _pihole_ensure_auth(http_client):
                continue

            resp = await http_client.get(
                f"{PIHOLE_BASE}/queries?limit=50",
                headers={"X-FTL-SID": _pihole_sid} if _pihole_sid else {},
                timeout=1.5,
            )
            if resp.status_code == 401:
                await _pihole_drop_session(http_client)
                continue
            if resp.status_code != 200:
                continue

            body = resp.json()
            queries = body.get("queries") or body.get("data") or []
            if not queries:
                continue

            if _pihole_last_q_time == 0.0:
                _pihole_last_q_time = max(q.get("time", 0) for q in queries)

            new_qs = [q for q in queries if q.get("time", 0) > _pihole_last_q_time]
            if not new_qs:
                continue

            _pihole_last_q_time = max(q.get("time", 0) for q in new_qs)

            events: list[dict] = []
            for q in new_qs[:20]:
                domain = q.get("domain") or q.get("name", "unknown")
                if IGNORE_DOMAIN_PATTERNS and any(p.search(domain) for p in IGNORE_DOMAIN_PATTERNS):
                    continue
                status_raw = q.get("status")
                if isinstance(status_raw, int):
                    is_blocked = status_raw in _BLOCKED_STATUS_INT
                else:
                    is_blocked = any(kw in str(status_raw).upper() for kw in _BLOCKED_STATUS_STR)
                client_raw = q.get("client", {})
                if isinstance(client_raw, dict):
                    client_label = client_raw.get("name") or client_raw.get("ip") or ""
                else:
                    client_label = str(client_raw) if client_raw else ""
                if not is_blocked:
                    if isinstance(status_raw, int):
                        is_cache = status_raw in _CACHE_STATUS_INT
                    else:
                        is_cache = any(kw in str(status_raw).upper() for kw in _CACHE_STATUS_STR)
                    source = "cache" if is_cache else "upstream"
                else:
                    source = "blocked"
                events.append({
                    "domain": domain,
                    "status": "blocked" if is_blocked else "allowed",
                    "source": source,
                    "client": client_label,
                })
            await _broadcast(events)

        except asyncio.CancelledError:
            raise
        except Exception:
            logger.debug("query_poller tick error", exc_info=True)
