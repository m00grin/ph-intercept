import logging
import re

from .settings import PROVIDERS, display_url, resolve as _resolve

# The HTTP library logs every request URL at INFO, query string included. Keep it
# to warnings so a raised log level can never print a URL's credentials.
for _name in ("httpx", "httpcore"):
    logging.getLogger(_name).setLevel(logging.WARNING)

# Legacy names win; BLOCKER_* fill in what they leave unset (see core/settings.py).
RESOLVED = _resolve()
_env = RESOLVED.env
SIDES = RESOLVED.sides
SIDE1, SIDE2 = SIDES[1], SIDES[2]

if SIDE1.style == "legacy" and SIDE1.provider:
    PROVIDER = SIDE1.provider
elif SIDE1.style == "legacy":
    PROVIDER = _env.get("PROVIDER", "pihole").strip().lower() or "pihole"
    if PROVIDER not in PROVIDERS:
        logging.getLogger("ph-intercept").warning(
            "PROVIDER=%r is not recognised (expected pihole, adguard, technitium, or blocky); running as pihole",
            PROVIDER[:40],
        )
        PROVIDER = "pihole"
    SIDE1.provider = PROVIDER
else:
    # New style: known now when BLOCKER_TYPE (or PROVIDER) pins it, otherwise detected at startup.
    PROVIDER = SIDE1.provider or ""

PIHOLE_BASE = _env.get("PIHOLE_URL", "http://pihole:8053/api")
_ssl_raw = _env.get("PIHOLE_VERIFY_SSL", "true").strip().lower()
PIHOLE_VERIFY_SSL = _ssl_raw not in ("false", "0", "no")
PIHOLE_DASHBOARD = display_url(PIHOLE_BASE.rstrip('/').removesuffix('/api') + '/admin')
PIHOLE_PASSWORD = _env.get("PIHOLE_PASSWORD", "")

ADGUARD_BASE = _env.get("ADGUARD_URL", "http://adguard:3000/control")
_adguard_ssl_raw = _env.get("ADGUARD_VERIFY_SSL", "true").strip().lower()
ADGUARD_VERIFY_SSL = _adguard_ssl_raw not in ("false", "0", "no")
ADGUARD_DASHBOARD = display_url(ADGUARD_BASE.rstrip('/').removesuffix('/control') + '/')
ADGUARD_USERNAME = _env.get("ADGUARD_USERNAME", "")
ADGUARD_PASSWORD = _env.get("ADGUARD_PASSWORD", "")

# ── Second instance (2-player local mode) ──────────────────────────────────
# With legacy names the second instance mirrors PROVIDER (a second Pi-hole for a
# Pi-hole P1, and so on), read from PIHOLE2_*, ADGUARD2_*, ... With BLOCKER2_* it
# can be any provider. The code below resolves both to provider-neutral P2_* values.
P2_PLACEHOLDER = "CHANGE.ME"
_P2_PLACEHOLDER = P2_PLACEHOLDER


def _p2_url_valid(url: str) -> bool:
    return (
        bool(url) and
        _P2_PLACEHOLDER not in url and
        (url.startswith("http://") or url.startswith("https://"))
    )


# Pi-hole second instance
PIHOLE2_URL = _env.get("PIHOLE2_URL", "").strip()
PIHOLE2_PASSWORD = _env.get("PIHOLE2_PASSWORD", "")
_pihole2_ssl_raw = _env.get("PIHOLE2_VERIFY_SSL", "true").strip().lower()
PIHOLE2_VERIFY_SSL = _pihole2_ssl_raw not in ("false", "0", "no")
PIHOLE2_DASHBOARD = display_url(PIHOLE2_URL.rstrip('/').removesuffix('/api') + '/admin') if PIHOLE2_URL else ""

# AdGuard second instance
ADGUARD2_BASE = _env.get("ADGUARD2_URL", "").strip()
ADGUARD2_USERNAME = _env.get("ADGUARD2_USERNAME", "")
ADGUARD2_PASSWORD = _env.get("ADGUARD2_PASSWORD", "")
_adguard2_ssl_raw = _env.get("ADGUARD2_VERIFY_SSL", "true").strip().lower()
ADGUARD2_VERIFY_SSL = _adguard2_ssl_raw not in ("false", "0", "no")
ADGUARD2_DASHBOARD = display_url(ADGUARD2_BASE.rstrip('/').removesuffix('/control') + '/') if ADGUARD2_BASE else ""

