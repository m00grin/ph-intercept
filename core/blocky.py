import asyncio
import csv
import json
import logging
import os
import re
import time

import httpx

from .config import (
    BLOCKY_BASE, BLOCKY_LOG_DIR, BLOCKY2_BASE, BLOCKY2_LOG_DIR,
    HIDE_CLIENT, P2_PLACEHOLDER, env_prefix, ignore_patterns,
)
from .notice import clear, warn_once
from .settings import display_url
from .redact import public_domain

logger = logging.getLogger(__name__)

# Blocky has no query-log API. With queryLog.type: csv it appends one
# tab-separated row per query to <target>/YYYY-MM-DD_ALL.log (no header), and
# we tail that file through a read-only mount. Columns used, from Blocky's
# querylog/file_writer.go: 1 client IP, 2 client names ("; "-joined),
# 5 question name (FQDN, trailing dot), 8 response type. Column 4 (the reason)
# is never read: it can hold the real domain even with Blocky's log.privacy on.
_COL_CLIENT_IP, _COL_CLIENT_NAMES, _COL_DOMAIN, _COL_TYPE = 1, 2, 5, 8
_MIN_COLS = _COL_TYPE + 1
_FILE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}_ALL\.log$")
# Blocky's own "blocked" count is BLOCKED plus REBIND (rebinding protection).
_BLOCKED_TYPES = frozenset(["BLOCKED", "REBIND"])
# What Blocky writes when a client field is hidden via queryLog.fields or unknown.
_NO_CLIENT = frozenset(["", "none", "0.0.0.0", "::"])
# Bytes read per poll at most. A bigger backlog is skipped to its newest part,
# which is all that would be shown anyway (see _MAX_EVENTS).
_MAX_READ = 256 * 1024
_MAX_EVENTS = 20
_RESCAN_SECS = 5.0
_STATS_TIMEOUT = 1.2


class _Instance:
    """Per-instance Blocky state: the API root, the mounted log directory, and
    the tail position in today's log file."""

    def __init__(self, label: str, env: str, base: str, log_dir: str, slot: int = 1):
        self.label = label
        self.env = env
        self.log_env = "BLOCKY" if slot == 1 else "BLOCKY2"
        self.ignore_domains, self.ignore_clients = ignore_patterns("blocky", slot)
        self.base = base
        self.log_dir = log_dir
        self.ws_clients: set = set()
        self.path: str | None = None
        self.offset = 0
        self.partial = b""
        self.warm = False
        self.from_empty = False  # connected while no log existed: the first file is all new
        self.last_scan = 0.0
        self.sizes: dict[str, int] = {}  # *_ALL.log sizes at the last scan


_p1 = _Instance("Blocky", env_prefix("BLOCKY", 1), BLOCKY_BASE, BLOCKY_LOG_DIR, slot=1)
_p2 = _Instance("Blocky 2", env_prefix("BLOCKY", 2), BLOCKY2_BASE, BLOCKY2_LOG_DIR, slot=2)
_E2 = _p2.env


# ── Query log tailing ────────────────────────────────────────────────────────

def _log_key(inst: _Instance) -> str:
    return f"{inst.label} query log"


def _scan_logs(inst: _Instance) -> dict[str, int] | None:
    """Sizes of every *_ALL.log in the log directory, warning about the usual
    mount and config mistakes when there is none."""
    try:
        entries = [e for e in os.scandir(inst.log_dir) if e.is_file()]
        names = [e.name for e in entries]
    except FileNotFoundError:
        warn_once(_log_key(inst), (
            f"{inst.label} query log: {inst.log_dir} not found. Mount Blocky's queryLog.target "
            f"directory there read-only, or set {inst.log_env}_LOG_DIR"
        ))
        return None
    except OSError as e:
        warn_once(_log_key(inst), f"{inst.label} query log: cannot read {inst.log_dir} ({e.strerror})")
        return None
    sizes = {}
    for e in entries:
        if _FILE_RE.match(e.name):
            try:
                sizes[e.path] = e.stat().st_size
            except OSError:
                pass
    if sizes:
        clear(_log_key(inst))
        return sizes
    if any(n.endswith(".log") for n in names):
        warn_once(_log_key(inst), (
            f"{inst.label} query log: only per-client files in {inst.log_dir}. "
            f"Set queryLog.type to csv (not csv-client) in Blocky's config"
        ))
    else:
        warn_once(_log_key(inst), (
            f"{inst.label} query log: no log files in {inst.log_dir} yet. "
            f"Check that Blocky has queryLog.type: csv and that its queryLog.target is mounted here"
        ))
    return None


