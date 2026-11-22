"""ph-intercept - DNS game (Pi-hole, AdGuard Home, Technitium, and Blocky)."""

import asyncio
import json
import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.exceptions import HTTPException
from starlette.responses import HTMLResponse, JSONResponse, PlainTextResponse, StreamingResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles
from starlette.templating import Jinja2Templates

from core.config import (
    BG_MODE, BG_IMAGE, PROVIDER, READ_ONLY, RETURN_URL, SKY_PRESET, SKY_PRESETS,
    HIDE_CLIENT, HIDE_DOMAIN, SIDE1, SIDE2, RESOLVED, DASHBOARD_OVERRIDE,
    TWO_PLAYER_LOCAL_CONFIGURED, TWO_PLAYER_ENABLED, P2_DASHBOARD, P2_VERIFY_SSL,
)
from core import banner as _banner
from core import config as _config
from core import settings as _settings
from core.detect import identify
from core.multiplayer import get_status as mp_status, set_mode as mp_set_mode
from core.providers import Slot, p2_config_error, surface

logger = logging.getLogger("ph-intercept")
_COLOR = _banner.COLOR

# Dashboard link and TLS verification for the primary instance, per provider.
_P1_SETTINGS = {
    "pihole": ("PIHOLE_DASHBOARD", "PIHOLE_VERIFY_SSL"),
    "adguard": ("ADGUARD_DASHBOARD", "ADGUARD_VERIFY_SSL"),
    "technitium": ("TECHNITIUM_DASHBOARD", "TECHNITIUM_VERIFY_SSL"),
    "blocky": ("BLOCKY_DASHBOARD", "BLOCKY_VERIFY_SSL"),
}


def _p1_settings(provider: str) -> tuple[str, bool]:
    dash_name, ssl_name = _P1_SETTINGS.get(provider, _P1_SETTINGS["pihole"])
    return DASHBOARD_OVERRIDE[1] or getattr(_config, dash_name), getattr(_config, ssl_name)


# A legacy side has its provider at import and runs exactly as before 1.6. A
# BLOCKER_* side goes through a Slot, bound once startup has confirmed (or
# detected) which server answers.
if SIDE1.style == "legacy":
    _DASHBOARD, _VERIFY_SSL = _p1_settings(PROVIDER)
    _P1 = surface(PROVIDER, 1)
else:
    _DASHBOARD, _VERIFY_SSL = ("", _config.neutral_verify(1)) if not SIDE1.provider else _p1_settings(SIDE1.provider)
    _P1 = Slot(1)

# Module-level names, so route handlers (and tests) see one shape for every provider.
get_stats = _P1.get_stats
toggle_blocking = _P1.toggle_blocking
trigger_filter_update = _P1.trigger_filter_update
query_poller = _P1.query_poller
add_ws_client = _P1.add_ws_client
remove_ws_client = _P1.remove_ws_client
reset_watermark = _P1.reset_watermark
drop_session = _P1.drop_session

_P2_DASHBOARD = P2_DASHBOARD
_P2_VERIFY_SSL = P2_VERIFY_SSL
_P2_KNOWN = SIDE2.style == "legacy" and bool(SIDE2.provider)
if TWO_PLAYER_LOCAL_CONFIGURED:
    _P2 = surface(SIDE2.provider, 2) if _P2_KNOWN else Slot(2)
    get_p2_stats = _P2.get_stats
    toggle_p2_blocking = _P2.toggle_blocking
    trigger_p2_gravity_update = _P2.trigger_filter_update
    query_p2_poller = _P2.query_poller
    add_p2_ws_client = _P2.add_ws_client
    remove_p2_ws_client = _P2.remove_ws_client
    reset_p2_watermark = _P2.reset_watermark
    drop_p2_session = _P2.drop_session
else:
    _P2 = None

_http_client: httpx.AsyncClient | None = None
_http_client2: httpx.AsyncClient | None = None


def _side_provider(slot: int) -> str:
    target = _P1 if slot == 1 else _P2
    if isinstance(target, Slot):
        return target.provider or ""
    if slot == 1:
        return PROVIDER
    return SIDE2.provider or ""


def _secret_state(provider: str, slot: int, fld: str) -> str:
    name = _settings.legacy_name(provider, slot, fld)
    return "set" if RESOLVED.env.get(name, "") else "not set"


