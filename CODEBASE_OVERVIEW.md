# Codebase Overview

A Bun monorepo for Control Center: a fixed-panel smart-home wall dashboard, its
tRPC API, background reconciliation workers, and the Pulumi-managed Kubernetes
deployment that runs all three. Read `AGENTS.md` for the invariants and
workflow rules; this file is the map.

The repo went through **The Simplification** (docs/adr/0013): about 73% of it
— unused products, Temporal, a durable job queue, 15 features, Storybook, and
most of the settings surface — was deleted in one PR because it cost more to
run and explain than it returned. What is described below is what survived.

## Runtime shape

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
  -> push to main -> GitHub Actions (amd64 images to GHCR)
  -> Pulumi (infra/, stack `home-server`)
  -> Talos Kubernetes on home-server (192.168.0.5)
```

## Workspace layout

- `apps/api` — Bun + tRPC backend: DB schema/migrations, the base router
  (health, settings, device-settings), merged with the generated
  feature router.
- `apps/worker` — the interval-cycle process: desired-state reconciliation,
  weather ingest/purge.
- `apps/web` — the React board, the Capacitor iOS kiosk shell (`apps/web/ios`),
  and the phone view.
- `apps/manage` — a static nginx bundle at `manage.worldwidewebb.co`: an
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
  runtime target (`homelabTarget` — the deployment target abstraction, not a
  reference to the retired Mac mini; see Infra below), secret catalog, env
  registry, database/backup manifests, and the Control Center product
  manifest Pulumi reads. `genId()` (Stripe-style `prefix_<id>` minting) lives
  here too.
- `infra` — the Pulumi program (`infra/program.ts` + `infra/src/*.ts`) that
  declares the whole `home-server` stack. `infra/cloudflare` is a separate
  Pulumi project for tunnel routes and Access apps.

Dependency boundaries between `packages/*`, `features/*`, and `apps/*` are
enforced by a Biome `noRestrictedImports` rule.

## Frontend

`apps/web/src/routes/index.tsx` renders `Board` on the panel or `MobileBoard`
on a phone (`useIsMobile()` in `lib/mobile.ts`), chosen once at the route —
never as a branch inside `Board`. The two share no chrome: `MobileBoard` is a
scroll column of two tile faces (Controls, Climate · A/C) plus the Settings
gear; `Board` mounts the camera, the idle-dim session, and the banner stack
that a phone must never start.

The panel is a fixed `1366x1024` world, not a responsive layout
(`lib/grid-constants.ts`: `BOARD_W = 1366`, `BOARD_H = 1000`, a 64x64-cell
grid). `PanelFrame.tsx` enforces this on a desktop browser (framing the app
like a device instead of stretching it) and is a no-op passthrough on native
and on `MobileBoard`.

- **Tiles**: 8 total (`tiles.gen.ts`) — `tile_ctrl` (Controls, the sole
  `home: true` tile and the glide-home target), `tile_clock` (Clock,
  face-only), `tile_ac` (Climate · A/C, face-only), `tile_weath` /
  `tile_hourly` (Weather, face-only), `tile_booth` (Photo Booth, `private`),
  `tile_wakes` (Activity, `sensitive`), `tile_sound` (Sound System). A Tile
  needs zero or one Tile View, not exactly one — a face-only tile (clock, A/C,
  weather) has no detail surface at all.
- **Camera**: pointer pan + glide-home only (`lib/board-camera/`). No snap
  modes, no minimap.
- **Idle dim**: hardcoded on, 60000ms timeout, dim level 30
  (`lib/settings.ts`), driving `DimOverlay` (`<DimOverlay
  active={sessionPhase === "ended"} onWake={wake} />`, unconditional — there is no
  `LockScreenOverlay`). The panel's real backlight is driven the same way
  through `lib/brightness.ts` / the native `ScreenBrightness` plugin.
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

The tRPC root router (`apps/api/src/trpc/routers/index.ts`) merges a small
`baseRouter` (health, settings, device-settings) with the generated
`featureAppRouter` (one slice per feature in `features/*/api.ts`).
`packages/api` re-exports only the `AppRouter` type, so `web` gets typed tRPC
without bundling backend code.

## Database

Nine tables survive The Simplification (down from a much larger set; see
ADR-0013 for the full list of what was dropped): `settings`,
`device_settings`, `lamp_mode`, `booth_photo`, `wake_photo`,
`weather_reading`, `weather_daily_reading`, `device_state`,
`integration_sync_status`. The Drizzle schema is
`apps/api/src/db/schema.ts` plus each feature's own `schema.ts`, composed
into `features/_generated/schema.gen.ts`. Both `api` and `worker` run
migrations at boot, so whichever starts first prepares the schema safely.

`settings` and `device_settings` are each a single JSONB blob
(`services/settings-service.ts`, `services/device-settings-service.ts`) so a
field can be added or retired without a column migration; zod strips a
retired key on read rather than erroring.

## Workers

`apps/worker` owns process lifecycle, metrics, migrations, and graceful
shutdown; each feature owns its own cadence in `worker.ts`, composed into
`features/_generated/workers.gen.ts`. Six cycles are registered:
`light-enforcer` (1s), `device-sync` (1s), `party-mode` (2s) — the lamp
reconciliation loop, untouched by The Simplification — `climate-enforcer`
(1s), `weather-ingest` (5m), and `weather-purge` (the worker cycle that
replaced the deleted `WeatherPurgeWorkflow`). `features/sound/worker.ts`
registers no cycles (`defineWorkerCycles([])`) — there is no
`sonos-volume-enforcer`. No queue, no scheduler: a feature that needs
recurring backend work writes a `worker.ts` cycle; a feature that needs
calendar-scheduled infra work is a Kubernetes CronJob in
`infra/src/crons.ts` (the control-center and Home Assistant Postgres logical
backups — both `pg_dump`, no config backup).

## Deployment

Prod is a **single-node Talos Linux** Kubernetes cluster, `home-server`
(`192.168.0.5`, amd64, RTX 3060) — the only production environment. See
`AGENTS.md` for the no-SSH / `talosctl` rule.

- `infra/src/services.ts` — the four app workloads (api, worker, web, manage)
  plus Home Assistant and Grafana exposure.
- `infra/src/crons.ts` — Kubernetes CronJobs.
- `infra/src/cnpg.ts` / `certmanager.ts` / `eso.ts` / `cluster.ts` — Postgres,
  TLS, secrets, and the base cluster/namespace setup.
- `infra/src/observability/` — Prometheus, Loki, Grafana, Alloy,
  node-exporter, kube-state-metrics: hand-rolled Pulumi resources, no Helm, no
  operator (ADR-0007). See `docs/observability.md`.
- `infra/cloudflare` — tunnel ingress + Access apps for every private/public
  hostname, product-derived from the platform manifest.

GitHub Actions builds amd64-only images (native runners, no QEMU), writes
Pulumi digest pins (`wwwinfra:imageDigests.*`), then runs `pulumi up --stack
home-server`. Push to `main` triggers this. CI is product-aware: path filters
build only what changed plus its shared-package dependents.

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
