"""ph-intercept - DNS game (Pi-hole, AdGuard Home, and Technitium)."""

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, StreamingResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles
from starlette.templating import Jinja2Templates

from core.config import (
    BG_MODE, BG_IMAGE, PROVIDER, RETURN_URL, SKY_PRESET, SKY_PRESETS,
    TWO_PLAYER_LOCAL_CONFIGURED, TWO_PLAYER_ENABLED, P2_DASHBOARD, P2_VERIFY_SSL,
    PIHOLE2_URL, PIHOLE2_PASSWORD,
    ADGUARD2_BASE, ADGUARD2_USERNAME, ADGUARD2_PASSWORD,
    TECHNITIUM2_BASE, TECHNITIUM2_TOKEN, TECHNITIUM2_USER, TECHNITIUM2_PASSWORD,
)
from core.multiplayer import get_status as mp_status, set_mode as mp_set_mode

if PROVIDER == "adguard":
    from core.config import ADGUARD_DASHBOARD as _DASHBOARD, ADGUARD_VERIFY_SSL as _VERIFY_SSL
    from core.adguard import (
        add_ws_client, get_stats, query_poller, remove_ws_client,
        reset_watermark, toggle_blocking, trigger_filter_update, drop_session,
    )
elif PROVIDER == "technitium":
    from core.config import TECHNITIUM_DASHBOARD as _DASHBOARD, TECHNITIUM_VERIFY_SSL as _VERIFY_SSL
    from core.technitium import (
        add_ws_client, get_stats, query_poller, remove_ws_client,
        reset_watermark, toggle_blocking, trigger_filter_update, drop_session,
    )
else:
    from core.config import PIHOLE_DASHBOARD as _DASHBOARD, PIHOLE_VERIFY_SSL as _VERIFY_SSL
    from core.pihole import (
        add_ws_client, remove_ws_client, reset_watermark, toggle_blocking, drop_session, query_poller,
        get_pihole_stats as get_stats, trigger_gravity_update as trigger_filter_update,
    )

if TWO_PLAYER_LOCAL_CONFIGURED:
    # The second instance mirrors the primary provider.
    if PROVIDER == "adguard":
        from core.adguard import (
            add_p2_ws_client, remove_p2_ws_client, reset_p2_watermark,
            get_p2_stats, drop_p2_session, query_p2_poller,
            toggle_p2_blocking, trigger_p2_gravity_update,
        )
    elif PROVIDER == "technitium":
        from core.technitium import (
            add_p2_ws_client, remove_p2_ws_client, reset_p2_watermark,
            get_p2_stats, drop_p2_session, query_p2_poller,
            toggle_p2_blocking, trigger_p2_gravity_update,
            probe_p2 as technitium_probe_p2,
        )
    else:
        from core.pihole import (
            add_p2_ws_client, remove_p2_ws_client, reset_p2_watermark,
            get_p2_pihole_stats as get_p2_stats, drop_p2_session, query_p2_poller,
            toggle_p2_blocking, trigger_p2_gravity_update,
        )

_http_client: httpx.AsyncClient | None = None
_http_client2: httpx.AsyncClient | None = None


@asynccontextmanager
async def lifespan(_app):
    global _http_client, _http_client2
    _http_client = httpx.AsyncClient(timeout=1.5, headers={"User-Agent": "ph-intercept"}, verify=_VERIFY_SSL)
    tasks = [asyncio.create_task(query_poller(_http_client))]
    if TWO_PLAYER_LOCAL_CONFIGURED:
        _http_client2 = httpx.AsyncClient(timeout=1.5, headers={"User-Agent": "ph-intercept"}, verify=P2_VERIFY_SSL)
        tasks.append(asyncio.create_task(query_p2_poller(_http_client2)))
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


class ResponseHeaderMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = _CSP
        if request.url.path.startswith("/static/"):
            if request.url.path.endswith(('.woff2', '.woff', '.ttf', '.otf')):
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            else:
                response.headers["Cache-Control"] = "public, max-age=3600"
        return response


async def index(request: Request) -> HTMLResponse:
    preset = SKY_PRESETS.get(SKY_PRESET, SKY_PRESETS["summer_triangle"])
    return templates.TemplateResponse(request, "index.html", {
        "bg_mode": BG_MODE,
        "provider": PROVIDER,
        "pihole_dashboard": _DASHBOARD,
        "p2_dashboard": P2_DASHBOARD,
        "two_player_enabled": TWO_PLAYER_ENABLED,
        "bg_config": {
            "bg_mode": BG_MODE,
            "bg_image": BG_IMAGE,
            "sky_ra": preset["ra"],
            "sky_dec": preset["dec"],
            "return_url": RETURN_URL,
        },
    })


async def pihole_stats(_request: Request) -> JSONResponse:
    data = await get_stats(_http_client)
    if not data:
        return JSONResponse({})
    return JSONResponse({
        "percent":     data.get("percent"),
        "queries":     data.get("queries"),
        "blocked":     data.get("blocked"),
        "no_error":    data.get("no_error"),
        "gravity":     data.get("gravity"),
        "blocking":    data.get("blocking"),
        "block_timer": data.get("block_timer"),
    })


