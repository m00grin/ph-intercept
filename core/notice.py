import logging

logger = logging.getLogger("ph-intercept")

_active: dict[str, str] = {}


def warn_once(key: str, message: str) -> None:
    if _active.get(key) == message:
        return
    _active[key] = message
    logger.warning(message)


def clear(key: str) -> None:
    if _active.pop(key, None) is not None:
        logger.warning("%s: connection OK again", key)
