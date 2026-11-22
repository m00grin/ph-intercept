"""One uniform surface per DNS-server instance, whatever the provider.

Each provider module (core.pihole, core.adguard, ...) exposes the same set of
operations under slightly different historical names. This maps them to one
shape, per instance, so app.py never branches on the provider. Instance 2 takes
its own provider argument, so the two sides can run different providers.
"""

import asyncio
import importlib
from dataclasses import dataclass
from typing import Any, Callable

PROVIDERS = ("pihole", "adguard", "technitium", "blocky")

_P1_NAMES = {
    "get_stats": "get_stats",
    "toggle_blocking": "toggle_blocking",
    "trigger_filter_update": "trigger_filter_update",
    "query_poller": "query_poller",
    "add_ws_client": "add_ws_client",
    "remove_ws_client": "remove_ws_client",
    "reset_watermark": "reset_watermark",
    "drop_session": "drop_session",
}

_P2_NAMES = {
    "get_stats": "get_p2_stats",
    "toggle_blocking": "toggle_p2_blocking",
    "trigger_filter_update": "trigger_p2_gravity_update",
    "query_poller": "query_p2_poller",
    "add_ws_client": "add_p2_ws_client",
    "remove_ws_client": "remove_p2_ws_client",
    "reset_watermark": "reset_p2_watermark",
    "drop_session": "drop_p2_session",
}

# Pi-hole predates the shared names and keeps its own.
_OVERRIDES = {
    ("pihole", 1): {"get_stats": "get_pihole_stats", "trigger_filter_update": "trigger_gravity_update"},
    ("pihole", 2): {"get_stats": "get_p2_pihole_stats"},
}


@dataclass(frozen=True)
class Surface:
    provider: str
    get_stats: Callable[..., Any]
    toggle_blocking: Callable[..., Any]
    trigger_filter_update: Callable[..., Any]
    query_poller: Callable[..., Any]
    add_ws_client: Callable[..., Any]
    remove_ws_client: Callable[..., Any]
    reset_watermark: Callable[..., Any]
    drop_session: Callable[..., Any]


def surface(provider: str, slot: int) -> Surface:
    """Resolve the provider's operations for instance 1 or 2.

    Looked up at call time (app import), so tests that patch the provider module
    before importing app get their mocks."""
    if provider not in PROVIDERS:
        provider = "pihole"
    module = importlib.import_module(f"core.{provider}")
    names = dict(_P1_NAMES if slot == 1 else _P2_NAMES)
    names.update(_OVERRIDES.get((provider, slot), {}))
    return Surface(provider=provider, **{k: getattr(module, v) for k, v in names.items()})


def p2_config_error(provider: str) -> Callable[..., Any]:
    """The provider's second-instance validator: async (http_client | None) -> str | None."""
    if provider not in PROVIDERS:
        provider = "pihole"
    return importlib.import_module(f"core.{provider}").p2_config_error


class Slot:
    """One side whose provider is settled at startup (a BLOCKER_* side).

    Exposes the same operations as a Surface. Until bind() it answers with no
    stats and a plain error, keeps SSE clients waiting, and parks the poller."""

    def __init__(self, slot: int):
        self.slot = slot
        self.target: Surface | None = None
        self.error: str | None = None
        self.bound = asyncio.Event()
        self._clients: set = set()

    @property
    def provider(self) -> str | None:
        return self.target.provider if self.target else None

    def bind(self, provider: str) -> None:
        self.target = surface(provider, self.slot)
        self.error = None
        for q in self._clients:
            self.target.add_ws_client(q)
        self._clients.clear()
        self.bound.set()

    def fail(self, error: str) -> None:
        self.error = error

    def _unavailable(self) -> dict:
        return {"error": self.error or "waiting for the DNS server"}

    async def get_stats(self, http_client):
        return await self.target.get_stats(http_client) if self.target else None

    async def toggle_blocking(self, http_client, enable: bool, timer: int | None = None) -> dict:
        if not self.target:
            return self._unavailable()
        return await self.target.toggle_blocking(http_client, enable, timer)

    async def trigger_filter_update(self, http_client) -> dict:
        if not self.target:
            return self._unavailable()
        return await self.target.trigger_filter_update(http_client)

    async def query_poller(self, http_client) -> None:
        await self.bound.wait()
        await self.target.query_poller(http_client)

    def add_ws_client(self, q) -> None:
        if self.target:
            self.target.add_ws_client(q)
        else:
            self._clients.add(q)

    def remove_ws_client(self, q) -> None:
        self._clients.discard(q)
        if self.target:
            self.target.remove_ws_client(q)

    def reset_watermark(self) -> None:
        if self.target:
            self.target.reset_watermark()

    async def drop_session(self, http_client) -> None:
        if self.target:
            await self.target.drop_session(http_client)

