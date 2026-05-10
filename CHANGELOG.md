# Changelog

All notable changes to ph-intercept are documented here.

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