def _read_from(path: str, offset: int) -> tuple[bytes, int, bool]:
    """Read new bytes after offset, at most _MAX_READ of the newest ones.
    Returns (data, new_offset, skipped) where skipped means older bytes were dropped."""
    with open(path, "rb") as f:
        size = os.fstat(f.fileno()).st_size
        if size < offset:  # truncated or replaced: start over
            offset = 0
        skipped = size - offset > _MAX_READ
        if skipped:
            offset = size - _MAX_READ
        f.seek(offset)
        data = f.read(size - offset)
    return data, offset + len(data), skipped


def _complete_lines(inst: _Instance, data: bytes, skipped: bool) -> list[bytes]:
    if skipped:
        inst.partial = b""
        cut = data.find(b"\n")
        data = data[cut + 1:] if cut >= 0 else b""
    buf = inst.partial + data
    end = buf.rfind(b"\n")
    if end < 0:
        inst.partial = buf
        return []
    inst.partial = buf[end + 1:]
    return buf[:end].split(b"\n")


def _likely_active(sizes: dict[str, int]) -> str:
    """Best first guess at the file Blocky is writing: the most recently modified,
    ignoring any stamped in the future (written while the clock was ahead).
    _pick_log corrects a wrong guess at the next scan."""
    now = time.time()
    recent = []
    for p in sizes:
        try:
            mtime = os.stat(p).st_mtime
        except OSError:
            continue
        if mtime <= now + 60:
            recent.append((mtime, p))
    return max(recent)[1] if recent else max(sizes)


def _pick_log(inst: _Instance, sizes: dict[str, int]) -> tuple[str, int] | None:
    """The file Blocky is writing now, and where to start reading it, when that
    is not the file being tailed. None means keep tailing the current one.

    Follows whichever file grew since the last scan rather than the newest
    date in the name: after a clock correction or a timezone change, Blocky can
    go back to writing a file whose name sorts before a stale one."""
    prev = inst.sizes
    grown = [p for p, s in sizes.items() if s > prev.get(p, 0)]
    others = [p for p in grown if p != inst.path]
    if inst.path in sizes and not others:
        return None
    if others:
        # Several grew (a rollover inside one scan): the latest-named is the new day.
        best = max(others)
        return best, prev.get(best, 0)
    # The tailed file is gone and nothing else grew: re-warm at the end of the newest.
    best = max(sizes)
    return best, sizes[best]


def _tail(inst: _Instance) -> list[bytes]:
    """New complete log lines since the last call, oldest first."""
    now = time.monotonic()
    sizes = None
    if inst.path is None or now - inst.last_scan >= _RESCAN_SECS:
        inst.last_scan = now
        sizes = _scan_logs(inst)
        if sizes is None:
            if not inst.warm:
                inst.from_empty = True
            inst.path, inst.sizes = None, {}
            return []

    if not inst.warm or inst.path is None:
        # First read after (re)connect: start at the end so a client is not
        # flooded with backlog.
        if sizes is None:
            sizes = _scan_logs(inst)
            if sizes is None:
                return []
        if inst.path not in sizes:
            inst.path = _likely_active(sizes)
        from_empty = inst.from_empty
        inst.offset = 0 if from_empty else sizes[inst.path]
        inst.partial, inst.warm, inst.from_empty = b"", True, False
        inst.sizes = sizes
        if not from_empty:
            return []

    lines: list[bytes] = []
    if sizes is not None:
        picked = _pick_log(inst, sizes)
        inst.sizes = sizes
        if picked is not None:
            # Switching files (day rollover or clock change): finish the old one first.
            if inst.path in sizes:
                try:
                    data, _, skipped = _read_from(inst.path, inst.offset)
                    lines += _complete_lines(inst, data, skipped)
                except OSError:
                    pass
            inst.path, inst.offset = picked
            inst.partial = b""
    try:
        data, inst.offset, skipped = _read_from(inst.path, inst.offset)
    except FileNotFoundError:
        inst.path = None  # deleted by retention or a restart; rescan next poll
        inst.last_scan = 0.0
        return lines
    except OSError as e:
        warn_once(_log_key(inst), f"{inst.label} query log: cannot read {inst.path} ({e.strerror})")
        return lines
    return lines + _complete_lines(inst, data, skipped)


def _row(line: bytes) -> list[str] | None:
    try:
        row = next(csv.reader([line.decode("utf-8", "replace")], delimiter="\t"))
    except (csv.Error, StopIteration):
        return None
    return row if len(row) >= _MIN_COLS else None