async def pihole_toggle(request: Request) -> JSONResponse:
    body = await request.json()
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


_P2_PLACEHOLDER = "CHANGE.ME"


async def _p2_config_error() -> str | None:
    """Validate the second-instance config and probe reachability for the active
    provider. Returns an error string, or None when the instance is usable."""
    if PROVIDER == "adguard":
        if not ADGUARD2_BASE:
            return "ADGUARD2_URL is not set in your configuration"
        if _P2_PLACEHOLDER in ADGUARD2_BASE:
            return "ADGUARD2_URL still has the default placeholder value. Update it in your compose.yaml"
        if not (ADGUARD2_BASE.startswith("http://") or ADGUARD2_BASE.startswith("https://")):
            return "ADGUARD2_URL must start with http:// or https://"
        if not ADGUARD2_PASSWORD:
            return "ADGUARD2_PASSWORD is not set in your configuration"
        if _http_client2:
            try:
                resp = await _http_client2.get(
                    f"{ADGUARD2_BASE}/status",
                    auth=(ADGUARD2_USERNAME, ADGUARD2_PASSWORD),
                )
                if resp.status_code == 401:
                    return "AdGuard 2 authentication failed. Check ADGUARD2_USERNAME and ADGUARD2_PASSWORD"
                if resp.status_code != 200:
                    return "Could not reach AdGuard 2. Check ADGUARD2_URL"
            except Exception:
                return "Could not reach AdGuard 2. Check ADGUARD2_URL"
        return None

    if PROVIDER == "technitium":
        if not TECHNITIUM2_BASE:
            return "TECHNITIUM2_URL is not set in your configuration"
        if _P2_PLACEHOLDER in TECHNITIUM2_BASE:
            return "TECHNITIUM2_URL still has the default placeholder value. Update it in your compose.yaml"
        if not (TECHNITIUM2_BASE.startswith("http://") or TECHNITIUM2_BASE.startswith("https://")):
            return "TECHNITIUM2_URL must start with http:// or https://"
        if not (TECHNITIUM2_TOKEN or (TECHNITIUM2_USER and TECHNITIUM2_PASSWORD)):
            return "Technitium 2 needs TECHNITIUM2_TOKEN, or TECHNITIUM2_USER and TECHNITIUM2_PASSWORD"
        if _http_client2:
            return await technitium_probe_p2(_http_client2)
        return None

    if not PIHOLE2_URL:
        return "PIHOLE2_URL is not set in your configuration"
    if _P2_PLACEHOLDER in PIHOLE2_URL:
        return "PIHOLE2_URL still has the default placeholder value. Update it in your compose.yaml"
    if not (PIHOLE2_URL.startswith("http://") or PIHOLE2_URL.startswith("https://")):
        return "PIHOLE2_URL must start with http:// or https://"
    if not PIHOLE2_PASSWORD:
        return "PIHOLE2_PASSWORD is not set in your configuration"
    if _http_client2:
        try:
            resp = await _http_client2.post(
                f"{PIHOLE2_URL}/auth",
                json={"password": PIHOLE2_PASSWORD},
            )
            if not resp.json().get("session", {}).get("valid"):
                return "Pi-hole 2 authentication failed. Check PIHOLE2_PASSWORD"
        except Exception:
            return "Could not reach Pi-hole 2. Check PIHOLE2_URL"
    return None


async def two_player_set_mode(request: Request) -> JSONResponse:
    body = await request.json()
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
        return JSONResponse({})
    return JSONResponse({
        "percent":     data.get("percent"),
        "queries":     data.get("queries"),
        "blocked":     data.get("blocked"),
        "no_error":    data.get("no_error"),
        "gravity":     data.get("gravity"),
        "blocking":    data.get("blocking"),
        "block_timer": data.get("block_timer"),
    })


async def pihole2_events(request: Request) -> StreamingResponse:
    if not TWO_PLAYER_LOCAL_CONFIGURED:
        return StreamingResponse(iter([]), media_type="text/event-stream")

    async def generate():
        q: asyncio.Queue = asyncio.Queue(maxsize=60)
        add_p2_ws_client(q)
        reset_p2_watermark()
        yield ": ok\n\n"
        try:
            while True:
                payload = await q.get()
                if payload is None:
                    break
                yield f"data: {payload}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            remove_p2_ws_client(q)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


async def pihole_gravity_update(request: Request) -> JSONResponse:
    return JSONResponse(await trigger_filter_update(_http_client))


async def pihole2_toggle(request: Request) -> JSONResponse:
    if not TWO_PLAYER_LOCAL_CONFIGURED or not _http_client2:
        return JSONResponse({"error": "not configured"}, status_code=400)
    body = await request.json()
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
    async def generate():
        q: asyncio.Queue = asyncio.Queue(maxsize=60)
        add_ws_client(q)
        reset_watermark()
        yield ": ok\n\n"
        try:
            while True:
                payload = await q.get()
                if payload is None:
                    break
                yield f"data: {payload}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            remove_ws_client(q)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


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
        Mount("/bg", StaticFiles(directory=_base / "static" / "bg", check_dir=False), name="bg"),
    ],
)
app.add_middleware(ResponseHeaderMiddleware)
