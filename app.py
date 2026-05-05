"""ph-intercept — Pi-hole DNS game."""

import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.base import BaseHTTPMiddleware

from core.config import BG_MODE, BG_IMAGE, PIHOLE_DASHBOARD, RETURN_URL, SKY_PRESET, SKY_PRESETS
from core.pihole import (
    add_ws_client, get_pihole_stats, query_poller,
    remove_ws_client, reset_watermark, toggle_blocking, trigger_gravity_update,
    drop_session,
)

_http_client: httpx.AsyncClient | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global _http_client
    _http_client = httpx.AsyncClient(timeout=1.5, headers={"User-Agent": "ph-intercept"})
    poller = asyncio.create_task(query_poller(_http_client))
    yield
    poller.cancel()
    try:
        await poller
    except asyncio.CancelledError:
        pass
    try:
        async with asyncio.timeout(3.0):
            await drop_session(_http_client)
    except BaseException:
        pass
    await _http_client.aclose()


app = FastAPI(lifespan=lifespan)
_base = Path(__file__).parent
templates = Jinja2Templates(directory=_base / "templates")
app.mount("/static", StaticFiles(directory=_base / "static"), name="static")
app.mount("/bg", StaticFiles(directory=_base / "static" / "bg"), name="bg")


class CacheStaticMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/static/"):
            if request.url.path.endswith(('.woff2', '.woff', '.ttf', '.otf')):
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            else:
                response.headers["Cache-Control"] = "public, max-age=3600"
        return response


app.add_middleware(CacheStaticMiddleware)


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    preset = SKY_PRESETS.get(SKY_PRESET, SKY_PRESETS["summer_triangle"])
    return templates.TemplateResponse(request, "index.html", {
        "bg_mode": BG_MODE,
        "pihole_dashboard": PIHOLE_DASHBOARD,
        "bg_config": {
            "bg_mode":    BG_MODE,
            "bg_image":   BG_IMAGE,
            "sky_ra":     preset["ra"],
            "sky_dec":    preset["dec"],
            "sky_label":  preset["label"],
            "return_url": RETURN_URL,
        },
    })


@app.get("/api/pihole/stats")
async def pihole_stats():
    data = await get_pihole_stats(_http_client)
    if not data:
        return {}
    return {
        "percent":  data.get("percent"),
        "queries":  data.get("queries"),
        "blocked":  data.get("blocked"),
        "gravity":  data.get("gravity"),
        "blocking": data.get("blocking"),
    }


@app.post("/api/pihole/toggle")
async def pihole_toggle(request: Request):
    body = await request.json()
    return await toggle_blocking(_http_client, bool(body.get("enable", True)), body.get("timer"))


@app.post("/api/pihole/gravity-update")
async def pihole_gravity_update():
    return await trigger_gravity_update(_http_client)


@app.get("/api/pihole/events")
async def pihole_events():
    async def generate():
        q: asyncio.Queue = asyncio.Queue(maxsize=60)
        add_ws_client(q)
        reset_watermark()
        yield ": ok\n\n"
        try:
            while True:
                payload = await q.get()
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
