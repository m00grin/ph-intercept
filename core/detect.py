"""Identify which ad-blocker answers at a URL, strictly.

One unauthenticated request per provider, sent together, plus one more only to
confirm an AdGuard Home that requires a login. Exactly one provider must match;
anything else is reported, never guessed. Fingerprints were measured on Pi-hole
2026.11.0, AdGuard Home v1.0.0 and v0.107.52 to .80 (older ones answer 403 instead
of 401 without a login), Technitium 15.6.2, and Blocky v0.37.0.
"""

import asyncio

import httpx

_TIMEOUT = 3.0


def _json(resp: httpx.Response | BaseException) -> dict | None:
    if not isinstance(resp, httpx.Response):
        return None
    try:
        body = resp.json()
    except Exception:
        return None
    return body if isinstance(body, dict) else None


def _is_pihole(resp) -> bool:
    body = _json(resp)
    return (body is not None and resp.status_code in (200, 401)
            and isinstance(body.get("session"), dict) and "valid" in body["session"])


def _is_technitium(resp) -> bool:
    body = _json(resp)
    return body is not None and isinstance(body.get("status"), str) and "session" not in body


def _is_blocky(resp) -> bool:
    body = _json(resp)
    return (body is not None and resp.status_code == 200
            and isinstance(body.get("enabled"), bool) and "status" not in body)


async def _is_adguard(client: httpx.AsyncClient, root: str, resp) -> bool:
    if not isinstance(resp, httpx.Response):
        return False
    body = _json(resp)
    if resp.status_code == 200:
        return body is not None and "protection_enabled" in body and "version" in body
    if resp.status_code not in (401, 403):
        return False
    try:
        home = await client.get(f"{root}/", timeout=_TIMEOUT, follow_redirects=False)
    except httpx.HTTPError:
        return False
    return home.status_code in (301, 302, 303, 307, 308) and home.headers.get("location", "").endswith("login.html")


def _adguard_setting_up(resp) -> bool:
    """A fresh AdGuard Home sends every request to its setup wizard until that's done."""
    return (isinstance(resp, httpx.Response) and resp.status_code in (301, 302, 303, 307, 308)
            and resp.headers.get("location", "").endswith("/install.html"))


async def identify(client: httpx.AsyncClient, root: str) -> tuple[str | None, str]:
    """(provider, "") when exactly one matches, else (None, reason).

    reason is "unreachable" when nothing answered at all, or "adguard-setup" for an
    AdGuard Home that hasn't finished its first-run setup (both worth waiting for);
    "certificate" when HTTPS failed verification; anything else is a config
    problem to report."""
    paths = {
        "pihole": "/api/auth",
        "adguard": "/control/status",
        "technitium": "/api/user/session/get",
        "blocky": "/api/blocking/status",
    }
    responses = await asyncio.gather(
        *(client.get(f"{root}{p}", timeout=_TIMEOUT, follow_redirects=False) for p in paths.values()),
        return_exceptions=True,
    )
    by = dict(zip(paths, responses))
    if all(not isinstance(r, httpx.Response) for r in responses):
        if any("CERTIFICATE_VERIFY_FAILED" in str(r) for r in responses):
            return None, "certificate"
        return None, "unreachable"
    matches = [p for p, ok in (
        ("pihole", _is_pihole(by["pihole"])),
        ("adguard", await _is_adguard(client, root, by["adguard"])),
        ("technitium", _is_technitium(by["technitium"])),
        ("blocky", _is_blocky(by["blocky"])),
    ) if ok]
    if len(matches) == 1:
        return matches[0], ""
    if not matches and _adguard_setting_up(by["adguard"]):
        return None, "adguard-setup"
    if not matches:
        return None, "no Pi-hole, AdGuard Home, Technitium, or Blocky answered there"
    return None, "it answered like more than one of " + ", ".join(matches)
