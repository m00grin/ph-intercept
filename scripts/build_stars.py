"""
Regenerate static/stars-lite.json from a full Hipparcos/YBS star catalog.

stars-lite.json is already committed to the repo. You only need this script
if you want to regenerate it from a different source catalog.

Usage (run from the ph-intercept/ root):
    python scripts/build_stars.py --src PATH/TO/stars.json [--mag LIMIT] [--out PATH]

Defaults:
    --mag  6.8  (includes all naked-eye stars + a comfortable margin)
    --out  static/stars-lite.json

The output format is { stars, bounds, info, colors } -- the same as the
source catalog so starfield-lite.js can consume it without modification.

Cluster members are intentionally excluded -- DSOs are rendered as gradient
glows and do not need individual member positions.
"""

import argparse
import json
import pathlib


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--src", required=True, help="Path to source stars.json catalog")
    p.add_argument("--mag", type=float, default=6.8)
    p.add_argument("--out", default="static/stars-lite.json")
    args = p.parse_args()

    src = pathlib.Path(args.src)
    out = pathlib.Path(args.out)

    print(f"Loading {src} ...")
    with src.open() as f:
        data = json.load(f)

    all_stars = data["stars"]
    before = len(all_stars)
    filtered = [s for s in all_stars if s[3] <= args.mag]
    after = len(filtered)
    print(f"Stars: {before:,} -> {after:,}  (mag <= {args.mag})")

    # Recompute tight bounds from the filtered set so the renderer doesn't
    # try to clamp pan to regions that no longer have any star data.
    ra_vals = [s[1] for s in filtered]
    dec_vals = [s[2] for s in filtered]
    bounds = {
        "ra_min": min(ra_vals),
        "ra_max": max(ra_vals),
        "dec_min": min(dec_vals),
        "dec_max": max(dec_vals),
    }

    out_data = {
        "stars": filtered,
        "bounds": bounds,
        "info": data.get("info", {}),
        "colors": data.get("colors", {}),
    }

    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w") as f:
        json.dump(out_data, f, separators=(",", ":"))

    size_kb = out.stat().st_size / 1024
    print(f"Written to {out}  ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