def _row_to_event(row: list[str], inst: _Instance | None = None) -> dict | None:
    inst = inst or _p1
    domain = row[_COL_DOMAIN].strip().rstrip(".") or "unknown"
    if inst.ignore_domains and any(p.search(domain) for p in inst.ignore_domains):
        return None
    ip = row[_COL_CLIENT_IP].strip()
    name = row[_COL_CLIENT_NAMES].split(";", 1)[0].strip()
    ip = "" if ip in _NO_CLIENT else ip
    name = "" if name in _NO_CLIENT else name
    if inst.ignore_clients and any(
        p.search(c) for p in inst.ignore_clients for c in (name, ip) if c
    ):
        return None
    rtype = row[_COL_TYPE].strip().upper()
    if rtype in _BLOCKED_TYPES:
        source = "blocked"
    elif rtype == "CACHED":
        source = "cache"
    else:
        source = "upstream"
    return {
        "domain": public_domain(domain),
        "status": "blocked" if source == "blocked" else "allowed",
        "source": source,
        "client": "" if HIDE_CLIENT else (name or ip),
    }


def _fetch_events(inst: _Instance) -> list[dict]:
    events: list[dict] = []
    # Newest first, stopping once the burst cap is reached, then back to oldest-first.
    for line in reversed(_tail(inst)):
        row = _row(line)
        if row is None:
            continue
        event = _row_to_event(row, inst)
        if event:
            events.append(event)
            if len(events) >= _MAX_EVENTS:
                break
    events.reverse()
    return events


# ── REST API (stats, blocking control, list refresh) ─────────────────────────

def _api_problem(inst: _Instance) -> None:
    warn_once(inst.label, (
        f"{inst.label}: could not reach {display_url(inst.base)}/api. Check {inst.env}_URL points at "
        f"Blocky's HTTP port (ports.http), not its DNS port"
    ))


async def _get_json(http_client: httpx.AsyncClient, inst: _Instance, path: str, timeout: float) -> tuple[int, dict | None]:
    resp = await http_client.get(f"{inst.base}/api/{path}", timeout=timeout)
    try:
        body = resp.json()
    except ValueError:
        body = None
    return resp.status_code, body if isinstance(body, dict) else None


async def _fetch_stats(http_client: httpx.AsyncClient, inst: _Instance) -> dict | None:
    if not inst.base:
        return None
    try:
        (st_code, status), (stats_code, stats) = await asyncio.gather(
            _get_json(http_client, inst, "blocking/status", _STATS_TIMEOUT),
            _get_json(http_client, inst, "stats", _STATS_TIMEOUT),
        )
    except Exception:
        logger.debug("Blocky stats failed", exc_info=True)
        _api_problem(inst)
        return None
    if st_code != 200 or status is None:
        _api_problem(inst)
        return None
    clear(inst.label)

    enabled = status.get("enabled")
    blocking = enabled if isinstance(enabled, bool) else None
    remaining = status.get("autoEnableInSec")
    block_timer = int(remaining) if blocking is False and isinstance(remaining, (int, float)) and remaining > 0 else None

    queries = blocked = gravity = None
    stats_key = f"{inst.label} stats"
    if stats_code == 200 and stats is not None:
        clear(stats_key)
        summary = stats.get("summary") or {}
        if isinstance(summary.get("queries"), int):
            queries = summary["queries"]
        if isinstance(summary.get("blocked"), int):
            blocked = summary["blocked"]
        deny = (stats.get("lists") or {}).get("denylist")
        if isinstance(deny, dict):
            gravity = sum(v for v in deny.values() if isinstance(v, int))
    elif stats_code == 503:
        warn_once(stats_key, (
            f"{inst.label}: query counts need statistics.enable: true in Blocky's config "
            f"(the HUD shows blocking state only until then)"
        ))

    percent = round(blocked / queries * 100, 1) if queries and blocked is not None else (0.0 if queries == 0 else None)
    return {
        "queries": queries,
        "blocked": blocked,
        "percent": percent,
        "gravity": gravity,
        "blocking": blocking,
        "block_timer": block_timer,
    }


async def _set_blocking(http_client: httpx.AsyncClient, inst: _Instance, enable: bool, timer: int | None) -> dict:
    if enable:
        path, params = "blocking/enable", None
    else:
        path, params = "blocking/disable", ({"duration": f"{int(timer)}s"} if timer and timer > 0 else None)
    try:
        resp = await http_client.get(f"{inst.base}/api/{path}", params=params, timeout=5.0)
    except Exception:
        logger.debug("Blocky blocking toggle failed", exc_info=True)
        _api_problem(inst)
        return {"error": "api request failed"}
    if resp.status_code != 200:
        return {"error": "api request failed"}
    if not enable and params:
        return {"blocking": False, "block_timer": int(timer)}
    return {"blocking": enable}


