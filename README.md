# ph-intercept

A Pi-hole DNS dashboard that runs as a standalone Docker container. It connects to your Pi-hole v6 API, streams live DNS query events, and renders them as pixel-art friendlies and baddies with the query domain as a text label.

Blocked queries become enemies that the ship destroys. Allowed queries appear as friendly ships that pass through. From the HUD you can toggle Pi-hole blocking on and off, set a timed block, trigger a gravity list update, and switch which ship is displayed.

Designed to be dropped in alongside an existing Pi-hole v6 setup with no extra dependencies.

---

## What it shows

ph-intercept streams live DNS query events from the Pi-hole v6 API. Each event spawns an entity on screen whose appearance depends on the query status, how many times that domain has appeared recently, and whether Pi-hole answered from cache or had to go upstream.

---

## Friendlies: allowed queries

Allowed queries appear as friendly ships traveling across the screen. Their shape and color depend on how many times the same domain has been allowed within a recent window:

| Tier | Condition | Bitmap | Shape | Color |
|------|-----------|--------|-------|-------|
| 1 | First sighting of a domain | F0, F1, or F2 (random) | Rounded shuttle · Delta wing · X-wing | Green · Blue · Lime |
| 2 | Same domain seen twice | F3 (heavy transport) | Wider, blockier silhouette | Cyan |
| 3+ | Three or more hits | F4 (capital ship) | Largest, widest hull | Gold |

**Cache vs. upstream speed:** Pi-hole can answer queries from its local cache or by forwarding upstream. Cache-answered queries appear as faster-moving ships. Upstream-answered queries move more slowly. Same shape, same color; only the pace differs.

---

## Baddies: blocked queries

Blocked queries are the threats. The ship targets and destroys them. Their shape and color reflect how many times that domain has been blocked recently.

If a domain is blocked again while its entity is still on screen, it mutates: the existing sprite upgrades to the next tier in place, flashing and emitting a burst of particles as it changes shape. A single query that becomes a repeat offender can escalate from a tier-1 crab all the way to a tier-3 boss without ever leaving the field.

| Tier | Condition | Bitmap | Shape | Color |
|------|-----------|--------|-------|-------|
| 1 | First block of a domain | E0 or E1 (random) | Classic crab invader · Squid | Red |
| 2 | Same domain blocked twice | E2 (heavy drone) | Wider, denser silhouette | Orange |
| 3+ | Three or more blocks | E3 (boss) | Largest, most complex form | Purple |

Laser color also tracks tier: green bolts for tier 1, cyan for tier 2, gold for tier 3+.

---

## The ship

The ship operates autonomously: it scans for threats, picks a target, and fires.

When the threat count climbs high enough, a support drone launches and takes up a flanking position beside the ship. It targets blocked entities independently and fires its own missiles. When the threat count drops back down, the drone is recalled.

Three ships are available, selectable from the HUD ship panel. All three are hand-drawn pixel-art bitmaps:

**Protector** (default): based on the NSEA Protector. 21×17 pixels.

**Falcon**: based on the Millennium Falcon. 15×17 pixels.

**Enterprise**: based on the Enterprise NCC-1701. XX×XX pixels. *in-development*

Switching ships triggers a warp-out/warp-in transition. The current ship warps out of frame, pushing entities in its path a bit, and the new ship warps in from the bottom.

---

## The HUD

A strip across the bottom of the screen, divided into four panels:

**INTERCEPT** — Pi-hole blocking status and toggle. Click to open a menu with timed-disable options (10 sec, 30 sec, 5 min) or a full disable. Status reads ACTIVE, ONLINE, OFFLINE, STARTING, or POWERING DOWN. When a timed disable is running, a countdown is shown. The timer survives navigation: if you leave and return, the remaining time is restored from session storage.

**STATS** — Four columns: total query count, blocked query count, allowed query count, and block percentage. Pulled from the Pi-hole API on load, kept live while ph-intercept is open.

**GRAVITY** — Shows the current gravity list size. The arrow icon triggers a gravity list update. The display animates while the update runs and confirms when done.

**SHIPS** — Shows the active ship name. Click to open the ship selector. Three ships are available: Protector, Falcon, and Enterprise (in development). Switching ships triggers the warp-out/warp-in transition.

---

## The background

When `BG_MODE=starfield`, the background is a real section of the night sky rendered from an accurate star catalog. Positions are projected using equatorial coordinates (right ascension and declination). What you see is where the stars actually are.

