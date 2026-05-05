import os

PIHOLE_BASE = os.environ.get("PIHOLE_URL", "http://pihole:8053/api")
PIHOLE_DASHBOARD = PIHOLE_BASE.rstrip('/').removesuffix('/api') + '/admin'
RETURN_URL  = os.environ.get("RETURN_URL", "")
BG_IMAGE    = os.environ.get("BG_IMAGE", "")
BG_MODE     = "image" if BG_IMAGE else os.environ.get("BG_MODE", "starfield").lower()
SKY_PRESET  = os.environ.get("SKY_PRESET", "summer_triangle").lower()

SKY_PRESETS = {
    "summer_triangle": {"ra": 19.27, "dec": 15.86, "label": "Summer Triangle"},
    "orion":           {"ra":  5.60, "dec":  0.00, "label": "Orion"},
    "scorpius":        {"ra": 17.00, "dec": -30.0,  "label": "Scorpius"},
    "southern_cross":  {"ra": 12.47, "dec": -60.0,  "label": "Southern Cross"},
}
