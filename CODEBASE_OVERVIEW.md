# Codebase Overview

A Bun monorepo for Control Center: a fixed-panel smart-home wall dashboard, its
tRPC API, background reconciliation workers, and the Mac mini Docker
deployment that runs all three. Read `AGENTS.md` for the invariants and
workflow rules; this file is the map.

The repo went through **The Simplification** (docs/adr/0013): about 73% of it
— unused products, Temporal, a durable job queue, 15 features, Storybook, and
most of the settings surface — was deleted in one PR because it cost more to
run and explain than it returned. What is described below is what survived.

## Runtime shape

WWW-76 consolidates production into one `www` Bun process: `apps/api/src/www.ts`
starts the API lifecycle in `application.ts`, the generated worker cycles, and
host-routed static builds of web and manage. `bun run build:www && bun run www`
runs it locally. `WORKER_CYCLES=off` disables cycles. PostgreSQL remains the
production database; SQLite is optional future work. The root Dockerfile builds
one ARM64 image for OrbStack on the mini, serving web and manage by hostname.

```text
iPad panel / phone browser
  -> web (React board, or MobileBoard on a phone)
  -> /trpc same-origin HTTP
  -> api (Bun + tRPC server)
  -> features/<id>/api.ts router slices, merged into featureAppRouter
  -> Home Assistant / Sonos / Postgres / device-local media

background reconciliation
  -> worker
  -> features/_generated/workers.gen.ts (App-owned interval cycles)
  -> desired-state reconciliation, weather ingest

deploy
  -> push to main -> successful hosted CI
  -> ARM64 image digest in GHCR -> Tailscale SSH
  -> deploy/mini/release.sh -> OrbStack on the Mac mini
```

## Workspace layout

- `apps/api` — Bun + tRPC backend: DB schema/migrations, the base router
  (health, settings, device-settings), merged with the generated
  feature router.
- `apps/worker` — the interval-cycle process: desired-state reconciliation,
  weather ingest/purge.
- `apps/web` — the React board and phone view.
- `apps/panel` — the Expo iOS kiosk shell that loads the hosted React board.
  Each launch bypasses cached HTML immediately (while retaining immutable asset
  caching), including entries cached before the server sent `no-cache`
  (`docs/panel-startup.md`).
  It remounts the WebView (cache-busted, with backoff) until the page reports
  that `#root` rendered (`apps/panel/boot-recovery.ts`), so a failed boot
  never sticks on a blank screen. The consolidated server serves `index.html` `no-cache` and
  `/assets/` as immutable with no SPA fallback, so a stale entry can't name a
  bundle a deploy removed.
- `apps/manage` — a static bundle served by www at `manage.worldwidewebb.co`: an
  iframe shell over the small set of ops tools this repo doesn't own
  (`apps/manage/src/registry.ts`), gated by Cloudflare Access alone. See
  ADR-0010.
- `features/<id>/` — one folder per self-contained App: `ac`, `booth`, `ctrl`,
  `events`, `sound`, `wakes`, `weather`. Each has a `manifest.ts` (id, tile
  placement, access policy) plus whichever facets it needs — `web.tsx` (tile
  face), `detail.ts` (Tile View declaration), `api.ts` (tRPC router slice),
  `http.ts` (raw HTTP routes, e.g. `ac`/`booth`/`wakes`), `worker.ts` (interval
  cycles), `schema.ts` (owned tables). See ADR-0001.
- `features/_generated/*.gen.ts` — committed codegen output from
  `bun run apps:gen`: `tiles.gen.ts`, `web.gen.ts`, `router.gen.ts`,
  `workers.gen.ts`, `http.gen.ts`, `schema.gen.ts`. Never hand-edit; `bun run
  apps:check` fails on drift. See ADR-0002.
- `app-kit` — the `defineApp`/manifest types and server-side router-merging
  helpers every feature's `manifest.ts`/`api.ts` imports.
- `packages/api` — a browser-safe type bridge: re-exports the API router type
  and the settings/device-settings wire contracts, nothing else.
- `packages/core` (`@www/core`) — owns the `device_state` table end to end:
  schema, the `DeviceStateStore` interface, a pg adapter and an in-memory
  adapter for tests, and the desired/reported merge logic. Five writers
  (light, climate, sonos-volume, device-sync, the shared desired-state-store)
  and every reader go through this store. See ADR-0005.