# Technitium primary instance. TECHNITIUM_URL is the web-console root; the API
# lives under {root}/api/ and the dashboard is the root itself. Auth is either a
# permanent API token (TECHNITIUM_TOKEN) or user/password (+ optional TOTP).
TECHNITIUM_URL = _env.get("TECHNITIUM_URL", "http://technitium:5380").strip()
TECHNITIUM_BASE = TECHNITIUM_URL.rstrip('/')
TECHNITIUM_DASHBOARD = display_url(TECHNITIUM_BASE + '/')
_technitium_ssl_raw = _env.get("TECHNITIUM_VERIFY_SSL", "true").strip().lower()
TECHNITIUM_VERIFY_SSL = _technitium_ssl_raw not in ("false", "0", "no")
TECHNITIUM_TOKEN = _env.get("TECHNITIUM_TOKEN", "").strip()
TECHNITIUM_USER = _env.get("TECHNITIUM_USER", "").strip()
TECHNITIUM_PASSWORD = _env.get("TECHNITIUM_PASSWORD", "")
TECHNITIUM_TOTP = _env.get("TECHNITIUM_TOTP", "").strip()
# The query log comes from an installed DNS app (Query Logs (Sqlite) by default).
TECHNITIUM_LOG_APP = _env.get("TECHNITIUM_QUERY_LOG_APP", "Query Logs (Sqlite)").strip()
TECHNITIUM_LOG_CLASS = _env.get("TECHNITIUM_QUERY_LOG_CLASS", "QueryLogsSqlite.App").strip()

# Technitium second instance (2-player local mode)
TECHNITIUM2_URL = _env.get("TECHNITIUM2_URL", "").strip()
TECHNITIUM2_BASE = TECHNITIUM2_URL.rstrip('/')
TECHNITIUM2_DASHBOARD = display_url(TECHNITIUM2_BASE + '/') if TECHNITIUM2_BASE else ""
_technitium2_ssl_raw = _env.get("TECHNITIUM2_VERIFY_SSL", "true").strip().lower()
TECHNITIUM2_VERIFY_SSL = _technitium2_ssl_raw not in ("false", "0", "no")
TECHNITIUM2_TOKEN = _env.get("TECHNITIUM2_TOKEN", "").strip()
TECHNITIUM2_USER = _env.get("TECHNITIUM2_USER", "").strip()
TECHNITIUM2_PASSWORD = _env.get("TECHNITIUM2_PASSWORD", "")
TECHNITIUM2_TOTP = _env.get("TECHNITIUM2_TOTP", "").strip()
TECHNITIUM2_LOG_APP = _env.get("TECHNITIUM2_QUERY_LOG_APP", TECHNITIUM_LOG_APP).strip()
TECHNITIUM2_LOG_CLASS = _env.get("TECHNITIUM2_QUERY_LOG_CLASS", TECHNITIUM_LOG_CLASS).strip()

# Blocky. BLOCKY_URL is the HTTP listener (ports.http); its REST API lives under
# {root}/api/. Blocky has no query-log API, so live queries come from its CSV
# query log (queryLog.type: csv), mounted read-only at BLOCKY_LOG_DIR. Blocky has
# no web UI either; BLOCKY_DASHBOARD optionally points the settings-menu link at
# one (for example a Grafana dashboard).
def _blocky_root(url: str) -> str:
    return url.strip().rstrip('/').removesuffix('/api').rstrip('/')


BLOCKY_URL = _env.get("BLOCKY_URL", "http://blocky:4000").strip()
BLOCKY_BASE = _blocky_root(BLOCKY_URL)
BLOCKY_LOG_DIR = _env.get("BLOCKY_LOG_DIR", "").strip() or "/blocky-logs"
_blocky_ssl_raw = _env.get("BLOCKY_VERIFY_SSL", "true").strip().lower()
BLOCKY_VERIFY_SSL = _blocky_ssl_raw not in ("false", "0", "no")
BLOCKY_DASHBOARD = _env.get("BLOCKY_DASHBOARD", "").strip()