def _report_side(slot: int, status: str = "") -> None:
    side = SIDE1 if slot == 1 else SIDE2
    if slot == 2 and not TWO_PLAYER_LOCAL_CONFIGURED:
        logger.info(_banner.side(2, "not configured", color=_COLOR))
        return
    provider = _side_provider(slot)
    target = _P1 if slot == 1 else _P2
    if not provider:
        err = target.error if isinstance(target, Slot) else None
        logger.info(_banner.side(slot, f"not started: {err}" if err else "waiting for the ad-blocker", color=_COLOR))
        return
    style = (f"{_settings.neutral_prefix(slot)}_* settings" if side.style == "new"
             else f"{_settings.SPEC[provider]['prefix']}{'' if slot == 1 else '2'}_* settings")
    url = _settings.display_url(RESOLVED.env.get(_settings.legacy_name(provider, slot, "url"), "")) or "(default)"
    creds = [f"{fld} {_secret_state(provider, slot, fld)}"
             for fld in ("username", "password", "token") if fld in _settings.SPEC[provider]["fields"]]
    logger.info(_banner.side(slot, _settings.NAMES[provider], url, status, color=_COLOR))
    logger.info(_banner.detail(", ".join([style, *creds]), color=_COLOR))
    for note in side.notes:
        logger.info(_banner.detail(note, color=_COLOR))
    for name in _settings.unused_fields(side, RESOLVED.source):
        logger.info(_banner.detail(f"{name} isn't needed for {_settings.NAMES[provider]}, so it's ignored", color=_COLOR))


# Detection retries: quick at first, since on a first boot the ad-blocker is usually seconds from ready.
_FIRST_RETRY, _MAX_RETRY = 1.0, 15.0
# While still waiting: a reminder after 1 minute, then 2, 4, 8, ... and at most every 15 minutes.
_FIRST_REMINDER, _MAX_REMINDER_GAP = 60.0, 900.0
_monotonic = time.monotonic


async def _settle(slot: int, client: httpx.AsyncClient) -> None:
    """Confirm or detect a BLOCKER_* side's provider, then bind it. Strict: a
    config error or a server that matches no provider (or several) is reported
    and the side stays off; only an unreachable server is retried."""
    global _DASHBOARD, _VERIFY_SSL, _P2_DASHBOARD, _P2_VERIFY_SSL
    side = SIDE1 if slot == 1 else SIDE2
    target: Slot = _P1 if slot == 1 else _P2
    if side.error:
        target.fail(side.error)
        logger.error(_banner.problem(slot, f"not started: {side.error}", _COLOR))
        return
    delay, waiting_since, remind_at = _FIRST_RETRY, None, _FIRST_REMINDER
    status = ""
    while True:
        found, reason = await identify(client, side.root)
        if side.provider and (found in (None, side.provider)):
            status = "confirmed" if found else ""
            if found is None:
                logger.info(_banner.side(slot, f"could not confirm {_settings.NAMES[side.provider]} at "
                                               f"{_settings.display_url(side.root)} ({reason}); using it as configured",
                                         color=_COLOR))
            break
        if side.provider and found != side.provider:
            msg = (f"{_settings.neutral_prefix(slot)}_TYPE says {side.provider}, but "
                   f"{_settings.display_url(side.root)} answers like {_settings.NAMES[found]}")
            target.fail(msg)
            logger.error(_banner.problem(slot, f"not started: {msg}", _COLOR))
            return
        if found:
            side.provider = found
            status = "detected"
            break
        if reason == "certificate":
            msg = (f"{_settings.display_url(side.root)} has an HTTPS certificate this container doesn't trust. For a self-signed "
                   f"certificate, set {_settings.neutral_prefix(slot)}_VERIFY_SSL to false")
            target.fail(msg)
            logger.error(_banner.problem(slot, f"not started: {msg}", _COLOR))
            return
        if reason != "unreachable":
            msg = (f"could not tell which ad-blocker is at {_settings.display_url(side.root)}: {reason}. "
                   f"Check {_settings.neutral_prefix(slot)}_URL, or set {_settings.neutral_prefix(slot)}_TYPE")
            target.fail(msg)
            logger.error(_banner.problem(slot, f"not started: {msg}", _COLOR))
            return
        url = _settings.display_url(side.root)
        target.fail(f"waiting for the ad-blocker at {url}")
        if waiting_since is None:
            # Normal on a first boot: the ad-blocker's container is often still starting.
            waiting_since = _monotonic()
            logger.info(_banner.side(slot, f"waiting for {url} to answer", color=_COLOR))
        elif _monotonic() - waiting_since >= remind_at:
            logger.warning(_banner.problem(slot, f"still no answer from {url} after {_banner.elapsed(remind_at)}", _COLOR))
            remind_at += min(remind_at, _MAX_REMINDER_GAP)
        await asyncio.sleep(delay)
        delay = min(delay * 1.5, _MAX_RETRY)
    if waiting_since is not None and status:
        status = f"{status} after {_banner.elapsed(_monotonic() - waiting_since)}"
    err = _settings.credential_error(side, RESOLVED.env)
    if err:
        target.fail(err)
        logger.error(_banner.problem(slot, f"not started: {err}", _COLOR))
        return
    if slot == 1:
        _DASHBOARD, _VERIFY_SSL = _p1_settings(side.provider)
    else:
        _, _P2_DASHBOARD, _P2_VERIFY_SSL = _config.p2_settings(side.provider)
    target.bind(side.provider)
    if slot == 1 and isinstance(_P2, Slot) and SIDE2.style == "legacy":
        SIDE2.provider = side.provider
        _, _P2_DASHBOARD, _P2_VERIFY_SSL = _config.p2_settings(side.provider)
        _P2.bind(side.provider)
        _report_side(2)
    _report_side(slot, status)


