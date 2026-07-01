# ph-intercept

A Pi-hole DNS dashboard that runs as a standalone Docker container. Streams live DNS query events from your Pi-hole v6 API and renders them as pixel-art friendlies and enemies. Blocked queries are destroyed by the ship, allowed queries fly through. Toggle blocking, set timed blocks, trigger gravity updates, and switch ships from the HUD.

Designed to be dropped in alongside an existing Pi-hole v6 setup with no extra dependencies. Two instances can run side by side in [local 2-player split-screen](#local-2-player-mode).

<img width="1713" height="1254" alt="image" src="https://github.com/user-attachments/assets/791ba70f-c6cd-4495-8135-0e0d2286668e" />

---

> **AdGuard Home user?** See the [AdGuard setup guide](adguard/README.md).

## Quick Start

**1.** Get your Pi-hole **app password** (not your web login password): from the Pi-hole admin panel, go to **Settings → Web interface / API → Configure app password**.

- **CLI users:** Create a `.env` file in the same directory as your `compose.yaml`:

  ```env
  PIHOLE_PASSWORD=your_pihole_app_password
  ```

- **Portainer users:** Skip the `.env` file. Add `PIHOLE_PASSWORD` as an environment variable directly in the Portainer stack config.

**2.** Create a `compose.yaml` (copy the example below or grab [`compose.yaml`](compose.yaml) from the repo) and update `PIHOLE_URL` to your Pi-hole's address:

```yaml
services:
  ph-intercept:
    image: ghcr.io/m00grin/ph-intercept:latest
    hostname: ph-intercept
    container_name: ph-intercept
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 128m
          cpus: "1"
          pids: 20

    environment:
      # REQUIRED: Pi-hole v6 API endpoint
      # Example: "http://192.168.1.2:80/api"
      PIHOLE_URL: "http://CHANGE.ME:PORT/api"

      # CLI users: Create a .env file in the same dir as this compose file with:
      #  PIHOLE_PASSWORD=your_pihole_app_password
      # Portainer Web users: Add the environment variable: PIHOLE_PASSWORD=your_pihole_app_password
      PIHOLE_PASSWORD: ${PIHOLE_PASSWORD}

      # Optional: where ESC navigates to (like your homelab dashboard or homepage)
      # Accepts http://, https://, protocol-relative (//), relative paths, and custom app schemes
      # Leave blank ("") to disable ESC entirely
      RETURN_URL: ""

      # Background style: starfield | dark | nebula
      BG_MODE: starfield

      # Sky region shown when BG_MODE=starfield:
      #   summer_triangle | orion | scorpius | southern_cross
      SKY_PRESET: summer_triangle

      # Set BG_IMAGE to use a custom background. URL for an image, or /bg/your-filename.jpg
      # If set, BG_IMAGE overrides BG_MODE entirely
      BG_IMAGE: ""

      # SSL certificate verification. Set to "false" if Pi-hole uses HTTPS
      #  with a self-signed certificate. Leave as "true" for HTTP or valid HTTPS.
      PIHOLE_VERIFY_SSL: "true"

      # Optional: comma-separated regex patterns. Matching domains spawn no ships. Case-insensitive.
      # PIHOLE_IGNORE_DOMAINS: .*\.local$,.*\.internal$

      # 2-player local mode: set the URL (and password if the second Pi-hole has one)
      # to enable a second Pi-hole ship on the right half
      # PIHOLE2_URL: "http://192.168.1.3:8053/api"
      # PIHOLE2_PASSWORD: ${PIHOLE2_PASSWORD}
      # PIHOLE2_VERIFY_SSL: "true"

    volumes:
      # Portainer Web users: This will resolve to /data/compose/<stack-id>/bg/
      - ./bg:/app/static/bg
      # Persists 2-player mode state across container restarts
      - data:/app/data

    cap_drop:
      - ALL

    security_opt:
      - "no-new-privileges:true"

    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

    ports:
      # Host port : container port. Change the left side if 4653 is taken
      - "4653:4653"

    # Optional: point DNS at your Pi-hole (if used for DNS resolution) or resolver directly (like Unbound)
    # dns:
    #   - your.dns.dockernet.ip

    # Optional: only needed if you use static IPs on a custom Docker network
    # Uncomment both networks blocks if you need this
    # networks:
    #   dns_net:
    #     ipv4_address: this.container.dockernet.ip

# networks:
#   dns_net:
#     external: true

volumes:
  data:
```

**3.** Start the container:

```bash
docker compose up -d
```

Open `http://your-host:4653`.

---

## Image Tags

| Tag | What it is |
|-----|------------|
| `:latest` | Latest stable release. |
| `:X.Y.Z` | Pinned release (e.g. `1.4.0`). |
| `:develop` | Built automatically on every push to the `develop` branch. May be unstable. Good for trying out what I'm working on. |

---

## Portainer Note for BG

- Drop image files into `/data/compose/<stack-id>/bg/` on the Portainer host (where the `./bg` bind mount resolves).

## Entities

Each DNS query spawns an entity. Tier scales with how many times that domain has queried while the entity is still on screen:

**Allowed queries:** friendly ships traveling across the screen. Cache-answered queries move faster than upstream-answered ones.

<img width="487" height="354" alt="image" src="https://github.com/user-attachments/assets/7c80bb93-6ccd-4ac2-b1c9-e34a1f54cc31" />

| Tier | Condition | Shape | Color |
|------|-----------|-------|-------|
| 1 | First query | Rounded shuttle · Delta wing · X-wing | Green · Blue · Lime |
| 2 | Queried again while on screen | Heavy transport | Cyan |
| 3+ | Three or more queries while on screen | Capital ship | Gold |

**Blocked queries:** enemies the ship targets and destroys. A domain blocked again while still on screen mutates its sprite to the next tier in place.

<img width="621" height="471" alt="image" src="https://github.com/user-attachments/assets/a2da33be-7015-4b34-9c51-6904b06573d0" />

| Tier | Condition | Shape | Color |
|------|-----------|-------|-------|
| 1 | First block | Crab invader · Squid | Red |
| 2 | Blocked twice | Heavy drone | Orange |
| 3+ | Three or more | Boss | Purple |

Ship weapon color tracks tier: green for tier 1, cyan for tier 2, gold for tier 3+.

---

## The ship

The ship targets and destroys blocked entities autonomously. At five on-screen threats a support drone launches and flanks; at ten a second drone deploys. Drones are recalled when the threat count drops.

Seven ships are selectable from the HUD, shown in an 8-slot 4×2 grid: **Protector** (NSEA Protector, default), **Falcon** (Millennium Falcon), **Swordfish** (Swordfish II), **Enterprise** (NCC-1701), **Serenity** (Firefly), **Normandy** (Mass Effect), and **PES** (Planet Express Ship). Switching ships triggers a warp-out/warp-in transition that pushes nearby entities aside.

<img width="370" height="176" alt="ships" src="https://github.com/user-attachments/assets/694a3786-10b5-4427-8f35-7d160b28c67b" />

---

## The HUD

A strip across the bottom, divided into four panels:

**INTERCEPT:** blocking status and toggle. Click to open a menu with timed-disable options (10 sec, 30 sec, 5 min) or a full disable. A countdown shows when a timed block is active; the timer survives navigation and syncs correctly if blocking is changed remotely.

**STATS:** total queries, blocked, allowed, and block percentage. Updated live.

**GRAVITY:** gravity list size. The arrow triggers a list update and confirms when done.

**SHIPS:** active ship name. Click to open the ship selector.

<img width="1376" height="105" alt="download" src="https://github.com/user-attachments/assets/cc4adf89-ac1e-402f-aed2-68ed282b49a3" />

A hamburger button at the left edge of the HUD opens the **Settings** panel, which includes:

- **Friendlies** -- show or hide friendly (allowed) entities
- **Client** -- show the requesting client (IP or hostname) as a label per entity
- **Domain** -- show or hide the domain label beneath each entity
- **Pi-hole** -- link to the Pi-hole admin panel

Display settings are saved to `localStorage` and restored on next load.

---

## The background

Three modes are available via `BG_MODE`:

**`starfield` (default):** Renders a real section of the night sky from an accurate star catalog (~12,200 stars to magnitude 6.8, color-coded by spectral type). Positions use equatorial coordinates; what you see is where the stars actually are. The sky region is set by `SKY_PRESET`.

<img width="684" height="487" alt="image" src="https://github.com/user-attachments/assets/d6a04374-9341-464b-8f24-71cafc8bbbeb" />

Star data is from the **HYG Database** by David Nash ([astronexus.com](https://astronexus.com)), combining Hipparcos (ESA) and the Yale Bright Star Catalogue.

**Planets:** Mars, Jupiter, Saturn (with ring), and the Moon are computed from real orbital elements and appear at their actual sky positions, updated hourly.

**Transients:** occasional satellite passes and meteors, including the ISS.

**`nebula`:** A procedurally generated nebula. Overlapping color lobes with value noise, dust lanes, and a synthetic star layer. Fully GPU-rendered, no catalog data.

**`dark`:** Plain black background. No canvas rendering overhead.

---

## Configuration

All configuration is via environment variables in `compose.yaml`.

### Required

| Variable | Description |
|----------|-------------|
| `PIHOLE_PASSWORD` | Pi-hole app password. CLI: set in a `.env` file. Portainer: add as an environment variable in the stack. Get it from **Settings → Web interface / API → Configure app password**. |
| `PIHOLE_URL` | Pi-hole v6 API base URL, e.g. `http://192.168.1.x:8053/api` |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `RETURN_URL` | `""` | URL that ESC navigates to. Accepts `http://`, `https://`, protocol-relative (`//`), relative paths, and custom app schemes. Leave blank to disable ESC. |
| `BG_MODE` | `starfield` | `starfield` · `dark` · `nebula` |
| `SKY_PRESET` | `summer_triangle` | `summer_triangle` · `orion` · `scorpius` · `southern_cross` |
| `BG_IMAGE` | `""` | Image URL or `/bg/filename.jpg`. Overrides `BG_MODE` when set. |
| `PIHOLE_VERIFY_SSL` | `true` | Set to `false` if Pi-hole uses HTTPS with a self-signed certificate. |
| `PIHOLE_IGNORE_DOMAINS` | _(unset)_ | Comma-separated regex patterns. Domains that match spawn no ships. Case-insensitive; escape literal dots (`\.local$`). Example: `.*\.local$,.*\.internal$` |

---

## Local 2-Player Mode

Two DNS instances can run side by side in split-screen. Player 1's ship occupies the left half of the canvas, Player 2's ship the right. Each instance streams its own query events, stats, blocking toggle, and gravity/filter updates independently.

Add the second Pi-hole to your `compose.yaml` environment block:

```yaml
PIHOLE2_URL: "http://192.168.1.3:8053/api"
PIHOLE2_PASSWORD: ${PIHOLE2_PASSWORD}
```

And add the password to your `.env` file:

```env
PIHOLE2_PASSWORD=your_second_pihole_password
```

`PIHOLE2_PASSWORD` can be omitted if the second Pi-hole has no app password set. Setting a valid `PIHOLE2_URL` is all that is required to make the mode available; turn it on from the in-game 2-player panel. On/off state is saved to the `data` volume, so it survives container restarts.

> **AdGuard Home?** The second instance mirrors your primary provider, so an AdGuard setup pairs with a second AdGuard Home via `ADGUARD2_URL` / `ADGUARD2_USERNAME` / `ADGUARD2_PASSWORD`. See the [AdGuard 2-player setup](adguard/README.md#local-2-player-mode).

---

## Requirements

- Pi-hole v6 (v5 is not compatible)
- Docker with Compose
- Network route from the container to your Pi-hole
- **Architecture:** `linux/amd64` · `linux/arm64` · `linux/arm/v7` · `linux/arm/v6` · `linux/386` · `linux/riscv64`

The container listens on port 4653. The compose file includes an optional static IP block for existing Docker networks.

---

## Testing

I may have gone a little overboard.

ph-intercept is developed against a full test suite covering four layers:

- **Pi-hole client** -- async unit tests for every auth path (including passwordless and lock contention), session management, query status classification, the broadcast queue, and the live query poller
- **API layer** -- endpoint tests for every route, security headers, cache-control rules, and input validation
- **Browser** -- Playwright integration tests across Chromium, Firefox, and WebKit covering page load, canvas sizing, SSE connection and reconnect, settings persistence, font loading, and bfcache reentry
- **Devices** -- the same Playwright suite run against 40+ real device profiles: RPi touchscreens, Fire tablets, iPads, Android tablets, HiDPI displays, 4K, ultrawides, and orientation changes
