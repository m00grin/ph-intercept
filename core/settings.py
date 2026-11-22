"""Which DNS server each side watches, and with what settings.

Two ways to configure a side:

- Legacy: provider-prefixed names (PROVIDER, PIHOLE_URL, ADGUARD2_PASSWORD, ...).
  These always win, and a config that uses only them resolves exactly as before.
- New: neutral names (BLOCKER_URL, BLOCKER_PASSWORD, BLOCKER2_URL, ...). They fill
  in whatever the legacy names leave unset, and the provider is detected at
  startup unless BLOCKER_TYPE / BLOCKER2_TYPE pins it.

effective_env() turns the environment into the legacy-shaped view config.py
already reads, so every provider module keeps working from its own names.
"""

import logging
import os
from dataclasses import dataclass, field
from urllib.parse import urlsplit, urlunsplit

logger = logging.getLogger("ph-intercept")

PROVIDERS = ("pihole", "adguard", "technitium", "blocky")
NAMES = {"pihole": "Pi-hole", "adguard": "AdGuard Home", "technitium": "Technitium", "blocky": "Blocky"}

# Per provider: legacy env prefix, the API path appended to the browser address,
# and which neutral fields map to which legacy suffix.
SPEC = {
    "pihole": {"prefix": "PIHOLE", "api": "/api",
               "fields": {"url": "URL", "password": "PASSWORD", "verify_ssl": "VERIFY_SSL"}},
    "adguard": {"prefix": "ADGUARD", "api": "/control",
                "fields": {"url": "URL", "username": "USERNAME", "password": "PASSWORD", "verify_ssl": "VERIFY_SSL"}},
    "technitium": {"prefix": "TECHNITIUM", "api": "",
                   "fields": {"url": "URL", "token": "TOKEN", "username": "USER", "password": "PASSWORD",
                              "verify_ssl": "VERIFY_SSL"}},
    "blocky": {"prefix": "BLOCKY", "api": "",
               "fields": {"url": "URL", "verify_ssl": "VERIFY_SSL", "dashboard": "DASHBOARD"}},
}
NEUTRAL = {"url": "URL", "username": "USERNAME", "password": "PASSWORD", "token": "TOKEN",
           "verify_ssl": "VERIFY_SSL", "dashboard": "DASHBOARD"}
SECRETS = ("username", "password", "token")
# Every neutral setting with its default, spelled out for tools that scan the code
# (the Unraid template check). Each secret also has a *_FILE form for Docker secrets.
NEUTRAL_ENV = {
    "BLOCKER_TYPE": "", "BLOCKER_URL": "", "BLOCKER_USERNAME": "", "BLOCKER_PASSWORD": "",
    "BLOCKER_TOKEN": "", "BLOCKER_VERIFY_SSL": "true", "BLOCKER_DASHBOARD": "",
    "BLOCKER2_TYPE": "", "BLOCKER2_URL": "", "BLOCKER2_USERNAME": "", "BLOCKER2_PASSWORD": "",
    "BLOCKER2_TOKEN": "", "BLOCKER2_VERIFY_SSL": "true", "BLOCKER2_DASHBOARD": "",
}
# Path suffixes people paste from the address bar; stripped before the API path is added.
_UI_SUFFIXES = ("/admin", "/api", "/control", "/login.html", "/index.html")


def _blank(v: str | None) -> bool:
    return v is None or not v.strip()


def neutral_prefix(slot: int) -> str:
    return "BLOCKER" if slot == 1 else "BLOCKER2"


def legacy_name(provider: str, slot: int, fld: str) -> str:
    spec = SPEC[provider]
    return f"{spec['prefix']}{'' if slot == 1 else '2'}_{spec['fields'][fld]}"


def root_url(url: str) -> str:
    """The server root from whatever the user pasted: drops a query, a fragment,
    trailing slashes, and known UI/API suffixes, keeping any reverse-proxy prefix."""
    parts = urlsplit(url.strip())
    path = parts.path.rstrip("/")
    changed = True
    while changed:
        changed = False
        for suffix in _UI_SUFFIXES:
            if path.lower().endswith(suffix):
                path = path[: -len(suffix)].rstrip("/")
                changed = True
    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))


def display_url(url: str) -> str:
    """The URL with any user:password@ removed, for logs, messages, and links.
    Requests still use the URL exactly as configured."""
    parts = urlsplit(url)
    if "@" not in parts.netloc:
        return url
    return urlunsplit((parts.scheme, parts.netloc.rsplit("@", 1)[1], parts.path, parts.query, parts.fragment))


def api_url(provider: str, url: str) -> str:
    return root_url(url) + SPEC[provider]["api"]


def _read_secret(name: str, path: str, notes: list[str]) -> str | None:
    try:
        with open(path.strip(), encoding="utf-8") as f:
            return f.read().rstrip("\r\n")
    except OSError as exc:
        notes.append(f"{name}_FILE: could not read {path.strip()} ({exc.strerror or exc})")
        return None


@dataclass
class Side:
    slot: int
    style: str                     # "legacy" or "new"
    provider: str | None           # None until detected
    explicit: bool = False         # type given by config (new style), checked by a probe
    root: str = ""                 # server root (new style), what detection probes
    url_ok: bool = True
    error: str | None = None       # config error that keeps this side from starting
    notes: list[str] = field(default_factory=list)

    @property
    def label(self) -> str:
        return f"Player {self.slot}"


@dataclass
class Resolved:
    env: dict
    sides: dict
    notes: list[str]
    source: dict = field(default_factory=dict)