- `packages/logger` — `createLogger`/`getLogger`, with a redaction denylist
  for anything that might get logged whole (`docs/logging.md`).
- `packages/theme` — the shared CSS the `web` and `manage` bundles both
  `@import`, so one dark theme serves both.
- `packages/worker-runtime` — the shared interval-cycle scheduler: prevents a
  cycle from overlapping itself, isolates a cycle's failure from the others,
  and exposes stats.
- `packages/platform` (`@www/platform`) — product identity, the single
  runtime target (`homelabTarget`), secret catalog, env
  registry, and the Control Center product
  manifest Pulumi reads. `genId()` (Stripe-style `prefix_<id>` minting) lives
  here too.
- `deploy/mini` — Compose, releases, backups and host startup.
- `infra/cloudflare` — retained Pulumi edge configuration (DNS, Access, ingress).

Dependency boundaries between `packages/*`, `features/*`, and `apps/*` are
enforced by a Biome `noRestrictedImports` rule.

## Frontend

`apps/web/src/routes/index.tsx` renders `Board` on the panel or `MobileBoard`
on a phone (`useIsMobile()` in `lib/mobile.ts`), chosen once at the route —
never as a branch inside `Board`. The two share no chrome: `MobileBoard` is a
scroll column of two tile faces (Controls, Climate · A/C) plus the Settings
gear; `Board` mounts the fixed tile view, the idle-dim session, and the banner stack
that a phone must never start.

The panel is a fixed `1366x1024` viewport, not a responsive layout
(`lib/grid-constants.ts`: `BOARD_W = 1366`, `BOARD_H = 1000`, a 64x64-cell
grid). `PanelFrame.tsx` enforces this on a desktop browser (framing the app
like a device instead of stretching it) and is a no-op passthrough on native
and on `MobileBoard`.

- **Tiles**: 9 total (`tiles.gen.ts`) — `tile_ctrl` (Controls, the sole
  `home: true` tile), `tile_clock` (Clock,
  face-only), `tile_ac` (Climate · A/C, face-only), `tile_weath` /
  `tile_hourly` (Weather, face-only), `tile_booth` (Photo Booth, `private`),
  `tile_wakes` (Activity, `sensitive`), `tile_sound` (Sound System),
  `tile_wifi` (Wi-Fi, face-only: the guest-network join QR drawn straight on
  the tile and enlarged in a local modal when tapped, fed by the api's required
  `WIFI_GUEST_SSID`/`WIFI_GUEST_PASSWORD`
  secrets, from `secretCatalog.wifiGuest`). A Tile needs zero or one Tile View, not exactly one — a face-only
  tile (clock, A/C, weather, Wi-Fi) has no detail surface at all.
- **Board layout** (`features/*/manifest.ts` world coords, 12x9 cells): the
  top two-thirds are Clock (5x3) over Sound System (5x3) (left) · Photo
  Booth / Activity / Wi-Fi (2x2 stacked, middle) · Controls (5x6, right).
  The bottom row is Climate · A/C · Weather Now · Next 12 Hours (4x3 each).
- **Board position**: centered once on the nine tile bounds. The world is
  offset inside a clipped stage, which never scrolls or recenters on tile
  activation.
- **Idle dim**: hardcoded on, 60000ms timeout, dim level 30
  (`lib/settings.ts`), driving `DimOverlay` (`<DimOverlay
  active={sessionPhase === "ended"} onWake={wake} />`, unconditional — there is no
  `LockScreenOverlay`). The panel's real backlight is driven the same way
  through `lib/brightness.ts` / Expo Brightness in the panel shell.
- **PIN**: one shared PIN Session (`components/pin/`) gates every `sensitive`
  App for the rest of the panel session; `private` (Photo Booth) re-prompts on
  every opening. `pinCode` is a synced setting, enforced client-only (ADR-0004
  — accepted state until a deferred server-side slice).
- **Settings**: four full-page (`components/settings-page/`) pages — Device
  (name), Display (accent only), Security (PIN only), Time (time zone only).
  `pages.ts` is the registry; nothing else configures the panel.
- **Sound bus**: `playCue()` from `lib/sound/` is the only way to play a
  sound. Never construct `AudioContext`/`Audio` elsewhere — a Biome rule bans
  the raw escape hatch. Loudness is device volume, not in-app gain.

Data access is tRPC React Query (`lib/trpc.ts`): queries retry with bounded
backoff, mutations don't retry, and missing data renders a skeleton or error,
never an invented value.