async def _refresh_lists(http_client: httpx.AsyncClient, inst: _Instance) -> dict:
    try:
        resp = await http_client.post(f"{inst.base}/api/lists/refresh", timeout=30.0)
    except Exception:
        logger.debug("Blocky list refresh failed", exc_info=True)
        return {"error": "api request failed"}
    return {"ok": True} if resp.status_code == 200 else {"error": "api request failed"}


# ── Broadcast / SSE plumbing ─────────────────────────────────────────────────

async def _broadcast(inst: _Instance, events: list[dict]) -> None:
    if not events or not inst.ws_clients:
        return
    payload = json.dumps(events)
    for q in list(inst.ws_clients):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            q.get_nowait()   # full: make room, so the close sentinel always lands
            q.put_nowait(None)
            inst.ws_clients.discard(q)


async def _run_poller(inst: _Instance) -> None:
    while True:
        await asyncio.sleep(0.5)
        if not inst.ws_clients:
            continue
        try:
            await _broadcast(inst, _fetch_events(inst))
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.debug("Blocky poller tick error", exc_info=True)


def _reset(inst: _Instance) -> None:
    inst.warm = False
    inst.from_empty = False
    inst.partial = b""


# ── Public surface (primary instance) ────────────────────────────────────────

async def get_stats(http_client: httpx.AsyncClient) -> dict | None:
    return await _fetch_stats(http_client, _p1)


async def toggle_blocking(http_client: httpx.AsyncClient, enable: bool, timer: int | None = None) -> dict:
    return await _set_blocking(http_client, _p1, enable, timer)


async def trigger_filter_update(http_client: httpx.AsyncClient) -> dict:
    return await _refresh_lists(http_client, _p1)


async def query_poller(_http_client: httpx.AsyncClient) -> None:
    await _run_poller(_p1)


def add_ws_client(q: asyncio.Queue) -> None:
    _p1.ws_clients.add(q)


def remove_ws_client(q: asyncio.Queue) -> None:
    _p1.ws_clients.discard(q)


async def drop_session(_http_client: httpx.AsyncClient) -> None:
    return None  # Blocky's API has no sessions


def reset_watermark() -> None:
    _reset(_p1)


# ── Public surface (second instance, 2-player local) ─────────────────────────

async def get_p2_stats(http_client: httpx.AsyncClient) -> dict | None:
    return await _fetch_stats(http_client, _p2)


async def toggle_p2_blocking(http_client: httpx.AsyncClient, enable: bool, timer: int | None = None) -> dict:
    return await _set_blocking(http_client, _p2, enable, timer)


async def trigger_p2_gravity_update(http_client: httpx.AsyncClient) -> dict:
    return await _refresh_lists(http_client, _p2)


async def query_p2_poller(_http_client: httpx.AsyncClient) -> None:
    await _run_poller(_p2)


def add_p2_ws_client(q: asyncio.Queue) -> None:
    _p2.ws_clients.add(q)


def remove_p2_ws_client(q: asyncio.Queue) -> None:
    _p2.ws_clients.discard(q)


async def drop_p2_session(_http_client: httpx.AsyncClient) -> None:
    return None


def reset_p2_watermark() -> None:
    _reset(_p2)


# ── Second-instance validation (2P config check) ─────────────────────────────

async def p2_config_error(http_client: httpx.AsyncClient | None) -> str | None:
    """Validate the second Blocky's config, API, and log mount. Returns an error
    string, or None when the instance is usable."""
    if not BLOCKY2_BASE:
        return f"{_E2}_URL is not set in your configuration"
    if P2_PLACEHOLDER in BLOCKY2_BASE:
        return f"{_E2}_URL still has the default placeholder value. Update it in your compose.yaml"
    if not (BLOCKY2_BASE.startswith("http://") or BLOCKY2_BASE.startswith("https://")):
        return f"{_E2}_URL must start with http:// or https://"
    if http_client:
        try:
            code, body = await _get_json(http_client, _p2, "blocking/status", 3.0)
        except Exception:
            code, body = 0, None
        if code != 200 or body is None:
            return f"Could not reach Blocky 2. Check {_E2}_URL points at its HTTP port (ports.http)"
    if not os.path.isdir(_p2.log_dir):
        return f"Blocky 2 query log not found at {_p2.log_dir}. Mount its queryLog.target there read-only"
    return None
