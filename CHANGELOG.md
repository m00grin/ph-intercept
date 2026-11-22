# Changelog

All notable changes to ph-intercept are documented here.

---

## [Unreleased]

### Added

- **Blocky support** -- ph-intercept now works with Blocky as well as Pi-hole, AdGuard Home, and Technitium. Blocky has no API for recent queries, so ph-intercept follows the CSV query log Blocky writes (`queryLog.type: csv`) through a read-only mount, reading only new lines and only while a page is open. Blocking toggle, timed disable, list refresh, and HUD stats use Blocky's REST API. Because it reads that log, ph-intercept has to run on the same machine as Blocky for now; with Blocky elsewhere, stats and controls work but no ships appear. See [Blocky setup](README.md#blocky-setup).
- **Mixed-provider 2-player** -- the two sides of local split-screen no longer have to run the same DNS server: a Pi-hole on one side and an AdGuard Home on the other works, with each side's own name, icon, timed-disable choices, and stats labels. Add the second server with `BLOCKER2_URL`. See [Local 2-Player Mode](README.md#local-2-player-mode).
- **One set of settings for every DNS server** -- `BLOCKER_URL` (the address you open in a browser) and `BLOCKER_PASSWORD`, plus `BLOCKER_USERNAME` or `BLOCKER_TOKEN` where the server needs them. ph-intercept identifies which server answers at startup, strictly: a server that matches none of the four, or a `BLOCKER_TYPE` that doesn't match the server, stops that side with a plain message instead of half-working. A pasted `/admin`, `/api`, or `/#/dashboard` on the end of the address is fine. See [Configuration](README.md#configuration).
- **Ignore lists per side** -- `IGNORE_DOMAINS` and `IGNORE_CLIENTS` apply to both sides; `BLOCKER_IGNORE_*` and `BLOCKER2_IGNORE_*` to one side only.
- **Docker secrets** -- every password, token, and username can be read from a file with `*_FILE` (for example `BLOCKER_PASSWORD_FILE=/run/secrets/dns_password`), for the new names and the older ones alike.
- **Startup report** -- the log now says which DNS server each side found, where its settings came from, and anything it ignored. It never prints a password or token.

### Changed

- **One compose for every DNS server** -- the main `compose.yaml` now works for Pi-hole, AdGuard Home, Technitium, and Blocky. The AdGuard and Technitium guides keep their copy-paste composes, filled in for each, and shrink to what's specific to that server.
- **AdGuard Home's list panel reads BLOCKLIST** -- it said FILTER. AdGuard Home 1.0 calls these lists "Blocklists" (under Filters), with a "Check for updates" button, so the HUD now uses AdGuard's own word, as it already did for Pi-hole (GRAVITY), Technitium (BLOCK LIST), and Blocky (DENYLIST).
- **Reproducible, verified image builds** -- every Python package in the image, including the ones the app's libraries pull in, is now installed from a lock file with exact versions and checksums (`--require-hashes`), and the base image is pinned by digest. Before, only the four direct dependencies had versions, so two builds of the same release could differ (and did: the CA bundle package changed between builds). Updates still arrive weekly as reviewed Dependabot pull requests. Alpine's own packages are still upgraded at build time on purpose, so security fixes land between base image releases; each release's SBOM records exactly what went in.
- **Official provider icons** -- the Pi-hole, AdGuard Home, Technitium, and Blocky icons now come from each project's own artwork, and Technitium's grid logo is drawn with sharp edges at any display scaling.

### Fixed

