# ph-intercept - Technitium DNS

A live arcade dashboard for your Technitium DNS Server. It runs as a standalone Docker container next to Technitium, streams the DNS queries your network is resolving, and renders them as pixel-art ships: blocked queries are shot down, allowed ones fly through. Toggle blocking, set timed disables, force a block-list update, and switch ships from the HUD.

ph-intercept uses one compose for every DNS server it supports. This page is that compose with the Technitium lines filled in, plus what's specific to Technitium. Everything else is in the [main README](../README.md).

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
  BLOCKER_TOKEN=your_api_token
  ```

- **Portainer users:** Skip the `.env` file. Add `BLOCKER_TOKEN` as an environment variable directly in the Portainer stack config.

**2.** Create a `compose.yaml` (copy the example below or grab [`compose.yaml`](compose.yaml) from the repo) and set `BLOCKER_URL` to your Technitium web-console address:

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
      # REQUIRED: the Technitium web console address. Example: "http://192.168.1.2:5380"
      # The "Query Logs (Sqlite)" app must be installed in Technitium.
      BLOCKER_URL: "http://CHANGE.ME:5380"

      # An API token (Administration > Sessions > Create Token) OR a username and password.
      # CLI users: Create a .env file in the same dir as this compose file with:
      #  BLOCKER_TOKEN=your_api_token
      # Portainer Web users: Add the environment variable: BLOCKER_TOKEN=your_api_token
      BLOCKER_TOKEN: ${BLOCKER_TOKEN}
      # BLOCKER_USERNAME: "admin"
      # BLOCKER_PASSWORD: ${BLOCKER_PASSWORD}
      # TECHNITIUM_TOTP: ""

      # Optional: where ESC navigates to (like your homelab dashboard or homepage)
      # Accepts http://, https://, protocol-relative (//), relative paths, and custom app schemes
      # Leave blank ("") to disable ESC entirely
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
      BLOCKER_VERIFY_SSL: "true"

      # Optional: comma-separated regex patterns. Matching domains spawn no ships. Case-insensitive.
      # IGNORE_DOMAINS: .*\.local$,.*\.internal$

      # Optional: "true" makes the page view-only. The server refuses the blocking
      # toggle, filter update and 2-player mode switch; the HUD controls go inert.
      # READ_ONLY: "true"

      # Optional: "true" drops the client name/IP from every query on the server,
      # so it never reaches the browser. Also hides the in-app CLIENT toggle.
      # HIDE_CLIENT: "true"

      # Optional: comma-separated regex patterns matched against the client name or IP.
      # Queries from matching clients spawn no ships. Case-insensitive.
      # IGNORE_CLIENTS: ^uptime-kuma$,^192\.168\.1\.99$

      # Optional: "true" replaces every domain with an opaque per-start token on the
      # server. Repeat queries still group; domain labels and the DOMAIN toggle go away.
      # HIDE_DOMAIN: "true"

      # 2-player local mode: a second DNS server, any of the four, for a second ship on
      # the right half. Same settings as above with BLOCKER2_.
      # BLOCKER2_URL: "http://192.168.1.3:5380"
      # BLOCKER2_TOKEN: ${BLOCKER2_TOKEN}

    volumes:
      # Portainer Web users: This will resolve to /data/compose/<stack-id>/bg/
      - ./bg:/app/static/bg
      # Persists 2-player mode state across container restarts
      - data:/app/data

    cap_drop:
      - ALL

    security_opt:
      - "no-new-privileges:true"

    read_only: true

    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

    ports:
      # Host port : container port. Change the left side if 4673 is taken
      - "4673:4653"

    # Optional: point DNS at your Technitium (if used for DNS resolution) or resolver directly (like Unbound)
    # dns:
    #   - your.dns.dockernet.ip

    # Optional: only needed if you use static IPs on a custom Docker network
    # Uncomment both networks blocks if you need this
    # networks:
    #   intercept_net:
    #     ipv4_address: this.container.dockernet.ip

# networks:
#   intercept_net:
#     external: true

volumes:
  data:
```

**3.** Start the container:

```bash
docker compose up -d
```

Open `http://your-host:4673`.

---

## Technitium DNS notes

- **Login:** set `BLOCKER_TOKEN`, or `BLOCKER_USERNAME` and `BLOCKER_PASSWORD` (plus `TECHNITIUM_TOTP` if the account uses two-factor codes), not both.
- **Blocked, cached, or upstream:** Technitium tags each answer with a response type. `Blocked`, `UpstreamBlocked`, `UpstreamBlockedCached`, and `Dropped` become enemies the ship destroys, `Cached` a fast friendly, and everything else an upstream friendly.
- **HUD:** **STATS** shows **no error** (Technitium's own dashboard count) in place of allowed. **BLOCK LIST** (in place of GRAVITY) forces a block-list update. The settings link opens the Technitium web console.
- **2-player:** the second side can be another Technitium (with its own Query Logs app) or any other supported server. See [Local 2-Player Mode](../README.md#local-2-player-mode).
- **Settings from before 1.6** (`PROVIDER: technitium`, `TECHNITIUM_URL`, `TECHNITIUM_TOKEN`, `TECHNITIUM_USER`, `TECHNITIUM_PASSWORD`) still work exactly as before. See [Older settings](../README.md#older-settings).

Configuration, troubleshooting, and privacy: see the [main README](../README.md#configuration).