def _provider_value(raw: str | None) -> str | None:
    if _blank(raw):
        return None
    return raw.strip().lower()


def _url_ok(url: str) -> bool:
    return bool(url) and "CHANGE.ME" not in url and url.startswith(("http://", "https://"))


def _dns_port(url: str) -> bool:
    try:
        return urlsplit(url.strip()).port == 53
    except ValueError:
        return False


def resolve(environ=None) -> Resolved:
    src = dict(os.environ if environ is None else environ)
    out = dict(src)
    notes: list[str] = []

    # Docker secrets for legacy names: PIHOLE_PASSWORD_FILE and friends fill a blank PIHOLE_PASSWORD.
    for p, spec in SPEC.items():
        for slot in (1, 2):
            for fld in SECRETS:
                if fld not in spec["fields"]:
                    continue
                name = legacy_name(p, slot, fld)
                if _blank(out.get(name)) and not _blank(out.get(f"{name}_FILE")):
                    v = _read_secret(name, out[f"{name}_FILE"], notes)
                    if v is not None:
                        out[name] = v

    sides: dict[int, Side] = {}
    for slot in (1, 2):
        pre = neutral_prefix(slot)
        neutral: dict[str, str] = {}
        for fld, suffix in NEUTRAL.items():
            name = f"{pre}_{suffix}"
            v = src.get(name)
            if _blank(v) and fld in SECRETS and not _blank(src.get(f"{name}_FILE")):
                v = _read_secret(name, src[f"{name}_FILE"], notes)
            if not _blank(v):
                neutral[fld] = v if fld in ("password", "token") else v.strip()
        sides[slot] = _resolve_side(slot, src, neutral)
        side = sides[slot]
        if side.style != "new":
            continue
        for p, spec in SPEC.items():
            for fld in spec["fields"]:
                if fld not in neutral:
                    continue
                name = legacy_name(p, slot, fld)
                value = api_url(p, neutral["url"]) if fld == "url" else neutral[fld]
                if _blank(out.get(name)):
                    out[name] = value
                elif p == side.provider and fld != "url":
                    side.notes.append(f"{name} is set, so {pre}_{NEUTRAL[fld]} is ignored for {NAMES[p]}")
    return Resolved(out, sides, notes, src)


def _resolve_side(slot: int, src: dict, neutral: dict) -> Side:
    pre = neutral_prefix(slot)
    if slot == 1:
        legacy_type = _provider_value(src.get("PROVIDER"))
        if legacy_type not in PROVIDERS:
            legacy_type = None
    else:
        legacy_type = None
    new_type_raw = _provider_value(src.get(f"{pre}_TYPE"))

    if "url" not in neutral:
        return Side(slot, "legacy", None)

    side = Side(slot, "new", None)
    if new_type_raw is not None and new_type_raw not in PROVIDERS:
        side.error = f"{pre}_TYPE={new_type_raw[:40]!r} is not one of {', '.join(PROVIDERS)}"
        return side
    explicit = legacy_type or new_type_raw
    if legacy_type and new_type_raw and legacy_type != new_type_raw:
        side.notes.append(f"PROVIDER={legacy_type} and {pre}_TYPE={new_type_raw} disagree; using PROVIDER")
    if explicit and not _blank(src.get(legacy_name(explicit, slot, "url"))):
        legacy = Side(slot, "legacy", explicit)
        legacy.notes.append(f"{legacy_name(explicit, slot, 'url')} is set, so {pre}_URL is ignored")
        return legacy
    if slot == 1 and not explicit and not _blank(src.get("PIHOLE_URL")):
        legacy = Side(slot, "legacy", "pihole")
        legacy.notes.append(f"PIHOLE_URL is set, so {pre}_URL is ignored")
        return legacy

    url = neutral["url"]
    side.provider = explicit
    side.explicit = explicit is not None
    side.root = root_url(url)
    side.url_ok = _url_ok(url)
    if not side.url_ok:
        side.error = (f"{pre}_URL still has the placeholder value" if "CHANGE.ME" in url
                      else f"{pre}_URL must start with http:// or https://")
    elif _dns_port(url):
        side.error = (f"{pre}_URL points at port 53, the DNS port. Use the address of the "
                      "web interface instead (the one you open in a browser)")
    return side


def unused_fields(side: Side, environ=None) -> list[str]:
    """Neutral settings this side's provider doesn't use (logged, never an error)."""
    if side.style != "new" or side.provider is None:
        return []
    src = os.environ if environ is None else environ
    pre = neutral_prefix(side.slot)
    used = SPEC[side.provider]["fields"]
    out = []
    for fld, suffix in NEUTRAL.items():
        if fld in used or fld == "dashboard":
            continue
        if not _blank(src.get(f"{pre}_{suffix}")) or not _blank(src.get(f"{pre}_{suffix}_FILE")):
            out.append(f"{pre}_{suffix}")
    return out


def credential_error(side: Side, env: dict) -> str | None:
    """Strict credential check for a new-style side once its provider is known."""
    if side.style != "new" or side.provider != "technitium":
        return None
    pre = neutral_prefix(side.slot)
    token = env.get(legacy_name("technitium", side.slot, "token"), "").strip()
    user = env.get(legacy_name("technitium", side.slot, "username"), "").strip()
    password = env.get(legacy_name("technitium", side.slot, "password"), "")
    if token and (user or password):
        return f"Technitium: set {pre}_TOKEN, or {pre}_USERNAME and {pre}_PASSWORD, not both"
    if not token and not (user and password):
        return f"Technitium needs {pre}_TOKEN (an API token), or {pre}_USERNAME and {pre}_PASSWORD"
    return None