# Blocky second instance (2-player local mode)
BLOCKY2_URL = _env.get("BLOCKY2_URL", "").strip()
BLOCKY2_BASE = _blocky_root(BLOCKY2_URL) if BLOCKY2_URL else ""
BLOCKY2_LOG_DIR = _env.get("BLOCKY2_LOG_DIR", "").strip() or "/blocky2-logs"
_blocky2_ssl_raw = _env.get("BLOCKY2_VERIFY_SSL", "true").strip().lower()
BLOCKY2_VERIFY_SSL = _blocky2_ssl_raw not in ("false", "0", "no")
BLOCKY2_DASHBOARD = _env.get("BLOCKY2_DASHBOARD", "").strip()

# Second instance, per provider: (configured, dashboard, verify_ssl).
_P2_BY_PROVIDER = {
    "pihole": (_p2_url_valid(PIHOLE2_URL), PIHOLE2_DASHBOARD, PIHOLE2_VERIFY_SSL),
    "adguard": (_p2_url_valid(ADGUARD2_BASE), ADGUARD2_DASHBOARD, ADGUARD2_VERIFY_SSL),
    "technitium": (_p2_url_valid(TECHNITIUM2_BASE), TECHNITIUM2_DASHBOARD, TECHNITIUM2_VERIFY_SSL),
    "blocky": (_p2_url_valid(BLOCKY2_BASE), BLOCKY2_DASHBOARD, BLOCKY2_VERIFY_SSL),
}


def env_prefix(legacy: str, slot: int) -> str:
    """Prefix to name in messages: BLOCKER / BLOCKER2 for a new-style side, else the legacy one."""
    if SIDES[slot].style == "new":
        return "BLOCKER" if slot == 1 else "BLOCKER2"
    return legacy if slot == 1 else f"{legacy}2"


_NEUTRAL_VERIFY = {
    1: _env.get("BLOCKER_VERIFY_SSL", "true").strip().lower() not in ("false", "0", "no"),
    2: _env.get("BLOCKER2_VERIFY_SSL", "true").strip().lower() not in ("false", "0", "no"),
}


def _neutral_verify(slot: int) -> bool:
    return _NEUTRAL_VERIFY[slot]


# Dashboard links set with BLOCKER_DASHBOARD / BLOCKER2_DASHBOARD replace the derived ones.
DASHBOARD_OVERRIDE = {
    1: _env.get("BLOCKER_DASHBOARD", "").strip() if SIDE1.style == "new" else "",
    2: _env.get("BLOCKER2_DASHBOARD", "").strip() if SIDE2.style == "new" else "",
}

# Legacy second side mirrors PROVIDER, as it always has; a new-style one is its own provider.
if SIDE2.style == "legacy":
    if SIDE2.provider is None:
        SIDE2.provider = SIDE1.provider if PROVIDER else None
    P2_PROVIDER = SIDE2.provider or ""
    if P2_PROVIDER:
        P2_CONFIGURED, P2_DASHBOARD, P2_VERIFY_SSL = _P2_BY_PROVIDER.get(P2_PROVIDER, _P2_BY_PROVIDER["pihole"])
    else:
        P2_CONFIGURED = any(v[0] for v in _P2_BY_PROVIDER.values())
        P2_DASHBOARD, P2_VERIFY_SSL = "", _neutral_verify(1)
else:
    P2_PROVIDER = SIDE2.provider or ""
    P2_CONFIGURED = SIDE2.url_ok and SIDE2.error is None
    if P2_PROVIDER:
        _, P2_DASHBOARD, P2_VERIFY_SSL = _P2_BY_PROVIDER[P2_PROVIDER]
    else:
        P2_DASHBOARD, P2_VERIFY_SSL = "", _neutral_verify(2)
if DASHBOARD_OVERRIDE[2]:
    P2_DASHBOARD = DASHBOARD_OVERRIDE[2]


