import re
import subprocess
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPO = "m00grin/unraid-templates"
RAW = f"https://raw.githubusercontent.com/{REPO}"
TEMPLATE_PATH = "templates/ph-intercept.xml"
TEMPLATE_URL = f"{RAW}/main/{TEMPLATE_PATH}"
IMAGE = "m00grin/ph-intercept:latest"

OMIT = {
    "TECHNITIUM2_QUERY_LOG_APP": "inherits the primary value when unset; a blank Unraid field would override that",
    "TECHNITIUM2_QUERY_LOG_CLASS": "inherits the primary value when unset; a blank Unraid field would override that",
}

USER_SUPPLIED = {"PIHOLE_URL", "ADGUARD_URL", "TECHNITIUM_URL", "BLOCKER_URL"}


def legacy_names() -> set[str]:
    """Pre-1.6 names that a BLOCKER_* name now covers. New installs get the BLOCKER_*
    fields, so these may be left out of the template; Unraid never rewrites an installed
    container's saved template, so existing installs keep theirs."""
    sys.path.insert(0, str(ROOT))
    from core.settings import SPEC
    names = {"PROVIDER"}
    for spec in SPEC.values():
        for slot in ("", "2"):
            names |= {f"{spec['prefix']}{slot}_{suffix}" for suffix in spec["fields"].values()}
            names |= {f"{spec['prefix']}_IGNORE_DOMAINS", f"{spec['prefix']}_IGNORE_CLIENTS"}
    return names
SECRET = re.compile(r"PASSWORD|TOKEN|TOTP")

ENV_READ = re.compile(r"""(?:os\.(?:environ\.get|getenv)|_env\.get)\(\s*["']([A-Z0-9_]+)["']\s*(?:,\s*(["'])(.*?)\2)?""")
NEUTRAL_ENV = re.compile(r'"(BLOCKER2?_[A-Z0-9_]+)": "([^"]*)"')


class FetchError(Exception):
    pass


def code_env() -> dict[str, str | None]:
    found: dict[str, str | None] = {}
    for path in [ROOT / "app.py", *sorted((ROOT / "core").glob("*.py"))]:
        for m in ENV_READ.finditer(path.read_text()):
            name, default = m.group(1), m.group(3)
            if default is None and m.group(2) is None:
                found.setdefault(name, None)
            else:
                found[name] = default
    settings = (ROOT / "core" / "settings.py").read_text()
    block = required(r"^NEUTRAL_ENV = \{(.*?)^\}", settings, "NEUTRAL_ENV in core/settings.py", re.S | re.M).group(1)
    for name, default in NEUTRAL_ENV.findall(block):
        found[name] = default
    return found


def fetch(url: str) -> tuple[bytes, str]:
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            return r.read(), r.headers.get_content_type()
    except (urllib.error.URLError, TimeoutError) as e:
        raise FetchError(f"{url}: {e}") from e


def main_sha() -> str:
    out = subprocess.run(
        ["git", "ls-remote", f"https://github.com/{REPO}", "refs/heads/main"],
        capture_output=True, text=True, timeout=30,
    )
    sha = out.stdout.split()[0] if out.returncode == 0 and out.stdout else ""
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise FetchError(f"could not resolve {REPO} main: {out.stderr.strip() or 'no output'}")
    return sha


def required(pattern: str, text: str, what: str, flags: int = 0) -> re.Match:
    m = re.search(pattern, text, flags)
    if not m:
        raise SystemExit(f"Could not find {what}; update unraid_template_check.py to match the code.")
    return m


