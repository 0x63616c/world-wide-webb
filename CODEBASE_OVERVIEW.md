# Codebase Overview

This repository is a Bun monorepo for a smart-home wall-panel dashboard. The app is built around a fixed iPad wall panel, a tRPC API, background reconciliation workers, and a Pulumi-managed Kubernetes deployment on `homelab`.

## Runtime Shape

```text
iPad / browser
  -> web React board
  -> /trpc same-origin HTTP
  -> api Bun + tRPC server
  -> api/src/services domain services
  -> Home Assistant / UniFi / Spotify / Postgres / media integrations

background loops and jobs
  -> worker
  -> @control-center/api/worker domain cycles
  -> desired-state reconciliation, weather ingest, party mode, YouTube/media ingest

deploy
  -> GitHub Actions
  -> GHCR arm64 images
  -> Pulumi in infra/
  -> k3s on homelab
```

## Workspace Layout

Single-product repo (SDD track 0, Task 9 flattened `products/control-center/*`
to the root; captive-portal was folded into the guest listener inside `api/`
and its own product folder is gone):

- `web` - React dashboard, Storybook, and Capacitor iOS shell.
- `api` - Bun tRPC backend, DB schema, migrations, routers, services, shared domain logic, and the guest-WiFi listener.
- `worker` - Continuous interval workers for home-state reconciliation and ingest.
- `ios` - Thin wrapper delegating iOS build/sim scripts to `web/ios`.
- `storybook` - Thin wrapper delegating to the web Storybook.
- `drizzle` - Drizzle Gateway wrapper image.
- `map-provision` - Basemap tile provisioner image.
- `packages/api` - Browser-safe type bridge that re-exports the API router type only.
- `packages/core` - Owns the `device_state` table: schema, the `DeviceStateStore` interface, pg + in-memory adapters, and the desired/reported merge logic.
- `packages/logger` - Shared pino logger with centralized redaction and runtime-safe config.
- `packages/platform` - Pure platform foundation package for product identity, target, exposure, secret, database, backup, and Control Center representation primitives.
- `infra` - Pulumi program that declares the production k8s stack.
- `infra/unifi` and `infra/cloudflare` - Separate Pulumi projects for those providers.

## Frontend

The main route, `web/src/routes/index.tsx`, renders `Board` from `web/src/components/Board.tsx`.

The dashboard is not a normal responsive layout. It is a fixed wall-panel world:

- Target panel is `1366x1024`; board content constants are in `web/src/lib/grid-constants.ts`.
- `BOARD_W = 1366`, `BOARD_H = 1000`.
- The board is a large `64x64` square-cell world.
- Panning uses native scroll, plus windowing so only visible cells mount.
- Idle reset glides back to the home tile, currently the clock.

Tile placement is centralized in `web/src/lib/tile-registry.ts`. Each tile entry defines its id, label, component, detail view component, world position, and size. The registry's coordinates are *defaults* only: the `board_tile_placement` table holds per-tile overrides (world col/row) that win when present, so a user's saved layout survives registry additions/removals without a migration. `resolveLayout` (`web/src/lib`) merges registry defaults with placement overrides and scanline-places any tile the user has never touched.

The `layout` tRPC router exposes `get` (merged, revision-tagged layout) and `save` (writes placement rows, prunes rows for tiles no longer in the registry). `useBoardLayout` blocks first paint on the initial `layout.get`, then polls every 5s (`POLL.layout`); a poll response whose revision is unchanged is skipped, so the resolved layout only ever applies on a revision change (last-write-wins).

Layout editing is entered from the Board page of Settings ("Edit layout" row) and opens a full-screen, zoomed-out editor (`components/layout-editor/`) that freezes the board underneath (idle glide-home and idle-dim both disabled while it's open). Tiles drag-and-snap to the grid with overlap spring-back; Save is gated behind the active bento pattern (an invalid arrangement can't be saved), and Reset/Cancel discard the working copy. Any tile without a saved position (including newly-registered tiles) surfaces via an unplaced-tile banner.

Settings is a full-page (`1366x1024`) body-portal overlay, not a modal: `components/settings-page/` holds the shell (`SettingsPage.tsx`, sidebar + page routing), shared framing (`blocks.tsx`), the page registry (`pages.ts`), and eight presentational pages under `pages/` (Device, Display, Board, Network, Notifications, Debug, About, Security). Live state comes from the module-level settings store (`lib/settings.ts`), which syncs every field across panels through the server's settings singleton. The gear button opens Settings behind a 6-digit PIN gate (`components/pin/`, `PinGateModal` + `PinPadView`); the same gate guards the Wake photos viewer. The PIN is a synced settings field (`pinCode`, default `"000000"`), enforced frontend-only — the API never validates it beyond schema shape. A `showMinimap` setting (Board page) gates the board minimap.

Data access is through tRPC React Query in `web/src/lib/trpc.ts`. Queries retry with bounded exponential backoff; mutations do not retry. Unavailable data should render skeleton/error states, not invented values.

## API

The API entrypoint is `api/src/server.ts`. It creates the root logger, runs migrations, then serves with `Bun.serve()`.