- **A rejected or slow Pi-hole login no longer floods Pi-hole with retries** -- after a failed, refused, or timed-out login, ph-intercept retried with every poll, about three times a second per open page. On a slow Pi a login can take longer than the old 1.5 second timeout, so abandoned logins piled up inside Pi-hole and pinned its CPU. Failed logins now wait 2 seconds, doubling to 30 (60 after Pi-hole's rate limit), the login gets 10 seconds, and a success clears the wait. Applies to the second Pi-hole in 2-player mode too. Tracked down with [@Plxprs](https://github.com/Plxprs) in [#59](https://github.com/m00grin/ph-intercept/issues/59). Thank you!

- **Technitium releases before 15 now work** -- they only accept the API token as a URL parameter, not the header ph-intercept sends, so stats and ships stayed empty. ph-intercept now switches to the parameter when the server asks for it. Tested on Technitium 11.5, 12.2, 13.6, 14.3, and 15.x.
- **Turning on 2-player with a slow second server** -- the check of a second Pi-hole or AdGuard Home now gives the login 10 seconds instead of 1.5. A Pi-hole login takes about 2 seconds on a Pi Zero W, so 2-player refused to start with "Could not reach Pi-hole 2".

- **First queries after connecting to an empty query log** -- with Pi-hole, AdGuard Home, or Blocky, if the query log was empty when a page connected (a fresh install, a cleared log, or a new Blocky log folder), the first batch of real queries was taken for old history and never shown. They now appear like any other. Technitium already handled this.
- **A malformed reply from Technitium** -- a reply that was valid JSON but not an object could raise an error inside the blocking toggle. It's now treated like any other bad reply.

### Upgrading

Nothing to change. Every setting from earlier releases (`PROVIDER`, `PIHOLE_URL`, `ADGUARD_PASSWORD`, `TECHNITIUM_TOKEN`, and the rest) still works exactly as before, and wins if both an older and a newer name are set. A config that uses only the older names behaves exactly as in 1.5.8. See [Older settings](README.md#older-settings).

---

## [1.5.8] - 2026-11-21

A fix for AdGuard Home users, found by [@21mtd](https://github.com/21mtd) in [#58](https://github.com/m00grin/ph-intercept/issues/58). They noticed AdGuard Home working hard whenever ph-intercept was open (a load average jumping from 1 to 6 on a low-powered box) and tracked it to ph-intercept's requests. Thank you!

### Fixed

- **High AdGuard Home CPU use while the dashboard is open** -- ph-intercept used Basic Auth, so AdGuard Home re-verified the login on every request with a deliberately slow password check (bcrypt), several times a second per open page. ph-intercept now logs in once and reuses the session, like the AdGuard web UI does, and logs in again only when AdGuard asks. In testing, AdGuard Home's CPU use dropped from about 23% of a core to under 1%, with no change to how live the dashboard is. Setups where login gives no session (AdGuard with no users, or a reverse proxy that only accepts Basic Auth) fall back to Basic Auth, so nothing needs to change. Reported by [@21mtd](https://github.com/21mtd) in [#58](https://github.com/m00grin/ph-intercept/issues/58).

### Changed

- **Docs** -- the README links the [live demo](https://ph-intercept.com/demo/).
- **CI** -- CodeQL action updated to v4.39.4.

---

## [1.5.7] - 2026-11-18

ph-intercept's first outside contribution! The four new settings below come from Mattheus ([@tioan](https://github.com/tioan)), who wrote up how ph-intercept behaves on shared screens in [#53](https://github.com/m00grin/ph-intercept/issues/53) and then built every piece of it in four small, careful PRs. All four are off by default, so nothing changes until you turn them on. Thank you, Mattheus!

Also new since 1.5.6: ph-intercept is in **Unraid Community Apps** (search "ph-intercept" in the Apps tab; the template includes the new settings), and there's a **live demo at [ph-intercept.com](https://ph-intercept.com)**, the real dashboard running on made-up traffic in your browser, in Pi-hole, AdGuard Home, and Technitium versions.

### Added

- **`READ_ONLY` for wall displays and shared pages** -- set it to `true` and the server refuses anything that would change your DNS server (the blocking toggle, filter/gravity updates, 2-player mode) with a 403, while status and stats keep updating. The HUD leaves those controls inert. Until now, anyone who could open the page could turn blocking off. By [@tioan](https://github.com/tioan) in [#55](https://github.com/m00grin/ph-intercept/pull/55).
- **`HIDE_CLIENT` keeps client names out of the browser** -- the server drops each query's client name or IP before sending it, so it can't be read from the page or the browser's network tab, and the in-app `CLIENT` toggle is hidden. By [@tioan](https://github.com/tioan) in [#54](https://github.com/m00grin/ph-intercept/pull/54).
- **`HIDE_DOMAIN` sends opaque tokens instead of domains** -- every domain is replaced with a token before it reaches the browser (HMAC-SHA256 with a fresh random key at each start, so tokens can't be matched against a list of common domains). Repeat queries still group into tiers; domain labels, the letters on a kill, and the `DOMAIN` toggle are left out. `*_IGNORE_DOMAINS` still matches the real domain. By [@tioan](https://github.com/tioan) in [#57](https://github.com/m00grin/ph-intercept/pull/57).
- **`PIHOLE_IGNORE_CLIENTS`, `ADGUARD_IGNORE_CLIENTS`, `TECHNITIUM_IGNORE_CLIENTS`** -- like `*_IGNORE_DOMAINS`, but for whole clients: comma-separated regex patterns matched against the client name and IP (just the IP for Technitium, which logs no name). Queries from a match spawn no ships. Handy for uptime monitors or the box the dashboard runs on. By [@tioan](https://github.com/tioan) in [#56](https://github.com/m00grin/ph-intercept/pull/56).
- **New logo and intro** -- a new logo, favicon, and iOS home-screen icon, and a new intro: the flagship flies through, burns its thrusters, and warps out into the live background. With "reduce motion" on, the intro is a still title card. Dashboards that link to `/static/icons/favicon.svg` get the new logo.

### Changed

- **True black background** -- the page background is now `#000` (was `#08080b`), so nothing shows through before the background draws.
- **Smaller star data** -- the starfield's star file drops from 452 KB to 402 KB by removing notes the app never read.
- **Docs** -- the README now names the star data's license (HYG Database, CC BY-SA 4.0). New SVG logos in `docs/brand/` for dashboards and icon sets. New contributing guide, code of conduct, pull request template, and feature request form, plus status badges on the README. The Docker Hub page now loads its images from ph-intercept.com, which keeps it under Docker Hub's size limit without dropping any setup steps.
- **CI** -- workflow tokens now default to no permissions, and new checks fail when the Unraid template or the CasaOS/ZimaOS app falls out of step with the code (a renamed setting, a wrong default or port, and for Unraid, any missing setting).

---

## [1.5.6] - 2026-11-14

### Added

- **ph-intercept is now on [Docker Hub](https://hub.docker.com/r/m00grin/ph-intercept)** -- `docker pull m00grin/ph-intercept` works from this release on, and it's easier to find from Docker Hub search, Portainer, and other tools that browse Docker Hub. It's the same image as `ghcr.io/m00grin/ph-intercept`, with the same tags and platforms, so existing setups don't need to change. The Docker Hub page carries the full setup for Pi-hole, AdGuard Home, and Technitium. `:develop` stays on GHCR only.
- **Bug report form** -- new issues ask for the DNS server, image tag, platform, and the `docker logs` lines that name most setup problems. Questions and ideas go to Discussions, security reports to the private advisory form.

### Fixed

- **HUD stats overlapping on mid-width screens** -- between roughly 960 and 1125 px wide (small laptops, tablets in landscape) the four STATS numbers ran into each other, and two columns could overlap below that. Columns are now fitted to the numbers actually on screen, so the HUD shows as many as fit and drops one before anything collides. Applies to both players in 2-player mode.
- **Counts just under a million** briefly showed as `1000.00K`; they now switch to `1.00M`.

### Changed

- **Docs** -- a live demo GIF, a background gallery, and sharper 2x screenshots throughout. The AdGuard and Technitium guides now link to the main README for gameplay and list only what differs for their provider. Each README gained Troubleshooting and Privacy sections. The Docker Hub page carries all three providers' setup steps, so Docker Hub readers aren't sent to GitHub to install.
- **Font license included** -- the bundled fonts (IBM Plex Mono, Orbitron, Press Start 2P) now ship with their SIL Open Font License text, as the license requires.

---

## [1.5.5] - 2026-11-07

### Security

- **Other websites can no longer control your DNS server through ph-intercept** -- any page you visited could send a background request that turned blocking off, started a gravity/filter update, or changed 2-player mode. Cross-site requests to those controls are now refused. Scripts and integrations that call the API directly (curl, Home Assistant) work as before.

### Fixed

- **`linux/arm/v6` image crashing on ARMv6 boards** -- 1.5.4's arm/v6 image shipped an ARMv7 build of MarkupSafe, which ARMv6 CPUs (Raspberry Pi Zero, Zero W, Pi 1) can't run. arm/v6 now uses MarkupSafe's pure-Python build, the same as `linux/386`. Other platforms are unchanged.
- **AdGuard timed disables surviving a restart** -- timed disables now use AdGuard Home's own timer. Previously the timer only lived inside ph-intercept, so restarting or updating the container mid-disable (for example during TOMORROW) left protection off. The HUD countdown now shows for AdGuard too.
- **2-player mode using up Pi-hole logins** -- turning on local 2-player mode with Pi-hole left a session open on the second Pi-hole every time, and Pi-hole allows 16 by default. If Pi-hole is rate-limiting logins, the message now says so instead of pointing at the password.
- **Blank screen when browser storage is blocked** -- for example when ph-intercept is embedded in a dashboard on another hostname with third-party cookies blocked. The game now starts regardless.
- **Malformed API requests** now get a 400 instead of a server error.

### Changed

- **Setup problems are now logged** -- a wrong password, an unreachable server, a wrong URL, a missing Technitium query-log app, or an unrecognised `PROVIDER` each log one clear warning to `docker logs`, plus one line when it recovers. Passwords and tokens are never logged.
- **Base image bumped to Python 3.15** (`python:3.15-alpine3.24`). The image is about 7 MB larger, from upstream's 3.15 base.
- **Docs** -- the Pi-hole README now lists the `PIHOLE2_*` variables, and the page description names the active provider.

---

## [1.5.4] - 2026-11-07

### Security

- **Bundled CA certificates refreshed** -- the image now ships `certifi` 2026.10.19 or later, which drops the `emSign ECC Root CA - G3` root whose intermediate CAs had compromised keys ([GHSA-6q48-6c7w-9gw2](https://github.com/advisories/GHSA-6q48-6c7w-9gw2)). Only affects HTTPS connections to your DNS server with certificate verification on.
- **GitHub Actions pinned to commit SHAs** across all workflows, so a moved upstream tag can't change what runs in CI.

### Changed

- **Dependency bumps** -- `starlette` 1.6.0 -> 1.10.0, `uvicorn` 0.52.4 -> 0.54.0.
- **Main README compose example** now uses `intercept_net`, finishing the 1.5.3 network rename. Docs only, no functional change.

---

## [1.5.3] - 2026-09-01

### Security

- **Base image packages upgraded at build time** -- `apk upgrade --no-cache` now runs during the Docker build (replacing an unpinned `pip install --upgrade pip` step), pulling in Alpine's fixed `libssl3`/`libcrypto3` and `sqlite-libs` packages and closing out several openssl and SQLite CVEs flagged against the published image.
- **Container root filesystem is now read-only** (`read_only: true`) across all three compose files (main, AdGuard Home, Technitium).
- **Dropped unused `contents: write` permission** from the publish workflow.

### Changed

- **Dependency bump** -- `uvicorn` 0.52.3 -> 0.52.4.
- **De-duped `latest` tag application** on tagged releases in the publish workflow.
- **Example custom network renamed** `dns_net` -> `intercept_net` across READMEs and compose examples for consistency. Docs only, no functional change.

---

## [1.5.2] - 2026-08-17

### Added

- **`linux/ppc64le` build** -- added to the multi-arch image.
- **Container healthcheck** -- polls `/api/2p/status` every 30s so a wedged process gets restarted.

### Changed

- **Smaller image** -- base bumped to `python:3.14-alpine3.24`; stripped `tkinter`, `idlelib`, `turtledemo`, `pydoc_data`, and `apk` from the image after install.
- **`requirements.txt` bind-mounted** during build instead of copied into a layer.
- **Graceful shutdown capped at 2s** (`--timeout-graceful-shutdown 2`) so `docker compose down` doesn't hang on a slow container.
- **Dependency bumps** -- `starlette` 1.4.1 -> 1.6.0, `uvicorn` 0.52.1 -> 0.52.3.
- **HUD strip extracted from `render()`** into `static/js/hud.js`; P1/P2 game state collapsed into shared player objects. Internal refactor, no behavior change.

### Security

- **`uvicorn` `Server` header dropped** from HTTP responses to reduce fingerprinting.

---

## [1.5.1] - 2026-07-04

### Added

- **CRT filter** -- a selectable retro CRT overlay effect. Toggle it from the in-game settings menu. Thanks to [@andrewmsprague](https://github.com/andrewmsprague) for the idea.
- **HUD auto-hide** -- the HUD strip slides away when idle and returns on interaction (touch-compatible). Toggle it from settings.
- **In-app background picker** -- switch the background live from the settings menu (starfield, nebula, outrun, dark, or a custom image), with a sky-preset submenu for the starfield. Your pick is remembered per-browser; the compose/env values remain the default, so existing deployments are unchanged.
- **`outrun` background** -- an animated synthwave scene. Pairs well with the CRT filter.

### Changed

- **`dark` background** -- now renders true black instead of the previous dark grey.

---

## [1.5.0] - 2026-07-03

### Added

- **Technitium DNS support** (`PROVIDER=technitium`): live query feed, stats, and blocking control (toggle, timed disable, force block-list update). Token or user/password auth. Requires the Query Logs (Sqlite) DNS app. See the [Technitium guide](technitium/README.md). Thanks to [@ArcticSlayy](https://github.com/ArcticSlayy) for the code headstart on Technitium support.
- **Technitium local 2-player mode** via `TECHNITIUM2_URL` + `TECHNITIUM2_TOKEN`.

---

## [1.4.0] - 2026-06-30

### Added

- **Local 2-player mode** -- two DNS instances side by side in split-screen, each with its own events, stats, and controls. Pairs two Pi-holes (`PIHOLE2_URL` / `PIHOLE2_PASSWORD`) or two AdGuard Home instances (`ADGUARD2_URL` / `ADGUARD2_USERNAME` / `ADGUARD2_PASSWORD`). Enable it from the in-game 2-player panel.

### Changed

- **Crisp rendering under fractional display scaling** -- canvases render at device-pixel resolution, so scaling like Windows 150% no longer looks blocky.

### Fixed

- **Ground crew during timed disables** -- the 30-second crew-emerge timer was reset by the live countdown, so crew never appeared for timed disables. Now tracked from when blocking turns off.
- **Resize while docked** -- docked ships and crew stay on the carrier instead of drifting off when the window is resized.
- **Ship-menu SELECT tap target** -- enlarged to match the visible control.

### Infrastructure

- Bumped `starlette` to 1.3.1 and `uvicorn` to 0.49.0.

---

## [1.3.4] - 2026-05-27

### Security

- **Pinned all dependencies** -- `starlette==1.1.0` (patches a vulnerability disclosed 2026-05-27), `uvicorn==0.48.0`, `httpx==0.28.1`, `jinja2==3.1.6`. Previously the image was built against unpinned versions, so affected builds should pull the updated image.

---

## [1.3.3] - 2026-05-12

### Fixed

- **Image pull failure** -- the cleanup action (`actions/delete-package-versions`) was deleting platform-specific manifests that make up multi-architecture images, leaving the manifest index pointing to missing digests. Switched back to `dataaxiom/ghcr-cleanup-action` which is multi-arch aware and skips manifests referenced by a tagged image. Provenance attestation (`mode=max`) restored. Sorry, I'm still learning!

---

## [1.3.2] - 2026-05-11

### Fixed

- **Image pull failure** -- disabled provenance attestation. (Wrong fix -- see 1.3.3.)

---

## [1.3.1] - 2026-05-11

### Fixed

- **Image pull failure** -- downgraded provenance from `mode=max` to `mode=min`. (Wrong fix -- see 1.3.3.)

---

## [1.3.0] - 2026-05-11

### Added

- **AdGuard Home support** -- ph-intercept now works with AdGuard Home. A dedicated `adguard/compose.yaml` and `adguard/README.md` are included; drop it in alongside your existing AdGuard Home instance, fill in your URL and credentials, and go. Pi-hole behavior is unchanged. Thanks to [@matthijsbro](https://github.com/matthijsbro) (dnsshooter) for the code headstart on AdGuard support.
- **Timed disable for AdGuard** -- the shield menu offers six durations: 30 sec, 1 min, 10 min, 1 hr, until tomorrow (seconds until midnight, computed at click time), and indefinite. The server auto-re-enables protection after the chosen duration.
- `ADGUARD_IGNORE_DOMAINS` -- comma-separated regex patterns; matching domains are filtered from the event stream and spawn no ships. Same behavior as `PIHOLE_IGNORE_DOMAINS`.

### Changed

- HUD GRAVITY panel is labelled **FILTER** for AdGuard. Gravity/filter rule count formatting improved for both providers -- comma-separated below 100K, consistent K/M decimal precision above.
- Provider icon, dashboard link, and settings panel label adapt to the active provider.
- `shadowBlur` removed from entity client and domain text rendering -- measurable frame-rate improvement, particularly on lower-end hardware.

### Fixed

- **Intercept menu hover hitbox** -- hover detection used `<=` on the right and bottom edges, causing a one-pixel overlap into the adjacent slot.

---

## [1.2.0] - 2026-05-10

### Added

- **Three new ships**: Serenity, Normandy, and the Planet Express Ship.
- **Expanded ship menu** -- now shows 8 slots in a 4×2 grid (compact screens: 2×4), replacing the old single-row 4-slot layout.
- **Sleep-detection timer** -- a `setInterval` now monitors `Date.now()` for jumps and invalidates the sprite cache on machine wake. This covers the remaining blind spot where neither `visibilitychange` nor `window focus` fires (tab already focused when the machine sleeps).

### Changed

- Carrier expanded to accommodate the new ships.

### Fixed

- **Drone missile tracking** -- missiles now re-compute heading toward the target's live position every frame. Previously the bearing was locked at fire time, causing drones to miss enemies that had moved.

### Visual

- Enterprise bitmap extended; nacelle positions and impulse drive flare adjusted. Impulse drive now renders in fire colors (orange/red) instead of blue. Thanks to [@andrewmsprague](https://github.com/andrewmsprague) for the NCC-1701 impulse drive tips.
- Drone explosions tuned: 80→50 particles, smaller radii, 1300ms→900ms duration, tighter blast rings.
- `dimColor` opacity raised across all ships for better visibility when docked in the carrier menu.
- Gravity update arrow larger.
- Splash screen tagline minimum font size bumped from 11 to 12 px.

### Infrastructure

- Docker base image switched from `python:3.14-slim` to `python:3.14-alpine3.23`, meaningfully reducing image size.
- `PYTHONDONTWRITEBYTECODE=1` and `PYTHONUNBUFFERED=1` added to the image environment.
- `pip`, `setuptools`, and `wheel` removed from the final image layer.
- Non-root user now created with `-H` (no home directory) and `-s /sbin/nologin` (no login shell).

---

## [1.1.6] - 2026-05-09

### Fixed

- **Sprite visibility after foreground idle** -- enemy and friendly bitmaps could become invisible if the browser window stayed open and focused while the machine was inactive. When no tab switch or minimize occurs, `visibilitychange` never fires; the browser can still silently reclaim GPU-backed offscreen canvas memory. The sprite cache is now also invalidated on `window focus` so sprites are rebuilt when the user returns.

---

## [1.1.5] - 2026-05-09

### Security

- Container now runs as a non-root user (uid 1000) with ownership scoped to `/app`.
- All Linux capabilities dropped via `cap_drop: ALL` in `compose.yaml`.
- Hadolint Dockerfile linting added to the CodeQL workflow; findings surface in the GitHub Security tab on tagged releases.

### Added

- `PIHOLE_IGNORE_DOMAINS` -- optional comma-separated regex patterns; matching domains are filtered from the event stream and spawn no ships. Case-insensitive. Example: `.*\.local$,.*\.internal$`. Thanks to [@jamespo](https://github.com/jamespo) for the idea.

### Changed

- Switched from FastAPI to Starlette, reducing dependencies and improving compatibility across ARM architectures.
- Docker build now targets six platforms: `linux/amd64`, `linux/arm64`, `linux/arm/v7`, `linux/arm/v6`, `linux/386`, `linux/riscv64`.

### Visual

- Settings button bars now explode into three independently floating animated lines when the menu opens, with staggered spring transitions on open and a crisp snap-back on close.
- Clicking inside an open menu no longer closes it; only clicks outside dismiss it.
- Ship menu hover now correctly highlights only one slot at a time.
- Splash screen: black fill on first paint prevents a white flash; text centering corrected for the PH and tagline elements; resize skips if dimensions are unchanged.

---

## [1.1.4] - 2026-05-07

### Fixed

- **Pi-hole v6 passwordless mode** -- authentication now checks the `session.valid` flag rather than sid presence, so instances with no password set are handled correctly. Thanks to u/Xanderlicious for the report.
- **Pi-hole v6 query status coverage** -- EDE-blocked queries (string status `"EDE"`, integer status 18) are now counted as blocked; cached-stale queries (status 17) are now counted as cache hits. The stale `"BLACKLIST"` string status has been removed.
- **Carrier state race** -- the carrier now correctly departs if blocking is re-enabled before it finishes arriving (triggered by a rapid external toggle or returning from a backgrounded tab).
- **Pihole mode exit race** -- if `enterPiholeMode` was called while the exit animation timer was still pending, the game would bail out and stay dead. The timer is now cancelled and the game restarts cleanly.
- **Starfield degradation** -- if `stars-lite.json` fails to load, the starfield now falls back gracefully instead of getting stuck before rendering.
- **Background image injection** -- `BG_IMAGE` is now validated as a local path or `http(s)://` URL before being written into CSS; character encoding expanded to cover `"`, `'`, and `\`.

### Security

- Added `Content-Security-Policy` and `Referrer-Policy` response headers.
- Block timer values submitted via the API are now validated as positive integers server-side; invalid or negative values are discarded.
- Pi-hole dashboard link (HUD and settings menu) now validates `https?://` before calling `window.open`.
- ESC navigation now explicitly rejects `javascript:` and `data:` scheme values in `RETURN_URL`. Other schemes remain supported.

### Docs

- `RETURN_URL` documentation in README and `compose.yaml` updated to clarify the full range of accepted URL schemes.
- Meta description added to the page `<head>`.

### Visual

- Enemy sprites are now rendered with `imageSmoothingEnabled` on, reducing jaggies when rotated.

### Housekeeping

- Added `.dockerignore` to keep build contexts lean.
- Trimmed `uvicorn[standard]` to bare `uvicorn`, removing unused high-throughput extras and reducing the image size.
- `query_poller` tick errors are now logged at debug level instead of being silently swallowed.

---

## [1.1.3] - 2026-05-07

### Fixed

- **Domain Management blocks** -- domains blocked via Pi-hole's exact denylist now correctly intercepted as enemies. Thanks to [@AzuraLemonade](https://github.com/AzuraLemonade).
- **Embedding** -- removed the `X-Frame-Options: DENY` header; PH Intercept can now be embedded in external dashboards. Thanks to [@AzuraLemonade](https://github.com/AzuraLemonade).

---

## [1.1.2] - 2026-05-07

### Fixed

- **Game loop revival on tab switch** -- switching away from the tab and back could leave the canvas permanently blank until a page refresh. Browsers can freeze or drop a pending `requestAnimationFrame` callback when a tab is backgrounded; the visibility-restore handler now cancels and reschedules the rAF loop so it always resumes correctly.
- **Release notes scope** -- GitHub releases now show only the current version's changelog section instead of the full history.

---

## [1.1.1] - 2026-05-07

### Fixed

- **Sprite visibility after sleep/wake** -- entity sprites (friendlies and baddies) could become invisible after the computer slept and resumed. The browser silently clears off-screen canvas pixel data on resume; the sprite cache is now invalidated on visibility restore so sprites are rebuilt on next use.

---

## [1.1.0] - 2026-05-06

### Added

- **Settings menu** -- hamburger button in the HUD opens an on-canvas panel for display options and links. The Pi-hole dashboard link has moved here from its previous fixed position in the HUD. Choices are persisted to `localStorage`.
- **Client label display** -- entities can now show the requesting client (IP or hostname) as a label above the domain. Toggle it on from the settings menu.
- **Display toggles** -- show/hide friendly entities, domain labels, and client labels independently via the settings menu.
- **`PIHOLE_VERIFY_SSL` env var** -- set to `"false"` if your Pi-hole uses HTTPS with a self-signed certificate. Defaults to `"true"`. See `compose.yaml` for usage. Thanks to [@hassan-odimi](https://github.com/hassan-odimi) for the idea.
- **Improved mobile display** -- `viewport-fit=cover` and `env(safe-area-inset-bottom)` for better layout handling on mobile devices.
- **Memory limit** in `compose.yaml` (256 MB cap).

### Performance

- **Sprite cache** -- pixel-art bitmaps are now pre-rendered with shadow/glow to an `OffscreenCanvas` once per unique (sprite, color, glow) combination. Each frame uses a single `drawImage` call per entity instead of many shadow-blurred `fillRect` calls, significantly reducing per-frame canvas overhead at higher entity counts. This should make the game noticeably smoother across a wider range of hardware.

### Fixed

- **Drone re-dock behavior** -- drones now re-dock when 1 or fewer enemies remain on screen. Previously they would not dock until the screen was completely clear.
- **Drone targeting zone** -- drones were targeting entities anywhere on screen, including near display edges. Target selection is now clamped to the safe playfield area.
- **Friendly entity tiers** -- allowed entities were not incrementing their hit count, so friendly sprites were always stuck at tier 1 regardless of repeat queries. Friendlies now correctly display tier 2 and tier 3 sprites when the same domain appears multiple times while on screen.
- **Friendly entity brightness** -- friendly entity sprites are slightly dimmed for a cleaner overall look alongside blocked entities.
- **Background image injection** -- double-quotes in `BG_IMAGE` paths are now percent-encoded before being placed in the CSS `url()`, preventing broken styles with certain paths.
- **HUD panel overflow** -- INTERCEPT, GRAVITY, and SHIPS panels now clip their content to their own bounds, preventing edge-case draw bleed into adjacent panels.
- **SSE reconnect** -- the event stream reconnect delay now backs off exponentially on repeated failures (starting at 3 seconds, doubling up to 60 seconds max) and resets on a successful connection. Reduces noise when Pi-hole is temporarily unreachable.

### Security

- Added `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY` response headers.
- Internal exception details from `toggle_blocking` and `trigger_gravity_update` are no longer forwarded to the client. A generic error is returned and the full traceback is logged server-side. (Flagged by CodeQL.)

### Removed

- DSO cluster and galaxy rendering code from `dso-render.js`. This was removed to prevent potential ugly gradient renders bleeding into the background. The starfield is unaffected.

---

## [1.0.0] - 2026-05-04

Initial public release.