def check(root: ET.Element, env: dict[str, str | None]) -> list[str]:
    errors: list[str] = []
    configs = root.findall("Config")
    targets = [c.get("Target") for c in configs]
    variables = {c.get("Target"): c for c in configs if c.get("Type") == "Variable"}
    ports = [c for c in configs if c.get("Type") == "Port"]

    for tag in ("Name", "Repository", "Overview"):
        if not (root.findtext(tag) or "").strip():
            errors.append(f"{tag}: required by Community Apps but empty")
    if not ((root.findtext("Support") or "").strip() or (root.findtext("Project") or "").strip()):
        errors.append("Support/Project: Community Apps needs at least one")
    if (root.findtext("TemplateURL") or "").strip() != TEMPLATE_URL:
        errors.append(f"TemplateURL: expected {TEMPLATE_URL}")
    for dup in sorted({t for t in targets if targets.count(t) > 1}):
        errors.append(f"{dup}: listed more than once")

    for name in sorted(set(env) - set(variables) - set(OMIT) - legacy_names()):
        errors.append(f"{name}: read by the code but missing from the template")
    for name in sorted(set(variables) - set(env)):
        errors.append(f"{name}: in the template but the code no longer reads it")
    for name in sorted(set(OMIT) & set(variables)):
        errors.append(f"{name}: must stay out of the template ({OMIT[name]})")

    for name, c in sorted(variables.items()):
        if not (c.get("Description") or "").strip():
            errors.append(f"{name}: needs a description")
        if SECRET.search(name) and c.get("Mask") != "true":
            errors.append(f"{name}: secrets must be masked (Mask=\"true\")")
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
    settings_py = (ROOT / "core" / "settings.py").read_text()
    providers = set(re.findall(r'"(\w+)"', required(r"^PROVIDERS = \(([^)]*)\)", settings_py, "the PROVIDERS list", re.M).group(1)))
    if "PROVIDER" in variables and dropdown("PROVIDER") != providers:
        errors.append(f"PROVIDER: dropdown {sorted(dropdown('PROVIDER'))} != code {sorted(providers)}")
    for name in ("BLOCKER_TYPE", "BLOCKER2_TYPE"):
        if name in variables and len(dropdown(name)) > 1 and dropdown(name) - {""} != providers:
            errors.append(f"{name}: dropdown {sorted(dropdown(name))} != code {sorted(providers)} plus blank")
    sky_block = required(r"SKY_PRESETS = \{(.*?)\n\}", config_py, "SKY_PRESETS", re.S).group(1)
    skies = set(re.findall(r'^\s*"(\w+)":', sky_block, re.M))
    if dropdown("SKY_PRESET") != skies:
        errors.append(f"SKY_PRESET: dropdown {sorted(dropdown('SKY_PRESET'))} != code {sorted(skies)}")

    if (root.findtext("Repository") or "").strip() != IMAGE:
        errors.append(f"Repository: expected {IMAGE}")
    port = required(r"^EXPOSE (\d+)", (ROOT / "Dockerfile").read_text(), "EXPOSE in the Dockerfile", re.M).group(1)
    if [p.get("Target") for p in ports] != [port]:
        errors.append(f"Port: template container ports {[p.get('Target') for p in ports]} != Dockerfile EXPOSE {port}")
    if f"[PORT:{port}]" not in (root.findtext("WebUI") or ""):
        errors.append(f"WebUI: should use [PORT:{port}]")
    return errors


def check_published(root: ET.Element, sha: str) -> list[str]:
    errors: list[str] = []
    profile = ET.fromstring(fetch(f"{RAW}/{sha}/ca_profile.xml")[0])
    if not (profile.findtext("Profile") or "").strip():
        errors.append("ca_profile.xml: Profile is empty")
    for owner, tag in (("template", root.findtext("Icon")), ("ca_profile.xml", profile.findtext("Icon"))):
        url = (tag or "").strip()
        if not url:
            errors.append(f"{owner}: Icon is missing")
            continue
        try:
            _, ctype = fetch(url)
        except FetchError as e:
            errors.append(f"{owner}: Icon does not load ({e})")
            continue
        if not ctype.startswith("image/"):
            errors.append(f"{owner}: Icon is {ctype}, not an image")
    return errors


def main() -> None:
    try:
        if len(sys.argv) > 1:
            src, root, extra = sys.argv[1], ET.parse(sys.argv[1]).getroot(), []
        else:
            sha = main_sha()
            src = f"{REPO}@{sha[:7]}"
            root = ET.fromstring(fetch(f"{RAW}/{sha}/{TEMPLATE_PATH}")[0])
            extra = check_published(root, sha)
    except FetchError as e:
        print(f"Could not fetch the published template: {e}")
        sys.exit(2)
    errors = check(root, code_env()) + extra
    if errors:
        print(f"Unraid template is out of sync with the code ({src}):")
        for e in errors:
            print(f"  - {e}")
        print("Update templates/ph-intercept.xml in m00grin/unraid-templates (local clone: ~/unraid-templates).")
        sys.exit(1)
    print(f"Unraid template matches the code ({src}).")


if __name__ == "__main__":
    main()
