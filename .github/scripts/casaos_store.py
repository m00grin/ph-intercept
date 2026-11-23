import argparse
import json
import re
import shutil
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from unraid_template_check import code_env, required

ROOT = Path(__file__).resolve().parents[2]
APP_DIR = ROOT / "casaos"
COMPOSE = APP_DIR / "docker-compose.yml"
CHANGELOG = ROOT / "CHANGELOG.md"

SERVICE = "ph-intercept"
APP_ID = "io.github.m00grin.phintercept"
IMAGE = "m00grin/ph-intercept"
CDN = "https://cdn.jsdelivr.net/gh/IceWhaleTech/CasaOS-AppStore@main/Apps/ph-intercept/"
DATA_SOURCE = "/DATA/AppData/$AppID/bg"
BG_TARGET = "/app/static/bg"

ASSETS = {
    "icon.png": APP_DIR / "icon.png",
    "thumbnail.png": ROOT / "docs" / "brand" / "social-preview.png",
    "screenshot-1.png": ROOT / "docs" / "screenshot-starfield.png",
    "screenshot-2.png": ROOT / "docs" / "screenshot-nebula.png",
    "screenshot-3.png": ROOT / "docs" / "screenshot-outrun.png",
}

CATEGORIES = {"Media", "Productivity", "Home", "Networking", "AI", "Finance", "Social", "Developer", "Others"}
STORE_ARCH = {"linux/amd64": "amd64", "linux/arm64": "arm64", "linux/arm/v7": "arm", "linux/386": "386"}
NAME_RE = re.compile(r"^[a-z0-9_-]+$")
ID_RE = re.compile(r"^(?=[a-z0-9._-]*\.)[a-z0-9]+(?:[._-][a-z0-9]+)*$")
SEMVER = re.compile(r"\d+\.\d+\.\d+")
ENV_NAME = re.compile(r"\b[A-Z][A-Z0-9]*_[A-Z0-9_]*[A-Z0-9]\b")
SECRET = re.compile(r"PASSWORD|TOKEN|TOTP")
USER_SUPPLIED = {"PIHOLE_URL", "ADGUARD_URL", "TECHNITIUM_URL", "BLOCKER_URL"}
ESSENTIAL = {"BLOCKER_URL", "BLOCKER_PASSWORD", "BLOCKER_USERNAME", "BLOCKER_TOKEN", "BG_IMAGE"}
MIB = 1024 * 1024


def load_yaml(text: str) -> dict:
    from ruamel.yaml import YAML
    return YAML(typ="safe").load(text)


def changelog_versions() -> list[tuple[str, str, str]]:
    text = CHANGELOG.read_text()
    heads = list(re.finditer(r"^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})[^\n]*\n", text, re.M))
    out = []
    for i, m in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
        out.append((m.group(1), m.group(2), text[m.end():end]))
    if not out:
        raise SystemExit("CHANGELOG.md has no released versions.")
    return out


def release(version: str) -> tuple[str, str]:
    for v, date, body in changelog_versions():
        if v == version:
            return date, body
    raise SystemExit(f"CHANGELOG.md has no [{version}] section.")