async def _p2_validate(http_client) -> str | None:
    if isinstance(_P2, Slot) and not _P2.provider:
        return f"Player 2 isn't ready: {_P2.error or 'waiting for the ad-blocker'}"
    return await p2_config_error(_side_provider(2) or "pihole")(http_client)


_MAX_REPLY = 64 * 1024 * 1024   # far above any real reply (AdGuard's filter status with a huge rule list included)


class _CappedStream(httpx.AsyncByteStream):
    def __init__(self, stream):
        self._stream = stream

    async def __aiter__(self):
        total = 0
        async for chunk in self._stream:
            total += len(chunk)
            if total > _MAX_REPLY:
                raise httpx.ReadError(f"reply larger than {_MAX_REPLY // (1024 * 1024)} MB")
            yield chunk

    async def aclose(self) -> None:
        await self._stream.aclose()


class _CappedTransport(httpx.AsyncBaseTransport):
    """Wraps a transport so no reply is read past _MAX_REPLY bytes."""

    def __init__(self, inner: httpx.AsyncBaseTransport):
        self._inner = inner

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        response = await self._inner.handle_async_request(request)
        response.stream = _CappedStream(response.stream)
        return response

    async def aclose(self) -> None:
        await self._inner.aclose()


def _client(verify: bool) -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=1.5, headers={"User-Agent": "ph-intercept"}, verify=verify,
                             transport=_CappedTransport(httpx.AsyncHTTPTransport(verify=verify)))


@asynccontextmanager
async def lifespan(_app):
    global _http_client, _http_client2
    _http_client = _client(_VERIFY_SSL)
    tasks = [asyncio.create_task(query_poller(_http_client))]
    if TWO_PLAYER_LOCAL_CONFIGURED:
        _http_client2 = _client(_P2_VERIFY_SSL)
        tasks.append(asyncio.create_task(query_p2_poller(_http_client2)))
    for line in _banner.lines(_COLOR, _config.LOG_LEVEL):
        logger.info(line)
    for note in RESOLVED.notes:
        logger.warning(note)
    if isinstance(_P1, Slot):
        tasks.append(asyncio.create_task(_settle(1, _http_client)))
    else:
        _report_side(1)
    if isinstance(_P2, Slot) and SIDE2.style == "new":
        tasks.append(asyncio.create_task(_settle(2, _http_client2)))
    elif _P2 is not None and not isinstance(_P2, Slot):
        _report_side(2)
    elif _P2 is None:
        _report_side(2)
    yield
    for t in tasks:
        t.cancel()
    for t in tasks:
        try:
            await t
        except asyncio.CancelledError:
            pass
    try:
        async with asyncio.timeout(1.0):
            await drop_session(_http_client)
    except Exception:
        pass
    await _http_client.aclose()
    if _http_client2:
        try:
            async with asyncio.timeout(1.0):
                await drop_p2_session(_http_client2)
        except Exception:
            pass
        await _http_client2.aclose()


_base = Path(__file__).parent
templates = Jinja2Templates(directory=_base / "templates")

_CSP = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src * data: blob:; "
    "font-src 'self'; "
    "connect-src 'self'; "
    "frame-ancestors *"
)


_CROSS_SITE_FETCH = frozenset(["cross-site", "same-site"])


def _is_cross_site_write(request: Request) -> bool:
    if request.method != "POST":
        return False
    if request.headers.get("sec-fetch-site", "").strip().lower() in _CROSS_SITE_FETCH:
        return True
    if "origin" in request.headers:
        ctype = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        return ctype != "application/json"
    return False


