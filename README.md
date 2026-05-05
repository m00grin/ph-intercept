# ph-intercept

A Pi-hole DNS dashboard that runs as a standalone Docker container. Streams live DNS query events from your Pi-hole v6 API and renders them as pixel-art friendlies and enemies. Blocked queries are destroyed by the ship, allowed queries fly through. Toggle blocking, set timed blocks, trigger gravity updates, and switch ships from the HUD.

Designed to be dropped in alongside an existing Pi-hole v6 setup with no extra dependencies.

<img width="1711" height="1266" alt="action-shot" src="https://github.com/user-attachments/assets/cfc7044a-6394-40a1-b227-9c14e0f8156b" />



---

## Quick Start

**1.** Create a `.env` file:

```env
PIHOLE_PASSWORD=your_pihole_app_password
```

This is your Pi-hole **app password**, not your web login password. To get it: from the Pi-hole admin panel, go to **Settings → Web interface / API → Configure app password**.

**2.** Create a `compose.yaml` (copy the example below or grab [`compose.yaml`](compose.yaml) from the repo) and update `PIHOLE_URL` to your Pi-hole's address:

```yaml
services:
  ph-intercept:
    image: ghcr.io/m00grin/ph-intercept:latest
    hostname: ph-intercept
    container_name: ph-intercept
    restart: unless-stopped

    # Create a .env file in this directory with:
    #   PIHOLE_PASSWORD=your_pihole_app_password
    env_file:
      - .env

    environment:
      # Pi-hole v6 API endpoint. Replace with your Pi-hole's IP:port/api
      PIHOLE_URL: "http://your.server.ip.address:your_pihole_port/api"

      # Optional: where ESC navigates to (like your homelab dashboard or homepage).
      # Leave blank ("") to disable ESC navigation.
      RETURN_URL: ""

      # Background style: starfield | dark | nebula
      BG_MODE: starfield

      # Sky region shown when BG_MODE=starfield:
      #   summer_triangle | orion | scorpius | southern_cross
      SKY_PRESET: summer_triangle

      # Set BG_IMAGE to use a custom background. URL or /bg/your-filename.jpg.
      # Setting this overrides BG_MODE and shows your image instead.
      BG_IMAGE: ""

    volumes:
      - ./bg:/app/static/bg:ro

    ports:
      # Host port : container port. Change the left side if 4653 is taken.
      - "4653:4653"

    # Optional: point DNS at your Pi-hole or resolver (e.g. Unbound).
    # dns:
    #   - your.dns.dockernet.ip

    # Optional: static IP on an existing Docker network.
    # networks:
    #   dns_net:
    #     ipv4_address: this.container.dockernet.ip

# networks:
#   dns_net:
#     external: true
```

**3.** Start the container:

```bash
docker compose up -d
```

Open `http://your-host:4653`.

---

## Entities

Each DNS query spawns an entity. Appearance scales with how many times that domain has appeared recently:

**Allowed queries:** friendly ships traveling across the screen. Cache-answered queries move faster than upstream-answered ones.

| Tier | Condition | Shape | Color |
|------|-----------|-------|-------|
| 1 | First sighting | Rounded shuttle · Delta wing · X-wing | Green · Blue · Lime |
| 2 | Seen twice | Heavy transport | Cyan |
| 3+ | Three or more | Capital ship | Gold |

**Blocked queries:** enemies the ship targets and destroys. A domain blocked again while still on screen mutates its sprite to the next tier in place.

| Tier | Condition | Shape | Color |
|------|-----------|-------|-------|
| 1 | First block | Crab invader · Squid | Red |
| 2 | Blocked twice | Heavy drone | Orange |
| 3+ | Three or more | Boss | Purple |

Ship weapon color tracks tier: green for tier 1, cyan for tier 2, gold for tier 3+.

---

## The ship

The ship targets and destroys blocked entities autonomously. At five on-screen threats a support drone launches and flanks; at ten a second drone deploys. Drones are recalled when the threat count drops.

Four ships are selectable from the HUD: **Protector** (NSEA Protector, default), **Falcon** (Millennium Falcon), **Swordfish** (Swordfish II), and **Enterprise** (NCC-1701). Switching ships triggers a warp-out/warp-in transition that pushes nearby entities aside.

---

## The HUD

A strip across the bottom, divided into four panels:

**INTERCEPT:** blocking status and toggle. Click to open a menu with timed-disable options (10 sec, 30 sec, 5 min) or a full disable. A countdown shows when a timed block is active; the timer survives navigation and syncs correctly if blocking is changed remotely.

**STATS:** total queries, blocked, allowed, and block percentage. Updated live.

**GRAVITY:** gravity list size. The arrow triggers a list update and confirms when done.

**SHIPS:** active ship name. Click to open the ship selector.

---

## The background

When `BG_MODE=starfield`, the background renders a real section of the night sky from an accurate star catalog (~12,200 stars to magnitude 6.8, color-coded by spectral type). Positions use equatorial coordinates; what you see is where the stars actually are.

Star data is from the **HYG Database** by David Nash ([astronexus.com](https://astronexus.com)), combining Hipparcos (ESA) and the Yale Bright Star Catalogue.

Deep sky objects rendered:

| Type | Objects |
|------|---------|
| Emission nebulae | Lagoon, Trifid, Omega, Eagle, Crescent, North America |
| Planetary nebulae | Ring, Dumbbell, Helix |
| Supernova remnants | Eastern Veil, Western Veil (Cygnus Loop) |
| Globular clusters | M2, M4, M5, M10, M12, M13, M14, M15, M19, M22, M28, M54, M55, M56, M62, M69, M70, M71, M72, M75, M80, M92, M107, and more |
| Open clusters | M6 (Butterfly), M7 (Ptolemy's Cluster), and others |

**Planets:** Mars, Jupiter, Saturn (with ring), and the Moon are computed from real orbital elements and appear at their actual sky positions, updated hourly.

**Transients:** occasional satellite passes and meteors, including the ISS.

---

## Configuration

All configuration is via environment variables in `compose.yaml`.

### Required

| Variable | Description |
|----------|-------------|
| `PIHOLE_PASSWORD` | Pi-hole app password (set in `.env`, not compose.yaml). Get it from **Settings → Web interface / API → Configure app password**. |
| `PIHOLE_URL` | Pi-hole v6 API base URL, e.g. `http://192.168.1.x:8053/api` |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `RETURN_URL` | *(empty)* | URL that Escape navigates to. |
| `BG_MODE` | `starfield` | `starfield` · `dark` · `nebula` |
| `SKY_PRESET` | `summer_triangle` | `summer_triangle` · `orion` · `scorpius` · `southern_cross` |
| `BG_IMAGE` | *(empty)* | Image URL or `/bg/filename.jpg`. Overrides `BG_MODE` when set. |

---

## Requirements

- Pi-hole v6 (v5 is not compatible)
- Docker with Compose
- Network route from the container to your Pi-hole

The container listens on port 4653. The compose file includes an optional static IP block for existing Docker networks.
