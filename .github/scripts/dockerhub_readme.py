#!/usr/bin/env python3
"""Build the Docker Hub README from the repo's three READMEs.

Docker Hub shows one README and caps it at 25,000 bytes. The GitHub README
sends AdGuard Home and Technitium users to their own guides, which would bounce
Docker Hub readers out to GitHub. This folds each guide's setup sections into
the page instead and points the links at them, so the whole install stays on
Docker Hub. Everything is pulled from the source files on each run, so it never
drifts: edit the READMEs as usual and this output follows.

Usage: dockerhub_readme.py OUTPUT_PATH
"""
import re
import sys
from pathlib import Path

LIMIT = 25_000  # Docker Hub's full-description cap, in bytes
BLOB = "https://github.com/m00grin/ph-intercept/blob/main/"
ROOT = Path(__file__).resolve().parents[2]

# (folder, heading on Docker Hub, sections to bring over, in order)
PROVIDERS = [
    ("adguard", "AdGuard Home setup", ["Quick Start"]),
    ("technitium", "Technitium DNS setup", ["What you need first", "Quick Start"]),
]
# GitHub-only sections left out of the Docker Hub page
DROP = ["Testing"]


def slug(title: str) -> str:
    # GitHub/Docker Hub style: lowercase, drop punctuation, spaces to hyphens.
    # Both renderers prefix heading ids with "user-content-".
    return "user-content-" + re.sub(r"[^\w\- ]", "", title.lower()).replace(" ", "-")


def split_sections(text: str):
    """Return (preamble, [(heading_line, body), ...]) split on '## ' headings outside code fences."""
    pre, sections, cur, fence = [], [], None, False
    for line in text.splitlines(keepends=True):
        if line.lstrip().startswith("```"):
            fence = not fence
        if not fence and line.startswith("## "):
            cur = [line, []]
            sections.append(cur)
        elif cur is None:
            pre.append(line)
        else:
            cur[1].append(line)
    return "".join(pre), [(h, "".join(b)) for h, b in sections]


def title_of(heading: str) -> str:
    return heading[3:].strip()


def demote(text: str) -> str:
    """Push every heading down one level, leaving code fences alone."""
    out, fence = [], False
    for line in text.splitlines(keepends=True):
        if line.lstrip().startswith("```"):
            fence = not fence
        if not fence and re.match(r"#{2,5} ", line):
            line = "#" + line
        out.append(line)
    return "".join(out)


def fenced_comments(text: str) -> set:
    """Comment lines (stripped) found inside code fences."""
    out, fence = set(), False
    for line in text.splitlines():
        if line.lstrip().startswith("```"):
            fence = not fence
        elif fence and line.strip().startswith("#"):
            out.add(line.strip())
    return out


def drop_shared_comments(text: str, shared: set) -> str:
    """Remove compose comment blocks that repeat the Pi-hole compose word for word.

    The guides re-explain shared options (background, return URL, ...). On one page
    those repeats push past Docker Hub's size cap, and the Pi-hole compose above
    already carries them. A run of comment lines is dropped only when every line in
    it is shared, so a provider-specific note never loses half its sentence.
    """
    out, fence, run = [], False, []

    def flush():
        if run and not all(l.strip() in shared for l in run):
            out.extend(run)
        run.clear()

    for line in text.splitlines(keepends=True):
        if line.lstrip().startswith("```"):
            flush()
            fence = not fence
            out.append(line)
        elif fence and line.strip().startswith("#"):
            run.append(line)
        else:
            flush()
            out.append(line)
    flush()
    return "".join(out)


def strip_trailing_rule(body: str) -> str:
    return re.sub(r"\n---\s*$", "\n", body.rstrip() + "\n")


def docker_hub_image(text: str) -> str:
    """Compose examples pull from Docker Hub on the Docker Hub page (same image as GHCR)."""
    out, fence = [], False
    for line in text.splitlines(keepends=True):
        if line.lstrip().startswith("```"):
            fence = not fence
        elif fence:
            line = line.replace("ghcr.io/m00grin/ph-intercept", "m00grin/ph-intercept")
        out.append(line)
    return "".join(out)


def fix_links(text: str) -> str:
    """Make every link work from Docker Hub.

    In-page anchors get Docker Hub's "user-content-" id prefix so they jump within
    the page; relative file links become absolute GitHub URLs. (The sync action's
    own URL completion would also send in-page anchors to GitHub, so it stays off.)
    """
    def repl(m):
        target = m.group(1)
        if target.startswith("#"):
            frag = target[1:]
            return f"](#{frag if frag.startswith('user-content-') else 'user-content-' + frag})"
        if re.match(r"[a-z][a-z0-9+.-]*:", target, re.I) or target.startswith("/"):
            return m.group(0)
        return f"]({BLOB}{target})"

    out, fence = [], False
    for line in text.splitlines(keepends=True):
        if line.lstrip().startswith("```"):
            fence = not fence
        elif not fence:
            line = re.sub(r"\]\(([^)\s]+)\)", repl, line)
        out.append(line)
    return "".join(out)


def build() -> str:
    main_text = (ROOT / "README.md").read_text()
    shared = fenced_comments(main_text)
    pre, sections = split_sections(main_text)
    sections = [(h, b) for h, b in sections if title_of(h) not in DROP]

    blocks = []
    for folder, heading, wanted in PROVIDERS:
        _, psecs = split_sections((ROOT / folder / "README.md").read_text())
        found = {title_of(h): (h, b) for h, b in psecs}
        missing = [w for w in wanted if w not in found]
        if missing:
            sys.exit(f"{folder}/README.md is missing section(s): {', '.join(missing)}")
        body = "".join(strip_trailing_rule(demote(found[w][0] + found[w][1])) + "\n" for w in wanted)
        body = drop_shared_comments(body, shared)
        note = ("> Compose comments shared with the Pi-hole setup are trimmed here. "
                "See the Pi-hole compose above for the full notes.\n\n")
        # Links inside a guide are relative to its folder.
        body = re.sub(r"\]\((?!https?:|#|/)([^)]+)\)", lambda m: f"]({folder}/{m.group(1)})", body)
        body = body.replace(f"]({folder}/../", "](")
        blocks.append(f"## {heading}\n\n{note}{body}\n---\n\n")
        # Point the main README's links at the in-page copy instead of the GitHub guide.
        # Deep links into the guide (e.g. its 2-player section) go to the in-page setup too:
        # that section's compose carries the same variables, commented.
        to_setup = lambda t: re.sub(rf"\]\({folder}/README\.md(#[^)]*)?\)", f"](#{slug(heading)})", t)
        pre = to_setup(pre)
        sections = [(h, to_setup(b)) for h, b in sections]

    out, inserted = [pre], False
    for h, b in sections:
        out.append(h + b)
        if not inserted and title_of(h) == "Quick Start":
            out.extend(blocks)
            inserted = True
    if not inserted:
        sys.exit("README.md has no '## Quick Start' section to anchor the provider setups after")
    return fix_links(docker_hub_image("".join(out)))


def main() -> None:
    text = build()
    size = len(text.encode())
    if size > LIMIT:
        sys.exit(f"Docker Hub README would be {size:,} bytes, over the {LIMIT:,} limit. Trim a section or add one to DROP.")
    Path(sys.argv[1]).write_text(text)
    print(f"Docker Hub README: {size:,} bytes (limit {LIMIT:,})")


if __name__ == "__main__":
    main()