def p2_settings(provider: str) -> tuple[bool, str, bool]:
    """(configured, dashboard, verify_ssl) of the second side once its provider is known."""
    configured, dashboard, verify = _P2_BY_PROVIDER.get(provider, _P2_BY_PROVIDER["pihole"])
    if SIDE2.style == "new":
        configured = SIDE2.url_ok and SIDE2.error is None
    return configured, DASHBOARD_OVERRIDE[2] or dashboard, verify


def neutral_verify(slot: int) -> bool:
    return _neutral_verify(slot)

# Back-compat alias: existing imports and templates use this name
TWO_PLAYER_LOCAL_CONFIGURED = P2_CONFIGURED
TWO_PLAYER_ENABLED = True

_log = logging.getLogger("ph-intercept")

# Schemes that would run code in this page if ESC navigated to them. Anything
# else stays allowed, custom app schemes included (they're documented).
_SCRIPT_SCHEMES = frozenset(["javascript", "vbscript", "data", "blob"])


def _browser_url(raw: str) -> str:
    """The URL as a browser reads it: tabs and newlines dropped, and spaces and control characters trimmed."""
    return re.sub(r"[\t\n\r]", "", raw).strip("".join(map(chr, range(0x21))))


def _return_url(raw: str) -> str:
    url = _browser_url(raw)
    scheme = re.match(r"([A-Za-z][A-Za-z0-9+.-]*):", url)
    if scheme and scheme.group(1).lower() in _SCRIPT_SCHEMES:
        _log.warning("RETURN_URL: %s: links can't run scripts; ESC is off", scheme.group(1).lower())
        return ""
    return url


def _bg_image(raw: str) -> str:
    url = _browser_url(raw)
    if url and not (url.startswith("/") or re.match(r"https?://", url, re.I)):
        _log.warning("BG_IMAGE: expected an http(s) URL or a /bg/ path; ignoring it")
        return ""
    return url


BG_MODES = ("starfield", "nebula", "outrun", "dark")


def _choice(name: str, raw: str, default: str, allowed) -> str:
    value = raw.strip().lower() or default
    if value not in allowed:
        _log.warning("%s=%r is not one of %s; using %s", name, value[:40], ", ".join(allowed), default)
        return default
    return value


RETURN_URL = _return_url(_env.get("RETURN_URL", ""))
BG_IMAGE = _bg_image(_env.get("BG_IMAGE", ""))
BG_MODE = "image" if BG_IMAGE else _choice("BG_MODE", _env.get("BG_MODE", "starfield"), "starfield", BG_MODES)
READ_ONLY = _env.get("READ_ONLY", "false").strip().lower() in ("true", "1", "yes")
HIDE_CLIENT = _env.get("HIDE_CLIENT", "false").strip().lower() in ("true", "1", "yes")
HIDE_DOMAIN = _env.get("HIDE_DOMAIN", "false").strip().lower() in ("true", "1", "yes")

SKY_PRESETS = {
    "summer_triangle": {"ra": 19.27, "dec": 15.86},
    "orion": {"ra": 5.60, "dec": 0.00},
    "scorpius": {"ra": 17.00, "dec": -30.0},
    "southern_cross": {"ra": 12.47, "dec": -60.0},
}
SKY_PRESET = _choice("SKY_PRESET", _env.get("SKY_PRESET", "summer_triangle"), "summer_triangle", tuple(SKY_PRESETS))

def _compile_ignore_patterns(raw: str, env_var: str = "pattern") -> list[re.Pattern]:
    import logging
    patterns = []
    for p in raw.split(","):
        p = p.strip()
        if not p:
            continue
        try:
            patterns.append(re.compile(p, re.IGNORECASE))
        except re.error as e:
            logging.getLogger(__name__).warning("%s: invalid pattern %r skipped (%s)", env_var, p, e)
    return patterns

