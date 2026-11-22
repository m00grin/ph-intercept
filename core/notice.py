"""Problems that persist are logged once, and once more when they clear.

Provider messages start with their label ("Pi-hole", "AdGuard 2", "Technitium 2
query log", ...); they are reshaped to the startup report's form, for example
"  P2  AdGuard Home: login rejected ...".
"""
import logging
import re

from . import banner

logger = logging.getLogger("ph-intercept")

_active: dict[str, str] = {}
_LABEL = re.compile(r"^(Pi-hole|AdGuard|Technitium|Blocky)( 2)?( query log)?: ")
_NAMES = {"Pi-hole": "Pi-hole", "AdGuard": "AdGuard Home", "Technitium": "Technitium", "Blocky": "Blocky"}


def shape(message: str, style: str = "problem") -> str:
    """style: problem (amber), ok (green), or info (plain)."""
    m = _LABEL.match(message)
    if not m:
        return message
    slot, text = 2 if m[2] else 1, f"{_NAMES[m[1]]}{m[3] or ''}: {message[m.end():]}"
    if style == "info":
        return banner.side(slot, text, color=banner.COLOR)
    return (banner.ok if style == "ok" else banner.problem)(slot, text, banner.COLOR)


def warn_once(key: str, message: str) -> None:
    if _active.get(key) == message:
        return
    _active[key] = message
    logger.warning(shape(message))


def clear(key: str) -> None:
    if _active.pop(key, None) is not None:
        logger.warning(shape(f"{key}: connection OK again", "ok"))