Routes include:

- `/up` - simple liveness.
- `/health/climate` - verifies live Home Assistant climate reachability.
- `/media/tv-artwork` - proxies Home Assistant artwork bytes so tokenized HA URLs stay private.
- `/media/wake-photo` (POST) + `/media/wake-photos/*` - ingests and serves the panel's wake-from-dim front-camera burst frames (stored under `MEDIA_STORAGE_DIR/wake-photos`).
- `/trpc/*` - tRPC request handling.

The tRPC root router lives in `api/src/trpc/routers/index.ts` and combines routers for health, weather, network, Tesla, climate, controls, camera, events, media, and portal.

`api/src/trpc/init.ts` adds middleware that remaps `HaError` into tRPC `SERVICE_UNAVAILABLE`, so clients can recover through normal query error handling.

`packages/api/src/trpc.ts` is intentionally tiny. It re-exports only the `AppRouter` type from `@control-center/api/trpc`, allowing the web app to have typed tRPC without bundling backend runtime code.

## Domain Services

Most business logic lives in `api/src/services`. Important services include climate, controls, device state/commands, light and climate enforcers, party mode, weather ingest/read, network, Tesla, Apple TV, Spotify, Sonos, playlist polling, YouTube ingest, and captive portal flows.

The Sonos sound-system query classifies each group's source from the coordinator's `GetMediaInfo` URI (`sourceKind`: line-in/tv/spotify/airplay/other/idle) and carries now-playing metadata. The web Groups modal (patch-bay UX, opened from the Sound System tile) moves speakers between live sources via `sonosGroupJoin`/`sonosGroupLeave`, grabbing TV audio to the Beam first when needed.

A key pattern is DB-authoritative desired state:

```text
frontend writes desired state
  -> worker reconciles desired state to Home Assistant / Sonos
  -> reported state is observed separately
  -> frontend reads merged/effective state
```

This keeps dashboard taps immediately self-consistent and avoids fighting upstream systems unless the device policy says to enforce.

## Database

The Drizzle schema is in `api/src/db/schema.ts`.

Major tables include:

- `job` - generic durable job queue.
- `events` - upcoming events.
- `device_state` - desired and reported device state.
- `device_commands` - command audit and in-flight tracking.
- `integration_sync_status` - integration/worker heartbeat state.
- `weather_reading` and `weather_daily_reading` - append-only weather history.
- `lamp_mode` - singleton persistent party-mode state.
- `media_source` and `media_item` - media pipeline state.
- `board_tile_placement` - per-tile world position overrides for the board layout editor; absent rows fall back to `tile-registry.ts` defaults.
- `weight_measurement` - append-only Renpho scale weigh-ins (kg canonical, lb display-only), ingested from an HA BLE sensor by the `weight-ingest` worker; sanity-band/manual exclusions live in `excluded_reason`, surfaced by the Weight tile and its Trend/Readings detail pages via the `weight` tRPC router.

Both the API and workers run migrations at boot so whichever starts first can safely prepare the schema.

## Workers

`worker` owns the interval runtime and imports domain cycles through the narrow `@control-center/api/worker` barrel at `api/src/worker-deps.ts`. The product-owned wrapper is `worker`.

Registered workers currently include:

