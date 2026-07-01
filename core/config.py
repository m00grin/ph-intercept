import os
import re

PROVIDER = os.environ.get("PROVIDER", "pihole").lower()

PIHOLE_BASE = os.environ.get("PIHOLE_URL", "http://pihole:8053/api")
_ssl_raw = os.environ.get("PIHOLE_VERIFY_SSL", "true").strip().lower()
PIHOLE_VERIFY_SSL = _ssl_raw not in ("false", "0", "no")
PIHOLE_DASHBOARD = PIHOLE_BASE.rstrip('/').removesuffix('/api') + '/admin'

ADGUARD_BASE = os.environ.get("ADGUARD_URL", "http://adguard:3000/control")
_adguard_ssl_raw = os.environ.get("ADGUARD_VERIFY_SSL", "true").strip().lower()
ADGUARD_VERIFY_SSL = _adguard_ssl_raw not in ("false", "0", "no")
ADGUARD_DASHBOARD = ADGUARD_BASE.rstrip('/').removesuffix('/control') + '/'

# ── Second instance (2-player local mode) ──────────────────────────────────
# The second instance always mirrors the primary PROVIDER: a Pi-hole P1 pairs
# with a second Pi-hole, an AdGuard P1 with a second AdGuard. Env var names stay
# provider-prefixed (PIHOLE2_*, ADGUARD2_*) for symmetry with the primary vars;
# the code below resolves them to provider-neutral P2_* values.
_P2_PLACEHOLDER = "CHANGE.ME"


def _p2_url_valid(url: str) -> bool:
    return (
        bool(url) and
        _P2_PLACEHOLDER not in url and
        (url.startswith("http://") or url.startswith("https://"))
    )


# Pi-hole second instance
PIHOLE2_URL = os.environ.get("PIHOLE2_URL", "").strip()
PIHOLE2_PASSWORD = os.environ.get("PIHOLE2_PASSWORD", "")
_pihole2_ssl_raw = os.environ.get("PIHOLE2_VERIFY_SSL", "true").strip().lower()
PIHOLE2_VERIFY_SSL = _pihole2_ssl_raw not in ("false", "0", "no")
PIHOLE2_DASHBOARD = PIHOLE2_URL.rstrip('/').removesuffix('/api') + '/admin' if PIHOLE2_URL else ""

# AdGuard second instance
ADGUARD2_BASE = os.environ.get("ADGUARD2_URL", "").strip()
ADGUARD2_USERNAME = os.environ.get("ADGUARD2_USERNAME", "")
ADGUARD2_PASSWORD = os.environ.get("ADGUARD2_PASSWORD", "")
_adguard2_ssl_raw = os.environ.get("ADGUARD2_VERIFY_SSL", "true").strip().lower()
ADGUARD2_VERIFY_SSL = _adguard2_ssl_raw not in ("false", "0", "no")
ADGUARD2_DASHBOARD = ADGUARD2_BASE.rstrip('/').removesuffix('/control') + '/' if ADGUARD2_BASE else ""

# Provider-neutral resolution of the second instance
if PROVIDER == "adguard":
    P2_CONFIGURED = _p2_url_valid(ADGUARD2_BASE)
    P2_DASHBOARD = ADGUARD2_DASHBOARD
    P2_VERIFY_SSL = ADGUARD2_VERIFY_SSL
else:
    P2_CONFIGURED = _p2_url_valid(PIHOLE2_URL)
    P2_DASHBOARD = PIHOLE2_DASHBOARD
    P2_VERIFY_SSL = PIHOLE2_VERIFY_SSL

# Back-compat alias: existing imports and templates use this name
TWO_PLAYER_LOCAL_CONFIGURED = P2_CONFIGURED
TWO_PLAYER_ENABLED = True

RETURN_URL = os.environ.get("RETURN_URL", "")
BG_IMAGE = os.environ.get("BG_IMAGE", "")
BG_MODE = "image" if BG_IMAGE else os.environ.get("BG_MODE", "starfield").lower()
SKY_PRESET = os.environ.get("SKY_PRESET", "summer_triangle").lower()

SKY_PRESETS = {
    "summer_triangle": {"ra": 19.27, "dec": 15.86},
    "orion": {"ra": 5.60, "dec": 0.00},
    "scorpius": {"ra": 17.00, "dec": -30.0},
    "southern_cross": {"ra": 12.47, "dec": -60.0},
}

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
    os.environ.get("PIHOLE_IGNORE_DOMAINS", ""), "PIHOLE_IGNORE_DOMAINS"
)
ADGUARD_IGNORE_DOMAIN_PATTERNS: list[re.Pattern] = _compile_ignore_patterns(
    os.environ.get("ADGUARD_IGNORE_DOMAINS", ""), "ADGUARD_IGNORE_DOMAINS"
)
