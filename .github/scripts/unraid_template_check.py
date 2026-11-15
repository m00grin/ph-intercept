import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEMPLATE_URL = "https://raw.githubusercontent.com/m00grin/unraid-templates/main/templates/ph-intercept.xml"
IMAGE = "m00grin/ph-intercept:latest"

OMIT = {
    "TECHNITIUM2_QUERY_LOG_APP": "inherits the primary value when unset; a blank Unraid field would override that",
    "TECHNITIUM2_QUERY_LOG_CLASS": "inherits the primary value when unset; a blank Unraid field would override that",
}

USER_SUPPLIED = {"PIHOLE_URL", "ADGUARD_URL", "TECHNITIUM_URL"}

ENV_READ = re.compile(r"""os\.(?:environ\.get|getenv)\(\s*["']([A-Z0-9_]+)["']\s*(?:,\s*(["'])(.*?)\2)?""")


def code_env() -> dict[str, str | None]:
    found: dict[str, str | None] = {}
    for path in [ROOT / "app.py", *sorted((ROOT / "core").glob("*.py"))]:
        for m in ENV_READ.finditer(path.read_text()):
            name, default = m.group(1), m.group(3)
            if default is None and m.group(2) is None:
                found.setdefault(name, None)
            else:
                found[name] = default
    return found


def load_template(src: str) -> ET.Element:
    if src.startswith(("http://", "https://")):
        with urllib.request.urlopen(src, timeout=20) as r:
            return ET.fromstring(r.read())
    return ET.parse(src).getroot()


def check(root: ET.Element, env: dict[str, str | None]) -> list[str]:
    errors: list[str] = []
    configs = root.findall("Config")
    variables = {c.get("Target"): c for c in configs if c.get("Type") == "Variable"}
    ports = [c for c in configs if c.get("Type") == "Port"]

    for name in sorted(set(env) - set(variables) - set(OMIT)):
        errors.append(f"{name}: read by the code but missing from the template")
    for name in sorted(set(variables) - set(env)):
        errors.append(f"{name}: in the template but the code no longer reads it")
    for name in sorted(set(OMIT) & set(variables)):
        errors.append(f"{name}: must stay out of the template ({OMIT[name]})")

    for name, c in sorted(variables.items()):
        if name not in env:
            continue
        value = (c.text or "").strip()
        options = (c.get("Default") or "").split("|")
        if len(options) > 1 and value not in options:
            errors.append(f"{name}: value {value!r} is not one of its dropdown options {options}")
        default = env[name]
        if default is None or name in USER_SUPPLIED:
            continue
        if value.lower() != default.strip().lower():
            errors.append(f"{name}: template value {value!r} differs from the code default {default!r}")

    def dropdown(name: str) -> set[str]:
        c = variables.get(name)
        return set((c.get("Default") or "").split("|")) if c is not None else set()

    config_py = (ROOT / "core" / "config.py").read_text()
    m = re.search(r'PROVIDER not in \(([^)]*)\)', config_py)
    providers = set(re.findall(r'"(\w+)"', m.group(1))) if m else set()
    if providers and dropdown("PROVIDER") != providers:
        errors.append(f"PROVIDER: dropdown {sorted(dropdown('PROVIDER'))} != code {sorted(providers)}")
    m = re.search(r"SKY_PRESETS = \{(.*?)\n\}", config_py, re.S)
    skies = set(re.findall(r'^\s*"(\w+)":', m.group(1), re.M)) if m else set()
    if skies and dropdown("SKY_PRESET") != skies:
        errors.append(f"SKY_PRESET: dropdown {sorted(dropdown('SKY_PRESET'))} != code {sorted(skies)}")

    if (root.findtext("Repository") or "").strip() != IMAGE:
        errors.append(f"Repository: expected {IMAGE}")
    m = re.search(r"^EXPOSE (\d+)", (ROOT / "Dockerfile").read_text(), re.M)
    port = m.group(1) if m else None
    if port and [p.get("Target") for p in ports] != [port]:
        errors.append(f"Port: template container ports {[p.get('Target') for p in ports]} != Dockerfile EXPOSE {port}")
    if port and f"[PORT:{port}]" not in (root.findtext("WebUI") or ""):
        errors.append(f"WebUI: should use [PORT:{port}]")
    return errors


def main() -> None:
    src = sys.argv[1] if len(sys.argv) > 1 else TEMPLATE_URL
    errors = check(load_template(src), code_env())
    if errors:
        print(f"Unraid template is out of sync with the code ({src}):")
        for e in errors:
            print(f"  - {e}")
        print("Update templates/ph-intercept.xml in m00grin/unraid-templates (local clone: ~/unraid-templates).")
        sys.exit(1)
    print(f"Unraid template matches the code ({src}).")


if __name__ == "__main__":
    main()