- `light-enforcer` every 1s.
- `climate-enforcer` every 1s.
- `sonos-volume-enforcer` every 1s.
- `device-sync` every 1s, currently fan-only.
- `party-mode` every 2s.
- `weather-ingest` every 5m.
- `weight-ingest` every 1m (HA Renpho BLE weight sensor → `weight_measurement`).
- `asc-version-poll` every 1m (latest TestFlight build of the iOS shell, powering the board's update-available banner).

The shared runtime in `packages/worker-runtime` prevents overlapping cycles per worker, isolates failures, logs failure and recovery transitions, warns on slow cycles, and exposes stats.

The media pipeline (playlist poller, ingest queue, NAS media mount) runs inside `worker`: media-worker was merged into it, so there is one worker deployable and one api barrel (`@control-center/api/worker` at `api/src/worker-deps.ts`).

- `queue-worker` every 2s.
- `playlist-poller` every 2m.

It checks media storage free space before claiming download work.

## Logging And Config

`packages/logger` provides `createLogger({ service })` and `getLogger()`. Backend processes create one root logger at startup. Shared domain services can call `getLogger()`, so the same code logs under `service: "api"` or `service: "worker"` depending on the running process.

Logger behavior is keyed off runtime env like `APP_ENV`, `LOG_LEVEL`, and `LOG_PRETTY`, not `NODE_ENV`, because Bun can inline `NODE_ENV` in single-file bundles.

Frontend logs (the web app's own log store, `web/src/lib/log/`) are shipped to Postgres: a cursor-tracked shipper pushes every entry to the `logs.ingest` tRPC mutation, which writes the `frontend_log` table (30-day retention, purged daily). Every entry carries a stable `deviceId` (`<model-slug>-<idfv8>`), the mutable display `deviceName`, the git `sha`, and the App Store `build` number. To read panel logs from a desk, query Postgres instead of exporting from the device:

```
kubectl --context cc-homelab -n control-center exec control-center-1 -c postgres -- \
  psql -U postgres -d control_center -c "select ts, level, source, msg from frontend_log \
  where level in ('warn','error') and ts > now() - interval '1 day' order by ts desc limit 100"
```

Design: `docs/superpowers/specs/2026-07-18-frontend-log-shipping-design.md`.

API config is parsed in `api/src/env.ts`. Production secrets are mounted as files under `/run/secrets/<NAME>` and hydrated at boot. Real credentials and private home-location values live outside git.

## Deployment

Production deploy is Pulumi + Kubernetes, not the historical bosun/Swarm path.

Important infra files:

- `infra/src/services.ts` - app workloads.
- `infra/src/crons.ts` - Kubernetes CronJobs.
- `infra/src/eso.ts` - External Secrets Operator resources.
- `infra/src/cnpg.ts` - CloudNativePG Postgres.
- `infra/src/certmanager.ts` - certificate automation.
- `infra/src/cluster.ts` - cluster-level setup.

GitHub Actions builds linux/arm64 images in `.github/workflows/ci.yml`, pushes them to GHCR, joins the tailnet with an ephemeral `tag:ci` identity, writes kubeconfig, sets Pulumi image digest config, and runs `pulumi up --stack prod`.

The image digest config key must be namespaced as `ccinfra:imageDigests.<svc>`. Without `ccinfra:`, the Pulumi program does not read the values correctly.

## Cron Jobs

Scheduled work is Kubernetes-native in `infra/src/crons.ts`:

- `portal-data-purge` - daily portal cleanup.
- `map-extract` - monthly basemap refresh.
- `pg-backup` - daily Postgres dump to the NAS.

Do not add a third-party scheduler for new cron-style tasks.

## Data Safety

`scripts/pg-snapshot-restore.sh` is the reusable Postgres snapshot and scratch-restore proof tool. It supports dry-run planning, exact all-schema row-count SQL, custom-format dumps, plain SQL gzip dumps, scratch-only restores, and non-zero row-count mismatch failure. It rejects `production` / `control-center` as scratch targets so restore validation cannot overwrite the live database accidentally.

## Platform History

The repo previously moved toward a multi-product platform shape (Control Center
+ captive-portal as separate products under `products/<name>`). That shape is
gone: captive-portal's guest-WiFi flow was folded into `api`'s guest listener,
and SDD track 0 Task 9 flattened `*` to the repo root,
so this is a single-product repo again. `docs/platform/*.html` are historical
design notes from that era, not the current layout.

CI path filters are now scoped per top-level directory (`web/**`, `api/**`,
`worker/**`, `storybook/**`, `drizzle/**`, `map-provision/**`), all rebuilding
on `packages/**` or `bun.lock` changes too. The Tiltfile lives at the repo
root; root `bun run dev` runs `tilt up` directly. Local dev commands
(`dev:web`, `dev:api`, `dev:worker`, `dev:storybook`, `dev:db`, `ios:*`) live
on the root `package.json`.

`packages/platform` still holds product-identity, target, exposure, secret,
database, backup, and Control Center representation primitives consumed by
`infra/`; `controlCenterProductManifest()` is the live source of truth Pulumi
reads, not a filesystem-path abstraction.

`packages/core` owns the `device_state` table end to end: the drizzle schema,
the `DeviceStateStore` interface (read/list/listExpiredWindows/readEffective/
seed/upsertDesired/updateDesired/clearDesired/writeReported), the pure
desired+reported merge module, and two adapters behind that interface - a pg
adapter over the real table, and an in-memory adapter for tests. `api`'s five
device_state writers (light, climate, sonos-volume, device-sync enforcers, plus
the shared desired-state-store) and its readers all consume the store; services
take the store as a constructor/function param with the pg-backed singleton as
the default, so tests inject the in-memory adapter instead of stubbing drizzle.
`api/src/db/schema.ts` re-exports the device_state types and table from
`@www/core` so existing `../db/schema` imports keep working.

## Development Rules To Preserve

- Use `bun` and `bunx`, never `npm` or `npx`.
- Run tests with `bun run test`, never bare `bun test`.
- Do not add fake, fallback, or placeholder data. Unavailable data should shimmer or error and recover.
- Backend code uses structured logging through `@repo/logger`, not `console.*`.
- Tiles should use shared UI primitives from `web/src/components/ui`.
- Component work should be Storybook-first where practical.
- IDs should default to Stripe-style `prefix_<id>`.
- Deployment and operations changes should update docs in the same change.

## Where To Start For A Feature

Most product changes follow this vertical slice:

```text
UI tile/component
  -> web/src/components
  -> tRPC hook from web/src/lib/trpc.ts

API router
  -> api/src/trpc/routers
  -> validates input/output

Domain service
  -> api/src/services
  -> talks DB or integration

Persistent state
  -> api/src/db/schema.ts, if needed

Background work
  -> worker, if needed

Deploy shape
  -> infra/src/services.ts or infra/src/crons.ts, if needed
```