_MAX_BODY = 64 * 1024


async def _json_body(request: Request) -> dict | None:
    raw = b""
    async for chunk in request.stream():
        raw += chunk
        if len(raw) > _MAX_BODY:
            raise HTTPException(413)
    try:
        body = json.loads(raw)
    except Exception:
        return None
    return body if isinstance(body, dict) else None


def _bad_body() -> JSONResponse:
    return JSONResponse({"error": "request body must be a JSON object"}, status_code=400)


def _too_big(request: Request) -> bool:
    try:
        return int(request.headers.get("content-length", "0")) > _MAX_BODY
    except ValueError:
        return True


class _OptionalStaticFiles(StaticFiles):
    """/bg is a folder the user may or may not mount: missing means 404, not 500."""

    async def check_config(self) -> None:
        if self.directory is not None and os.path.isdir(self.directory):
            await super().check_config()


class ResponseHeaderMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if _is_cross_site_write(request):
            response = JSONResponse({"error": "cross-site request refused"}, status_code=403)
        elif READ_ONLY and request.method == "POST":
            # Every POST route changes the ad-blocker or the 2-player mode.
            response = JSONResponse({"error": "read-only mode"}, status_code=403)
        elif _too_big(request):
            response = JSONResponse({"error": "request body too large"}, status_code=413)
        else:
            try:
                response = await call_next(request)
            except Exception:
                logger.exception("Unhandled error on %s %s", request.method, request.url.path)
                response = PlainTextResponse("Internal Server Error", status_code=500)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = _CSP
        if request.url.path.startswith("/static/"):
            if request.url.path.endswith(('.woff2', '.woff', '.ttf', '.otf')):
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            else:
                response.headers["Cache-Control"] = "public, max-age=3600"
        return response


async def _await_settled(target, seconds: float = 3.0) -> None:
    if isinstance(target, Slot) and not target.provider and not target.error:
        try:
            await asyncio.wait_for(target.bound.wait(), seconds)
        except TimeoutError:
            pass


async def index(request: Request) -> HTMLResponse:
    preset = SKY_PRESETS.get(SKY_PRESET, SKY_PRESETS["summer_triangle"])
    await _await_settled(_P1)
    await _await_settled(_P2)
    return templates.TemplateResponse(request, "index.html", {
        "bg_mode": BG_MODE,
        "provider": _side_provider(1),
        "p2_provider": _side_provider(2),
        "pihole_dashboard": _DASHBOARD,
        "p2_dashboard": _P2_DASHBOARD,
        "two_player_enabled": TWO_PLAYER_ENABLED,
        "read_only": READ_ONLY,
        "hide_client": HIDE_CLIENT,
        "hide_domain": HIDE_DOMAIN,
        "bg_config": {
            "bg_mode": BG_MODE,
            "bg_image": BG_IMAGE,
            "sky_ra": preset["ra"],
            "sky_dec": preset["dec"],
            "sky_preset": SKY_PRESET,
            "return_url": RETURN_URL,
        },
        # Full preset table so the client can switch sky presets in-app without a round trip.
        "sky_presets": SKY_PRESETS,
    })


def _with_provider(target, payload: dict) -> JSONResponse:
    # A BLOCKER_* side reports its provider, so a page loaded before detection can refresh.
    if isinstance(target, Slot) and target.provider:
        payload["provider"] = target.provider
    return JSONResponse(payload)


async def pihole_stats(_request: Request) -> JSONResponse:
    data = await get_stats(_http_client)
    if not data:
        return _with_provider(_P1, {})
    return _with_provider(_P1, {
        "percent":     data.get("percent"),
        "queries":     data.get("queries"),
        "blocked":     data.get("blocked"),
        "no_error":    data.get("no_error"),
        "gravity":     data.get("gravity"),
        "blocking":    data.get("blocking"),
        "block_timer": data.get("block_timer"),
    })


async def pihole_toggle(request: Request) -> JSONResponse:
    body = await _json_body(request)
    if body is None:
        return _bad_body()
    timer = body.get("timer")
    if timer is not None:
        try:
            timer = int(timer)
            if timer <= 0:
                timer = None
        except (TypeError, ValueError):
            timer = None
    return JSONResponse(await toggle_blocking(_http_client, bool(body.get("enable", True)), timer))


async def two_player_status(_request: Request) -> JSONResponse:
    return JSONResponse(mp_status(TWO_PLAYER_LOCAL_CONFIGURED))