IGNORE_DOMAIN_PATTERNS: list[re.Pattern] = _compile_ignore_patterns(
    _env.get("PIHOLE_IGNORE_DOMAINS", ""), "PIHOLE_IGNORE_DOMAINS"
)
ADGUARD_IGNORE_DOMAIN_PATTERNS: list[re.Pattern] = _compile_ignore_patterns(
    _env.get("ADGUARD_IGNORE_DOMAINS", ""), "ADGUARD_IGNORE_DOMAINS"
)
TECHNITIUM_IGNORE_DOMAIN_PATTERNS: list[re.Pattern] = _compile_ignore_patterns(
    _env.get("TECHNITIUM_IGNORE_DOMAINS", ""), "TECHNITIUM_IGNORE_DOMAINS"
)
IGNORE_CLIENT_PATTERNS: list[re.Pattern] = _compile_ignore_patterns(
    _env.get("PIHOLE_IGNORE_CLIENTS", ""), "PIHOLE_IGNORE_CLIENTS"
)
ADGUARD_IGNORE_CLIENT_PATTERNS: list[re.Pattern] = _compile_ignore_patterns(
    _env.get("ADGUARD_IGNORE_CLIENTS", ""), "ADGUARD_IGNORE_CLIENTS"
)
TECHNITIUM_IGNORE_CLIENT_PATTERNS: list[re.Pattern] = _compile_ignore_patterns(
    _env.get("TECHNITIUM_IGNORE_CLIENTS", ""), "TECHNITIUM_IGNORE_CLIENTS"
)
BLOCKY_IGNORE_DOMAIN_PATTERNS: list[re.Pattern] = _compile_ignore_patterns(
    _env.get("BLOCKY_IGNORE_DOMAINS", ""), "BLOCKY_IGNORE_DOMAINS"
)
BLOCKY_IGNORE_CLIENT_PATTERNS: list[re.Pattern] = _compile_ignore_patterns(
    _env.get("BLOCKY_IGNORE_CLIENTS", ""), "BLOCKY_IGNORE_CLIENTS"
)

# Ignore lists. IGNORE_* apply to both sides, BLOCKER_IGNORE_* to side 1 and
# BLOCKER2_IGNORE_* to side 2, on top of each provider's own legacy list. Ignoring
# only ever hides ships, so the union can't un-hide anything a config hid before.
IGNORE_BOTH = (
    _compile_ignore_patterns(_env.get("IGNORE_DOMAINS", ""), "IGNORE_DOMAINS"),
    _compile_ignore_patterns(_env.get("IGNORE_CLIENTS", ""), "IGNORE_CLIENTS"),
)
IGNORE_SIDE = {
    1: (
        _compile_ignore_patterns(_env.get("BLOCKER_IGNORE_DOMAINS", ""), "BLOCKER_IGNORE_DOMAINS"),
        _compile_ignore_patterns(_env.get("BLOCKER_IGNORE_CLIENTS", ""), "BLOCKER_IGNORE_CLIENTS"),
    ),
    2: (
        _compile_ignore_patterns(_env.get("BLOCKER2_IGNORE_DOMAINS", ""), "BLOCKER2_IGNORE_DOMAINS"),
        _compile_ignore_patterns(_env.get("BLOCKER2_IGNORE_CLIENTS", ""), "BLOCKER2_IGNORE_CLIENTS"),
    ),
}
_IGNORE_LEGACY = {
    "pihole": (IGNORE_DOMAIN_PATTERNS, IGNORE_CLIENT_PATTERNS),
    "adguard": (ADGUARD_IGNORE_DOMAIN_PATTERNS, ADGUARD_IGNORE_CLIENT_PATTERNS),
    "technitium": (TECHNITIUM_IGNORE_DOMAIN_PATTERNS, TECHNITIUM_IGNORE_CLIENT_PATTERNS),
    "blocky": (BLOCKY_IGNORE_DOMAIN_PATTERNS, BLOCKY_IGNORE_CLIENT_PATTERNS),
}


def ignore_patterns(provider: str, slot: int) -> tuple[list[re.Pattern], list[re.Pattern]]:
    """(domain patterns, client patterns) for one provider on one side."""
    legacy_d, legacy_c = _IGNORE_LEGACY[provider]
    side_d, side_c = IGNORE_SIDE[slot]
    return legacy_d + IGNORE_BOTH[0] + side_d, legacy_c + IGNORE_BOTH[1] + side_c