Star data is from the **HYG Database** compiled by David Nash ([astronexus.com](https://astronexus.com)), which combines the Hipparcos catalog (ESA) and the Yale Bright Star Catalogue (Hoffleit & Warren).

*This background element was originally built for my custom homelab dashboard, where it has pan/zoom and info tooltips for stellar objects. ph-intercept uses a fixed-view version of the same renderer.*

The dataset is pre-built and included in the image so no build step is needed.

**Stars:** approximately 12,200 stars down to magnitude 6.8, color-coded by spectral type, with multi-layer brightness flicker simulation.

**Deep sky objects rendered:**

| Type | Objects included |
|------|-----------------|
| Emission nebulae | Lagoon, Trifid, Omega, Eagle, Crescent, North America |
| Planetary nebulae | Ring, Dumbbell, Helix |
| Supernova remnants | Eastern Veil, Western Veil (Cygnus Loop) |
| Globular clusters | M2, M4, M5, M10, M12, M13, M14, M15, M19, M22, M28, M54, M55, M56, M62, M69, M70, M71, M72, M75, M80, M92, M107, and more |
| Open clusters | M6 (Butterfly), M7 (Ptolemy's Cluster), and others |

Extended objects are rendered with correct position angles and aspect ratios. Globular clusters use density-falloff particle rendering.

**Planets:** Mars, Jupiter, Saturn (with ring), and the Moon are computed from real orbital elements using Kepler's equation, updated hourly. They appear at their actual sky positions for today's date.

**Transients:** occasional satellite passes and meteors animate across the sky. The ISS is included with its characteristic brightness and glow profile.

---

## Setup

**1. Create a `.env` file** in the same directory as `compose.yaml`:

```
PIHOLE_PASSWORD=your_pihole_password
```

This is your Pi-hole web interface password. If you haven't set one or need to use an app password, see the [Pi-hole API authentication docs](https://docs.pi-hole.net/api/auth/) (Settings → Web Interface/API → Configure app password).

**2. Edit `compose.yaml`** to match your network. The settings are documented inline. At minimum, set `PIHOLE_URL` to your Pi-hole's address.

**3. Build and start:**

```bash
docker compose up -d --build
```

The app runs on port 4653 by default.

---

## Configuration

All configuration is done via environment variables in `compose.yaml`. The `core/config.py` file reads those variables and does not need to be edited.

### Required

| Variable | Description |
|----------|-------------|
| `PIHOLE_PASSWORD` | Pi-hole web password (set in `.env`, not compose.yaml) — [how to set/find it](https://docs.pi-hole.net/api/auth/) |
| `PIHOLE_URL` | Pi-hole v6 API base URL, e.g. `http://192.168.1.x:8053/api` |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `RETURN_URL` | *(empty)* | URL that Escape navigates to. Set this to your dashboard if you have one. Leave blank to restart on Escape instead. |
| `BG_MODE` | `starfield` | Background style. See options below. |
| `SKY_PRESET` | `summer_triangle` | Sky region to display when `BG_MODE=starfield`. |
| `BG_IMAGE` | *(empty)* | Image URL or `/static/` path. Only used when `BG_MODE=image`. |

### Background modes

| Value | Description |
|-------|-------------|
| `starfield` | Real star positions from the included catalog, with deep sky objects and planets. |
| `dark` | Plain dark background, no rendering overhead. |
| `nebula` | Procedurally generated nebula using seeded value noise. Looks different each session. |
| `image` | A custom image you supply via `BG_IMAGE`. |

### Sky presets

Used when `BG_MODE=starfield`. Each preset centers the view on a recognizable region of the sky.

| Value | Region |
|-------|--------|
| `summer_triangle` | Vega, Deneb, Altair and surrounding summer Milky Way |
| `orion` | Orion, Taurus, and the winter sky |
| `scorpius` | Scorpius and the galactic center |
| `southern_cross` | Crux and the southern Milky Way |

---

## Stats accuracy and API speed

Stats shown in the HUD (queries, blocked count, block percentage, gravity list size) come directly from the Pi-hole v6 API. They are fetched on load and are a point-in-time snapshot.

Live DNS query events are delivered via a continuous server-sent events stream polled from Pi-hole in real time. What appears on screen reflects actual DNS activity as it happens; there is no aggregation delay. The backend uses a 1.5-second API timeout, so a slow or unreachable Pi-hole will not hang the interface.

Block toggle and timed-block changes take effect immediately via the Pi-hole API. If you set a timed block and navigate away, the remaining time is preserved in session storage and restored when you return.

---

## Requirements

- Pi-hole v6 (the v6 API is required; v5 is not compatible)
- Docker with Compose
- A network route from the container to your Pi-hole

---

## Ports and networking

The container listens on port 4653. The compose file includes an example static IP configuration for use on an existing Docker network. Remove the `networks` block if you do not need a static address.