async def _p2_config_error() -> str | None:
    """Validate the second-instance config and probe reachability for the active
    provider. Returns an error string, or None when the instance is usable."""
    return await _p2_validate(_http_client2)


async def two_player_set_mode(request: Request) -> JSONResponse:
    body = await _json_body(request)
    if body is None:
        return _bad_body()
    mode = body.get("mode", "")
    if mode == "local":
        err = await _p2_config_error()
        if err:
            return JSONResponse({"error": err}, status_code=400)
    try:
        return JSONResponse(mp_set_mode(mode, TWO_PLAYER_LOCAL_CONFIGURED))
    except ValueError as exc:
        return JSONResponse({"error": str(exc)}, status_code=400)


async def pihole2_stats(_request: Request) -> JSONResponse:
    if not TWO_PLAYER_LOCAL_CONFIGURED or not _http_client2:
        return JSONResponse({})
    data = await get_p2_stats(_http_client2)
    if not data:
        return _with_provider(_P2, {})
    return _with_provider(_P2, {
        "percent":     data.get("percent"),
        "queries":     data.get("queries"),
        "blocked":     data.get("blocked"),
        "no_error":    data.get("no_error"),
        "gravity":     data.get("gravity"),
        "blocking":    data.get("blocking"),
        "block_timer": data.get("block_timer"),
    })


_SSE_MAX = 100   # live-event connections per side; a tab holds one per side, and closed tabs are released
_SSE_OPEN = {1: set(), 2: set()}


def _event_stream(slot: int, add, remove, reset):
    if len(_SSE_OPEN[slot]) >= _SSE_MAX:
        return JSONResponse({"error": "too many live connections"}, status_code=503)

    async def generate():
        q: asyncio.Queue = asyncio.Queue(maxsize=60)
        _SSE_OPEN[slot].add(q)
        try:
            add(q)
            reset()
            yield ": ok\n\n"
            while True:
                payload = await q.get()
                if payload is None:
                    break
                yield f"data: {payload}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            remove(q)
            _SSE_OPEN[slot].discard(q)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


async def pihole2_events(request: Request) -> StreamingResponse:
    if not TWO_PLAYER_LOCAL_CONFIGURED:
        return StreamingResponse(iter([]), media_type="text/event-stream")
    return _event_stream(2, add_p2_ws_client, remove_p2_ws_client, reset_p2_watermark)


async def pihole_gravity_update(request: Request) -> JSONResponse:
    return JSONResponse(await trigger_filter_update(_http_client))


async def pihole2_toggle(request: Request) -> JSONResponse:
    if not TWO_PLAYER_LOCAL_CONFIGURED or not _http_client2:
        return JSONResponse({"error": "not configured"}, status_code=400)
    body = await _json_body(request)
    if body is None:
        return _bad_body()
    timer = body.get("timer")
    if timer is not None:
        try:
            timer = int(timer)
            if timer <= 0:
                timer = None
        except (TypeError, ValueError):
            timer = None
    return JSONResponse(await toggle_p2_blocking(_http_client2, bool(body.get("enable", True)), timer))


async def pihole2_gravity_update(_request: Request) -> JSONResponse:
    if not TWO_PLAYER_LOCAL_CONFIGURED or not _http_client2:
        return JSONResponse({"error": "not configured"}, status_code=400)
    return JSONResponse(await trigger_p2_gravity_update(_http_client2))


async def pihole_events(request: Request) -> StreamingResponse:
    return _event_stream(1, add_ws_client, remove_ws_client, reset_watermark)


app = Starlette(
    lifespan=lifespan,
    routes=[
        Route("/", index),
        Route("/api/pihole/stats", pihole_stats),
        Route("/api/pihole/toggle", pihole_toggle, methods=["POST"]),
        Route("/api/pihole/gravity-update", pihole_gravity_update, methods=["POST"]),
        Route("/api/2p/status", two_player_status),
        Route("/api/2p/mode", two_player_set_mode, methods=["POST"]),
        Route("/api/pihole/events", pihole_events),
        Route("/api/pihole2/stats", pihole2_stats),
        Route("/api/pihole2/toggle", pihole2_toggle, methods=["POST"]),
        Route("/api/pihole2/gravity-update", pihole2_gravity_update, methods=["POST"]),
        Route("/api/pihole2/events", pihole2_events),
        Mount("/static", StaticFiles(directory=_base / "static"), name="static"),
        Mount("/bg", _OptionalStaticFiles(directory=_base / "static" / "bg", check_dir=False), name="bg"),
    ],
)
app.add_middleware(ResponseHeaderMiddleware)