## API

Entry point `apps/api/src/server.ts`: creates the root logger, runs
migrations, serves with `Bun.serve()`.

- `/up` — liveness.
- `/health/climate` — live Home Assistant climate reachability.
- `/media/wake-photo` (POST) + `/media/wake-photos/*` — the panel's
  wake-from-dim front-camera burst frames.
- `/trpc/*` — tRPC.
- `/api/notifications` plus `/read`, `/dismiss`, `/dismiss-all` and `/stream` —
  durable shared panel notifications with a revision cursor and SSE delivery.
  The `features/notifications` service exports `createNotification()` for backend
  producers; its hourly worker prunes rows dismissed over 30 days ago. See
  [the HTTP/Swift contract](docs/notifications-api.md).

The tRPC root router (`apps/api/src/trpc/routers/index.ts`) merges a small
`baseRouter` (health, settings, device-settings) with the generated
`featureAppRouter` (one slice per feature in `features/*/api.ts`).
`packages/api` re-exports only the `AppRouter` type, so `web` gets typed tRPC
without bundling backend code.

Native clients can read optional per-lamp state, party speed/colour selection,
and Sonos playback position, and seek with `sound.sonosSeek`. Wire semantics and
backward-compatible HTTP fixtures live in `docs/contracts/native-panel/`.

## Database

Nine tables survive The Simplification (down from a much larger set; see
ADR-0013 for the full list of what was dropped): `settings`,
`device_settings`, `lamp_mode`, `booth_photo`, `wake_photo`,
`weather_reading`, `weather_daily_reading`, `device_state`,
`integration_sync_status`. The Drizzle schema is
`apps/api/src/db/schema.ts` plus each feature's own `schema.ts`, composed
into `features/_generated/schema.gen.ts`. The additive `notifications` table and `notification_revision` sequence are owned
by `features/notifications/schema.ts`. Both `api` and `worker` run
migrations at boot, so whichever starts first prepares the schema safely.

`settings` and `device_settings` are each a single JSONB blob
(`services/settings-service.ts`, `services/device-settings-service.ts`) so a
field can be added or retired without a column migration; zod strips a
retired key on read rather than erroring.

## Workers

The production `www` process owns lifecycle, migrations and graceful shutdown.
Each feature declares its cadence in `worker.ts`; the generated registry in
`features/_generated/workers.gen.ts` starts the cycles through the shared worker
runtime. The mini alone owns production cycles. The separate `apps/worker`
entrypoint remains available for local development.

There is no queue or workflow engine. App recurring work is a Worker Cycle;
calendar-scheduled backups run through the mini LaunchAgent and
`deploy/mini/backup.py`, including databases, media and full HA configuration.

## Deployment

Production runs on the Mac mini. OrbStack hosts the single Control Center image,
PostgreSQL, Hindsight, Bambuddy and cloudflared. Home Assistant uses a bridged
Colima VM. The root Dockerfile is validated on native ARM64 in CI; successful
main runs trigger `deploy-mini.yml`, which publishes and releases the tested
revision by immutable digest. Release/recovery scripts serialize changes and
verify the exact SHA, database health and worker ownership.

`infra/cloudflare` retains DNS, Access and tunnel ingress management. Talos
provisioning is retired; its disks remain available for recovery. Backups run
through a mini LaunchAgent and use verified NAS copies. See the
[migration runbook](docs/runbooks/mac-mini-migration.md) and
[backup runbook](docs/runbooks/mini-backups.md).

## Where to start for a feature

New feature: create `features/<id>/` with a `manifest.ts` and whichever
facets it needs, then `bun run apps:gen`. Extending an existing one is a
vertical slice inside its folder — `web.tsx` for the tile, `api.ts` for the
router slice (re-run codegen), `schema.ts` for new tables, `worker.ts` for
recurring background work.

## Further reading

- `docs/adr/` — architectural decisions for what's still here; ADR-0013 is
  the permanent record of what was deleted and why.
- `docs/observability.md` — Grafana dashboards, what replaced each removed
  Prometheus Operator CRD.
- `docs/logging.md` — structured logging and redaction.
- `docs/hardware-inventory.md`, `docs/runbooks/` — the physical node and
  operational runbooks.
- `CONTEXT.md` — the domain glossary (Panel, Board, Tile, App, Worker Cycle, …).
