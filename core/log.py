"""One logger for the whole app, and LOG_LEVEL.

Everything logs to "ph-intercept", plain text on stderr. LOG_LEVEL picks how
much: debug (troubleshooting detail), info (the default: the startup report and
real events), warning (problems only, no banner), or error.
"""
import logging
import sys

LEVELS = {"debug": logging.DEBUG, "info": logging.INFO, "warning": logging.WARNING, "error": logging.ERROR}
logger = logging.getLogger("ph-intercept")


def configure(raw: str | None) -> str:
    """Set the level from LOG_LEVEL and return its name. An unknown value is reported and info is used."""
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter("%(message)s"))
        logger.addHandler(handler)
    name = (raw or "").strip().lower() or "info"
    if name not in LEVELS:
        logger.setLevel(logging.INFO)
        logger.warning("LOG_LEVEL=%r is not one of debug, info, warning, error; using info", (raw or "")[:40])
        return "info"
    logger.setLevel(LEVELS[name])
    return name
