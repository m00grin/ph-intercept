# ph-intercept - Technitium DNS

A live arcade dashboard for your Technitium DNS Server. It runs as a standalone Docker container next to Technitium, streams the DNS queries your network is resolving, and renders them as pixel-art ships: blocked queries are shot down, allowed ones fly through. Toggle blocking, set timed disables, force a block-list update, and switch ships from the HUD.

This guide assumes Technitium is already serving DNS for your network, with your router or clients pointed at it so real queries are flowing. ph-intercept only reads from the Technitium HTTP API; it does not touch your DNS configuration. No traffic through Technitium means an empty screen, which is expected.

---

## What you need first

ph-intercept reads two things from Technitium: the dashboard stats (built in, nothing to do) and the live query log. Technitium serves its query log through a **DNS app** rather than a built-in endpoint, so there is one setup step and one credential to create.

**1. Install the query-log app.** In the Technitium console, go to **Apps -> App Store** and install **Query Logs (Sqlite)**. Despite the name there is no database to run: SQLite is embedded, so the app just writes to a file inside Technitium. This is the standard, zero-dependency choice; Technitium also offers MySQL / PostgreSQL / SQL Server variants if you already run one of those, and any of them works.

**2. Create a login for ph-intercept.** In the console, go to **Administration -> Sessions -> Create Token** and copy the token. (A username and password works too, but a token is cleaner and never expires from inactivity.)

That is the entire Technitium-side setup. If the query-log app is missing, the HUD still works (stats and the blocking toggle) but no ships spawn. If you installed the app under a custom name, set `TECHNITIUM_QUERY_LOG_APP` / `TECHNITIUM_QUERY_LOG_CLASS` to match; the defaults are `Query Logs (Sqlite)` and `QueryLogsSqlite.App`.

---

## Quick Start

**1.** Put the token from the step above into your environment:

- **CLI users:** Create a `.env` file in the same directory as your `compose.yaml`:

  ```env
  TECHNITIUM_TOKEN=your_api_token
  ```

- **Portainer users:** Skip the `.env` file. Add `TECHNITIUM_TOKEN` as an environment variable directly in the Portainer stack config.

  (Prefer a username and password? Use `TECHNITIUM_USER` / `TECHNITIUM_PASSWORD` instead, plus `TECHNITIUM_TOTP` if the account has 2FA.)

**2.** Create a `compose.yaml` (copy the example below or grab [`compose.yaml`](compose.yaml) from the repo) and set `TECHNITIUM_URL` to your Technitium web-console address:

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
      PROVIDER: technitium

      # REQUIRED: Technitium DNS web-console root (the API lives under /api).
      # Example: "http://192.168.1.2:5380"
      TECHNITIUM_URL: "http://CHANGE.ME:5380"

      # Authentication: a permanent API token (recommended) OR user + password.
      TECHNITIUM_TOKEN: ${TECHNITIUM_TOKEN}
      # TECHNITIUM_USER: "admin"
      # TECHNITIUM_PASSWORD: ${TECHNITIUM_PASSWORD}
      # TECHNITIUM_TOTP: ""   # only if the account has 2FA enabled

      # The "Query Logs (Sqlite)" DNS app must be installed in Technitium.
      # These match its default install name / class path; change only if you
      # installed the app under a different name.
      # TECHNITIUM_QUERY_LOG_APP: "Query Logs (Sqlite)"
      # TECHNITIUM_QUERY_LOG_CLASS: "QueryLogsSqlite.App"

      # Optional: where ESC navigates to (like your homelab dashboard or homepage)
      RETURN_URL: ""

      # Background. These set the DEFAULT; each user can also switch the background live
      # from the in-app settings menu, and their choice is remembered per-browser.
      # Style: starfield | nebula | outrun | dark
      BG_MODE: starfield

      # Sky region shown for the starfield:
      #   summer_triangle | orion | scorpius | southern_cross
      SKY_PRESET: summer_triangle

      # Optional custom background image: a URL, or /bg/your-filename.jpg (mounted volume).
      # When set, it becomes the default and enables the in-app "CUSTOM" option so it can be
      # picked any time. Leave blank to disable it (CUSTOM shows greyed out in the menu).
      BG_IMAGE: ""

      # SSL certificate verification. Set to "false" if Technitium uses HTTPS
      #  with a self-signed certificate. Leave as "true" for HTTP or valid HTTPS.
      TECHNITIUM_VERIFY_SSL: "true"

      # Optional: comma-separated regex patterns. Matching domains spawn no ships.
      # TECHNITIUM_IGNORE_DOMAINS: .*\.local$,.*\.internal$

      # 2-player local mode: set the URL and a token (or user + password) to enable
      # a second Technitium ship on the right half. The second instance also needs
      # the Query Logs (Sqlite) app installed.
      # TECHNITIUM2_URL: "http://192.168.1.3:5380"
      # TECHNITIUM2_TOKEN: ${TECHNITIUM2_TOKEN}
      # TECHNITIUM2_VERIFY_SSL: "true"

    volumes:
      - ./bg:/app/static/bg
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
      # Host port : container port. Change the left side if 4673 is taken
      - "4673:4653"

volumes:
  data:
```

**3.** Start the container:

```bash
docker compose up -d
```

Open `http://your-host:4673`.

---

## Configuration

All configuration is via environment variables in `compose.yaml`.

> **Upgrading?** Pulling the latest `compose.yaml` is recommended so you have all current environment variables on hand. Anything you don't set falls back to a sensible default, so an older compose keeps working, you just might be missing newer options.

### Required

| Variable | Description |
|----------|-------------|
| `PROVIDER` | Set to `technitium`. |
| `TECHNITIUM_URL` | Technitium web-console root, e.g. `http://192.168.1.x:5380`. The API is reached under `/api`. |
| `TECHNITIUM_TOKEN` **or** `TECHNITIUM_USER` + `TECHNITIUM_PASSWORD` | Authentication. A permanent API token is recommended; alternatively supply console username and password. |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `TECHNITIUM_TOTP` | `""` | Time-based one-time code, only if the account has 2FA enabled. Not needed with an API token. |
| `TECHNITIUM_QUERY_LOG_APP` | `Query Logs (Sqlite)` | Installed name of the query-log DNS app. |
| `TECHNITIUM_QUERY_LOG_CLASS` | `QueryLogsSqlite.App` | Class path of the query-log DNS app. |
| `TECHNITIUM_VERIFY_SSL` | `true` | Set to `false` if Technitium uses HTTPS with a self-signed certificate. |
| `TECHNITIUM_IGNORE_DOMAINS` | _(unset)_ | Comma-separated regex patterns. Domains that match spawn no ships. Case-insensitive; escape literal dots (`\.local$`). Example: `.*\.local$,.*\.internal$` |
| `RETURN_URL` | `""` | URL that ESC navigates to. Accepts `http://`, `https://`, protocol-relative (`//`), relative paths, and custom app schemes. Leave blank to disable ESC. |
| `BG_MODE` | `starfield` | Default background: `starfield` · `nebula` · `outrun` · `dark`. Switchable live in-app. |
| `SKY_PRESET` | `summer_triangle` | Default sky region: `summer_triangle` · `orion` · `scorpius` · `southern_cross`. Switchable live in-app. |
| `BG_IMAGE` | `""` | Custom image URL or `/bg/filename.jpg`. When set, it's the default and enables the in-app `CUSTOM` option; blank leaves `CUSTOM` disabled. |
| `TECHNITIUM2_URL` | _(unset)_ | Second Technitium console URL. Setting a valid URL activates local 2-player split-screen mode. See below. |
| `TECHNITIUM2_TOKEN` | `""` | API token for the second instance (or use user + password below). |
| `TECHNITIUM2_USER` / `TECHNITIUM2_PASSWORD` | `""` | Console credentials for the second instance. |
| `TECHNITIUM2_TOTP` | `""` | TOTP code for the second instance, if it has 2FA. |
| `TECHNITIUM2_VERIFY_SSL` | `true` | Set to `false` if the second instance uses HTTPS with a self-signed certificate. |
| `TECHNITIUM2_QUERY_LOG_APP` / `TECHNITIUM2_QUERY_LOG_CLASS` | _(inherits primary)_ | Override only if the second instance's query-log app differs from the first. |

---

## Local 2-Player Mode

Two Technitium instances can run side by side in split-screen. P1's ship occupies the left half of the canvas, P2's ship the right. Each instance streams its own query events independently.

Add the second Technitium to your `compose.yaml` environment block:

```yaml
TECHNITIUM2_URL: "http://192.168.1.3:5380"
TECHNITIUM2_TOKEN: ${TECHNITIUM2_TOKEN}
```

And add the token to your `.env` file:

```env
TECHNITIUM2_TOKEN=your_second_technitium_token
```

The second instance also needs the **Query Logs (Sqlite)** app installed. Setting a valid `TECHNITIUM2_URL` is all that is required to activate split-screen mode; toggle it on from the in-game 2-player panel. The second instance mirrors the primary provider, so Technitium pairs with Technitium (a Pi-hole second instance uses `PIHOLE2_*`, AdGuard uses `ADGUARD2_*`).

---

## Blocked, cached, or upstream

Technitium tags each answer with a response type, which ph-intercept maps to the same three visuals the other providers use:

- **Blocked** (`Blocked`, `UpstreamBlocked`, `UpstreamBlockedCached`, `Dropped`) -> enemy the ship destroys.
- **Cached** -> a fast friendly.
- Everything else (`Recursive`, `Authoritative`) -> an upstream friendly.

---

## Gameplay, ship, HUD, and background

The entities, ship roster, HUD panels, and background modes are identical across all providers. See the [main README](../README.md) for the full walkthrough of entity tiers, the seven selectable ships, the four HUD panels, and the starfield / nebula / outrun / dark backgrounds.

---

## Requirements

- Technitium DNS Server (recent version) with the **Query Logs (Sqlite)** app installed
- Docker with Compose
- Network route from the container to your Technitium instance
- **Architecture:** `linux/amd64` · `linux/arm64` · `linux/arm/v7` · `linux/arm/v6` · `linux/386` · `linux/riscv64`

The container listens on port 4653 internally, mapped to host port 4673 by default.