def release_notes(version: str) -> str:
    _, body = release(version)
    parts = []
    for head, section in re.findall(r"^### (\w[\w ]*)\s*\n(.*?)(?=^### |\Z)", body, re.S | re.M):
        titles = []
        for title in re.findall(r"^- \*\*(.+?)\*\*", section, re.M):
            title = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", title).replace("`", "")
            titles.append(title.strip(" .:-"))
        if titles:
            parts.append(f"{head.strip()}: {'; '.join(titles)}.")
    if not parts:
        raise SystemExit(f"CHANGELOG.md [{version}] has no '- **Title**' bullets to build store release notes from.")
    return " ".join(parts)


def replace_once(text: str, pattern: str, repl: str, what: str) -> str:
    new, n = re.subn(pattern, lambda _: repl, text, flags=re.M)
    if n != 1:
        raise SystemExit(f"Expected exactly one {what} in {COMPOSE.relative_to(ROOT)}, found {n}.")
    return new


def compose_version(text: str) -> str:
    return required(r'^  version: "(\d+\.\d+\.\d+)"$', text, "x-casaos.version", re.M).group(1)


def bump(version: str) -> None:
    if not SEMVER.fullmatch(version):
        raise SystemExit(f"{version!r} is not X.Y.Z.")
    date, _ = release(version)
    text = COMPOSE.read_text()
    text = replace_once(text, rf"^    image: {re.escape(IMAGE)}:\S+$", f"    image: {IMAGE}:{version}", "image line")
    text = replace_once(text, r'^  version: "[^"]*"$', f'  version: "{version}"', "x-casaos.version")
    text = replace_once(text, r'^  update_at: "[^"]*"$', f'  update_at: "{date}"', "x-casaos.update_at")
    notes = json.dumps(release_notes(version), ensure_ascii=False)
    text = replace_once(text, r"^  release_notes:\n    en_US: .*$", f"  release_notes:\n    en_US: {notes}", "release_notes")
    COMPOSE.write_text(text)
    print(f"{COMPOSE.relative_to(ROOT)} now targets {version} ({date}).")


def png_size(path: Path) -> tuple[int, int] | None:
    head = path.read_bytes()[:24]
    if head[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", head[16:24])


def render(out: Path, expect: str | None, store: bool) -> None:
    text = COMPOSE.read_text()
    version = compose_version(text)
    if expect and version != expect:
        raise SystemExit(f"casaos/docker-compose.yml is at {version}, expected {expect}. Run the bump step from RELEASING.md.")
    app = out / "Apps" / SERVICE
    if app.exists():
        shutil.rmtree(app)
    app.mkdir(parents=True)
    (app / "docker-compose.yml").write_text(text)
    for name, src in ASSETS.items():
        shutil.copyfile(src, app / name)
    if store:
        (out / "store-config.json").write_text(json.dumps({
            "version": 2, "store_id": "ph-intercept-ci", "name": {"en_US": "ph-intercept CI store"},
            "description": {"en_US": "Throwaway store built by ph-intercept CI."},
            "maintainer": "m00grin", "url": "https://github.com/m00grin/ph-intercept",
        }, indent=2) + "\n")
        (out / "supported-languages.json").write_text('["en_US"]\n')
    print(f"Rendered {SERVICE} {version} into {app}")


def ci_compose(out: Path, image: str, name: str) -> None:
    from ruamel.yaml import YAML
    yaml = YAML()
    doc = yaml.load(COMPOSE.read_text())
    svc = doc["services"][SERVICE]
    svc["image"] = image
    svc["container_name"] = name
    svc["ports"] = [{"target": svc["ports"][0]["target"], "host_ip": "127.0.0.1", "published": "", "protocol": "tcp"}]
    (out / "bg").mkdir(parents=True, exist_ok=True)
    svc["volumes"][0]["source"] = str((out / "bg").resolve())
    with open(out / "docker-compose.yml", "w") as f:
        yaml.dump(doc, f)
    print(f"CI copy written to {out / 'docker-compose.yml'}")


def mem(value) -> int:
    m = re.fullmatch(r"(\d+)([kKmMgG]?)", str(value))
    if not m:
        return -1
    return int(m.group(1)) * {"": 1, "k": 1024, "m": MIB, "g": 1024 * MIB}[m.group(2).lower()]


def text_of(value) -> str:
    return value.get("en_US", "") if isinstance(value, dict) else (value or "")


def check() -> list[str]:
    errors: list[str] = []
    raw = COMPOSE.read_text()
    doc = load_yaml(raw)
    env_code = code_env()
    config_py = (ROOT / "core" / "config.py").read_text()
    readme = (ROOT / "README.md").read_text()

    if doc.get("name") != SERVICE or not NAME_RE.fullmatch(str(doc.get("name"))):
        errors.append(f"name: expected {SERVICE!r}")
    services = doc.get("services") or {}
    if list(services) != [SERVICE]:
        errors.append(f"services: expected exactly [{SERVICE!r}], got {list(services)}")
        return errors
    svc = services[SERVICE]
    x = doc.get("x-casaos") or {}
    sx = svc.get("x-casaos") or {}

    if x.get("id") != APP_ID or not ID_RE.fullmatch(str(x.get("id"))):
        errors.append(f"x-casaos.id: expected {APP_ID!r}")
    if x.get("main") != SERVICE:
        errors.append(f"x-casaos.main: expected {SERVICE!r}")
    if x.get("index") != "/" or x.get("scheme") != "http":
        errors.append("x-casaos.index/scheme: expected '/' and 'http'")
    if x.get("category") not in CATEGORIES:
        errors.append(f"x-casaos.category: {x.get('category')!r} is not a store category {sorted(CATEGORIES)}")
    for field in ("title", "tagline", "description"):
        if not text_of(x.get(field)).strip():
            errors.append(f"x-casaos.{field}: needs en_US text")
    for field in ("author", "developer", "repo", "support", "docs", "website"):
        if not str(x.get(field) or "").strip():
            errors.append(f"x-casaos.{field}: missing")

    version = str(x.get("version", ""))
    latest, latest_date, _ = changelog_versions()[0]
    if not SEMVER.fullmatch(version):
        errors.append(f"x-casaos.version: {version!r} is not X.Y.Z")
    elif version != latest:
        errors.append(f"x-casaos.version: {version} but CHANGELOG.md is at {latest}; run the bump step from RELEASING.md")
    else:
        if svc.get("image") != f"{IMAGE}:{version}":
            errors.append(f"image: expected {IMAGE}:{version}, got {svc.get('image')}")
        if str(x.get("update_at")) != latest_date:
            errors.append(f"x-casaos.update_at: expected the changelog date {latest_date}")
        if text_of(x.get("release_notes")) != release_notes(version):
            errors.append("x-casaos.release_notes: out of date with CHANGELOG.md; run the bump step from RELEASING.md")

    platforms = required(r"platforms: (\S+)", (ROOT / ".github" / "workflows" / "publish.yml").read_text(), "publish.yml platforms").group(1).split(",")
    published = {STORE_ARCH[p] for p in platforms if p in STORE_ARCH}
    archs = set(x.get("architectures") or [])
    if not {"amd64", "arm64"} <= archs:
        errors.append("x-casaos.architectures: must include amd64 and arm64")
    if archs - published:
        errors.append(f"x-casaos.architectures: {sorted(archs - published)} not built by publish.yml")

    port = required(r"^EXPOSE (\d+)", (ROOT / "Dockerfile").read_text(), "EXPOSE in the Dockerfile", re.M).group(1)
    ports = svc.get("ports") or []
    if len(ports) != 1 or str(ports[0].get("target")) != port or str(ports[0].get("published")) != port:
        errors.append(f"ports: expected one {port}:{port} mapping")
    if not isinstance(x.get("port_map"), str) or x.get("port_map") != port:
        errors.append(f"x-casaos.port_map: expected the string {port!r}")
    if [str(p.get("container")) for p in sx.get("ports") or []] != [port]:
        errors.append(f"services.x-casaos.ports: expected a description for {port}")

    vols = svc.get("volumes") or []
    if len(vols) != 1 or vols[0].get("type") != "bind" or vols[0].get("source") != DATA_SOURCE or vols[0].get("target") != BG_TARGET:
        errors.append(f"volumes: expected one bind {DATA_SOURCE} -> {BG_TARGET}")
    elif vols[0].get("read_only") is not True:
        errors.append("volumes: the backgrounds folder must be read_only: true; the app only reads it")
    if 'Mount("/bg"' not in (ROOT / "app.py").read_text():
        errors.append("app.py no longer serves /bg; the backgrounds folder and BG_IMAGE text need updating")
    if [v.get("container") for v in sx.get("volumes") or []] != [BG_TARGET]:
        errors.append(f"services.x-casaos.volumes: expected a description for {BG_TARGET}")

    if svc.get("cap_drop") != ["ALL"]:
        errors.append("cap_drop: expected [ALL]")
    if "no-new-privileges:true" not in (svc.get("security_opt") or []):
        errors.append("security_opt: expected no-new-privileges:true")
    if svc.get("privileged") or svc.get("network_mode") != "bridge" or svc.get("restart") != "unless-stopped":
        errors.append("service: expected unprivileged, network_mode bridge, restart unless-stopped")
    res = (svc.get("deploy") or {}).get("resources") or {}
    limit, reserve = mem((res.get("limits") or {}).get("memory")), mem((res.get("reservations") or {}).get("memory"))
    if limit <= 0 or reserve <= 0 or reserve > limit:
        errors.append("deploy.resources: needs a memory limit and a smaller memory reservation")
    pids = (res.get("limits") or {}).get("pids")
    if not isinstance(pids, int) or not 0 < pids <= 64:
        errors.append("deploy.resources.limits.pids: needs a process limit (the other installs use 20)")

    env = {k: ("" if v is None else str(v)) for k, v in (svc.get("environment") or {}).items()}
    for name in sorted(ESSENTIAL - set(env)):
        errors.append(f"{name}: should be in the install form")
    for name in sorted(set(env) - set(env_code)):
        errors.append(f"{name}: in the app file but the code no longer reads it")
    for name, value in sorted(env.items()):
        if SECRET.search(name) and value:
            errors.append(f"{name}: secrets must ship blank")
        default = env_code.get(name)
        if name in env_code and default is not None and name not in USER_SUPPLIED and value.lower() != default.strip().lower():
            errors.append(f"{name}: value {value!r} differs from the code default {default!r}")
    settings_py = (ROOT / "core" / "settings.py").read_text()
    providers = set(re.findall(r'"(\w+)"', required(r"^PROVIDERS = \(([^)]*)\)", settings_py, "the PROVIDERS list", re.M).group(1)))
    if "PROVIDER" in env and env["PROVIDER"] not in providers:
        errors.append(f"PROVIDER: {env.get('PROVIDER')!r} is not one of {sorted(providers)}")
    skies = set(re.findall(r'^\s*"(\w+)":', required(r"SKY_PRESETS = \{(.*?)\n\}", config_py, "SKY_PRESETS", re.S).group(1), re.M))
    if "SKY_PRESET" in env and env["SKY_PRESET"] not in skies:
        errors.append(f"SKY_PRESET: {env['SKY_PRESET']!r} is not one of {sorted(skies)}")
    described = {e.get("container"): text_of(e.get("description")) for e in sx.get("envs") or []}
    for name in sorted(set(env) - set(described)):
        errors.append(f"{name}: needs a description under services.x-casaos.envs")
    for name in sorted(set(described) - set(env)):
        errors.append(f"{name}: described but not in environment")
    for name, desc in described.items():
        if not desc.strip():
            errors.append(f"{name}: empty description")

    prose = {
        "description": text_of(x.get("description")),
        "tips": text_of((x.get("tips") or {}).get("before_install")),
        **{f"{n} description": d for n, d in described.items()},
    }
    for where, body in prose.items():
        for name in sorted(set(ENV_NAME.findall(body)) - set(env)):
            errors.append(f"{where}: mentions {name}, which is not in the install form")
    for where in ("description", "tips"):
        for name in ("BLOCKER_URL", "BLOCKER_PASSWORD", "BLOCKER_USERNAME", "BLOCKER_TOKEN"):
            if name not in prose[where]:
                errors.append(f"{where}: setup steps should mention {name}")
    for link in re.findall(r"\]\((https://github\.com/m00grin/ph-intercept[^)]*)\)", prose["description"]):
        path = re.sub(r"^https://github\.com/m00grin/ph-intercept(?:/blob/main/)?", "", link)
        file, _, anchor = path.partition("#")
        target = ROOT / file if file else ROOT / "README.md"
        if file and not target.exists():
            errors.append(f"description: links to {file}, which does not exist")
        elif anchor and anchor not in {re.sub(r"[^a-z0-9 -]", "", h.lower()).replace(" ", "-") for h in re.findall(r"^#+ (.+)$", target.read_text(), re.M)}:
            errors.append(f"description: links to #{anchor}, which is not a heading in {target.name}")
    if "#configuration" in prose["description"] and "## Configuration" not in readme:
        errors.append("description: README.md lost its Configuration section")

    expected = {"icon": CDN + "icon.png", "thumbnail": CDN + "thumbnail.png"}
    for field, url in expected.items():
        if x.get(field) != url:
            errors.append(f"x-casaos.{field}: expected {url}")
    shots = [CDN + n for n in ASSETS if n.startswith("screenshot-")]
    if list(x.get("screenshot_link") or []) != shots:
        errors.append(f"x-casaos.screenshot_link: expected {shots}")
    for name, src in ASSETS.items():
        size = png_size(src) if src.exists() else None
        if size is None:
            errors.append(f"{src.relative_to(ROOT)}: missing or not a PNG (store asset {name})")
        elif name == "icon.png" and (size[0] != size[1] or size[0] < 256):
            errors.append(f"casaos/icon.png: should be square and at least 256 px, is {size[0]}x{size[1]}")
        elif name.startswith("screenshot-") and size[0] < 1024:
            errors.append(f"{src.relative_to(ROOT)}: screenshots should be at least 1024 px wide")
    if raw.count("\t"):
        errors.append("docker-compose.yml: contains tabs")
    return errors


def verify_dist(dist: Path) -> list[str]:
    errors: list[str] = []
    doc = load_yaml(COMPOSE.read_text())
    version = str(doc["x-casaos"]["version"])
    app = dist / "apps" / APP_ID
    try:
        meta = json.loads((app / "meta.json").read_text())
        index = json.loads((dist / "index.json").read_text())
    except (OSError, ValueError) as e:
        return [f"built store is incomplete: {e}"]
    listed = [a for a in index.get("apps", []) if a.get("id") == APP_ID]
    if len(listed) != 1:
        errors.append(f"index.json: expected one {APP_ID} entry")
    if meta.get("version") != version:
        errors.append(f"meta.json: version {meta.get('version')!r} != {version}")
    reserve = mem(doc["services"][SERVICE]["deploy"]["resources"]["reservations"]["memory"])
    if meta.get("min_memory") != reserve:
        errors.append(f"meta.json: min_memory {meta.get('min_memory')} != the {reserve // MIB} MiB reservation")
    if len(meta.get("screenshot_link") or []) != 3 or not meta.get("thumbnail"):
        errors.append("meta.json: expected a thumbnail and 3 screenshots")
    if not meta.get("tips", {}).get("before_install") or not meta.get("release_note"):
        errors.append("meta.json: tips or release notes missing")
    for asset in [meta.get("thumbnail", ""), *meta.get("screenshot_link", [])]:
        if asset and not (dist / asset.lstrip("/")).exists():
            errors.append(f"built asset missing: {asset}")
    if not list((app / "assets").glob("icon.*")):
        errors.append("built icon missing")
    for arch in doc["x-casaos"]["architectures"]:
        f = app / f"docker-compose.{arch}.yml"
        if not f.exists():
            errors.append(f"missing built compose for {arch}")
        elif not re.search(rf"image: {re.escape(IMAGE)}:{re.escape(version)}@sha256:[0-9a-f]{{64}}", f.read_text()):
            errors.append(f"docker-compose.{arch}.yml: image is not pinned to {version} by digest (is {version} on Docker Hub?)")
    return errors


def platforms() -> list[str]:
    block = required(r"^  architectures:\n((?:    - \S+\n)+)", COMPOSE.read_text(), "x-casaos.architectures", re.M).group(1)
    by_arch = {arch: plat for plat, arch in STORE_ARCH.items()}
    return [by_arch[a] for a in re.findall(r"- (\S+)", block)]


def report(errors: list[str], ok: str, bad: str) -> None:
    if errors:
        print(bad)
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    print(ok)


def main() -> None:
    p = argparse.ArgumentParser(description="CasaOS and ZimaOS app store tooling for ph-intercept.")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    b = sub.add_parser("bump")
    b.add_argument("version")
    n = sub.add_parser("notes")
    n.add_argument("version", nargs="?")
    r = sub.add_parser("render")
    r.add_argument("out", type=Path)
    r.add_argument("--expect-version")
    r.add_argument("--store", action="store_true")
    c = sub.add_parser("ci-compose")
    c.add_argument("out", type=Path)
    c.add_argument("--image", required=True)
    c.add_argument("--name", required=True)
    v = sub.add_parser("verify-dist")
    v.add_argument("dist", type=Path)
    sub.add_parser("platforms")
    a = p.parse_args()

    if a.cmd == "check":
        report(check(), "casaos/docker-compose.yml matches the code.", "casaos/docker-compose.yml is out of sync with the code:")
    elif a.cmd == "bump":
        bump(a.version)
    elif a.cmd == "notes":
        print(release_notes(a.version or compose_version(COMPOSE.read_text())))
    elif a.cmd == "render":
        render(a.out, a.expect_version, a.store)
    elif a.cmd == "ci-compose":
        ci_compose(a.out, a.image, a.name)
    elif a.cmd == "verify-dist":
        report(verify_dist(a.dist), "The built store listing looks right.", "The built store listing has problems:")
    elif a.cmd == "platforms":
        print("\n".join(platforms()))


if __name__ == "__main__":
    main()
