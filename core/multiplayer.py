import json
from pathlib import Path

_SESSION_FILE = Path("/app/data/.2p_session")

_VALID_MODES = frozenset(["off", "local"])


def _load() -> dict:
    try:
        return json.loads(_SESSION_FILE.read_text())
    except Exception:
        return {}


def _save(data: dict) -> None:
    _SESSION_FILE.parent.mkdir(parents=True, exist_ok=True)
    _SESSION_FILE.write_text(json.dumps(data))
    _SESSION_FILE.chmod(0o600)


def get_status(local_configured: bool) -> dict:
    data = _load()
    mode = data.get("mode", "off")
    if mode == "local" and not local_configured:
        mode = "off"
    return {"mode": mode, "local_configured": local_configured}


def set_mode(mode: str, local_configured: bool) -> dict:
    if mode not in _VALID_MODES:
        raise ValueError(f"invalid mode: {mode!r}")
    if mode == "local" and not local_configured:
        raise ValueError("local mode requires a configured second instance")
    data = _load()
    data["mode"] = mode
    _save(data)
    return get_status(local_configured)
