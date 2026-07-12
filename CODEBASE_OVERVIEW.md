# Codebase Overview

This repository is a Bun monorepo for a smart-home wall-panel dashboard. The app is built around a fixed iPad wall panel, a tRPC API, background reconciliation workers, and a Pulumi-managed Kubernetes deployment on `homelab`.

## Runtime Shape

```text
iPad / browser
  -> products/control-center/web React board
  -> /trpc same-origin HTTP
  -> products/control-center/api Bun + tRPC server
  -> products/control-center/api/src/services domain services
  -> Home Assistant / UniFi / Spotify / Postgres / media integrations

background loops
  -> products/control-center/worker
  -> @control-center/api/worker domain cycles
  -> desired-state reconciliation, weather ingest, party mode

heavy media jobs
  -> products/control-center/media-worker
  -> @control-center/api/media queue/media services
  -> YouTube/media ingest and enrichment

deploy
  -> GitHub Actions
  -> GHCR arm64 images
  -> Pulumi in infra/
  -> k3s on homelab
```

## Workspace Layout

- `products/control-center/web` - React dashboard, Storybook, and Capacitor iOS shell.
- `products/control-center/api` - Bun tRPC backend, DB schema, migrations, routers, services, and shared domain logic.
- `products/control-center/worker` - Continuous interval workers for home-state reconciliation and ingest.
- `products/control-center/media-worker` - Heavier queue/media workers, isolated from 1s home-control loops.
- `products/control-center` - Product-owned Control Center boundary. Runtime app source now lives under this product folder while production image names, workload names, routes, and namespace stay unchanged.
- `products/captive-portal/apps/api` - Captive Portal product API boundary, exposing only the portal tRPC surface.
- `products/captive-portal/apps/frontend` - Guest WiFi captive portal frontend product app.
- `products/text-your-ex` - Text Your Ex product shell (package + manifest). Non-deployed until its M6 import lands; carries a CI path filter now so the lane is visible.
- `products/amp` - AMP product: a static nginx single-page app built from its own tree, deployed via its own image + CI lane.
- `packages/api` - Browser-safe type bridge that re-exports the API router type only.
- `packages/logger` - Shared pino logger with centralized redaction and runtime-safe config.
- `packages/platform` - Pure platform foundation package for product identity, target, exposure, secret, database, backup, and Control Center representation primitives.
- `infra` - Pulumi program that declares the production k8s stack.
- `infra/unifi` and `infra/cloudflare` - Separate Pulumi projects for those providers.

## Frontend

The main route, `products/control-center/web/src/routes/index.tsx`, renders `Board` from `products/control-center/web/src/components/Board.tsx`.

The dashboard is not a normal responsive layout. It is a fixed wall-panel world:

- Target panel is `1366x1024`; board content constants are in `products/control-center/web/src/lib/grid-constants.ts`.
- `BOARD_W = 1366`, `BOARD_H = 1000`.
- The board is a large `64x64` square-cell world.
- Panning uses native scroll, plus windowing so only visible cells mount.
- Idle reset glides back to the home tile, currently the clock.

Tile placement is centralized in `products/control-center/web/src/lib/tile-registry.ts`. Each tile entry defines its id, label, component, detail view component, world position, and size. Moving or resizing a tile should usually be a registry edit, not a board rewrite.

Data access is through tRPC React Query in `products/control-center/web/src/lib/trpc.ts`. Queries retry with bounded exponential backoff; mutations do not retry. Unavailable data should render skeleton/error states, not invented values.

Theming is CSS-custom-property based. Dark is the `:root` default in `products/control-center/web/src/styles/tokens.css`; the light palette lives in the `:root[data-theme="light"]` block of the same file (same token names, light values). `products/control-center/web/src/lib/theme.ts` resolves the synced `themeMode` setting (`auto` | `light` | `dark`, in the settings singleton) onto `<html data-theme>` and cross-fades swaps via the transient `html.theme-fade` class; `auto` follows sunrise/sunset from `weather.now` shifted by the `themeSunOffsetMin` setting. Component colors must come from tokens (or be genuinely scene-intrinsic, e.g. map canvases and camera scrims) so both themes render correctly.

## API

The API entrypoint is `products/control-center/api/src/server.ts`. It creates the root logger, runs migrations, then serves with `Bun.serve()`.

Routes include:

- `/up` - simple liveness.
- `/health/climate` - verifies live Home Assistant climate reachability.
- `/media/tv-artwork` - proxies Home Assistant artwork bytes so tokenized HA URLs stay private.
- `/trpc/*` - tRPC request handling.

The tRPC root router lives in `products/control-center/api/src/trpc/routers/index.ts` and combines routers for health, weather, network, Tesla, climate, controls, camera, events, media, and portal.

`products/control-center/api/src/trpc/init.ts` adds middleware that remaps `HaError` into tRPC `SERVICE_UNAVAILABLE`, so clients can recover through normal query error handling.

`packages/api/src/trpc.ts` is intentionally tiny. It re-exports only the `AppRouter` type from `@control-center/api/trpc`, allowing the web app to have typed tRPC without bundling backend runtime code.

## Domain Services

Most business logic lives in `products/control-center/api/src/services`. Important services include climate, controls, device state/commands, light and climate enforcers, party mode, weather ingest/read, network, Tesla, Apple TV, Spotify, Sonos, playlist polling, YouTube ingest, and captive portal flows.

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

The Drizzle schema is in `products/control-center/api/src/db/schema.ts`.

Major tables include:

- `job` - generic durable job queue.
- `events` - upcoming events.
- `device_state` - desired and reported device state.
- `device_commands` - command audit and in-flight tracking.
- `integration_sync_status` - integration/worker heartbeat state.
- `weather_reading` and `weather_daily_reading` - append-only weather history.
- `lamp_mode` - singleton persistent party-mode state.
- `media_source` and `media_item` - media pipeline state.

Both the API and workers run migrations at boot so whichever starts first can safely prepare the schema.

## Workers

`products/control-center/worker` owns the interval runtime and imports domain cycles through the narrow `@control-center/api/worker` barrel at `products/control-center/api/src/worker-deps.ts`. The product-owned wrapper is `products/control-center/worker`.

Registered workers currently include:

- `light-enforcer` every 1s.
- `climate-enforcer` every 1s.
- `sonos-volume-enforcer` every 1s.
- `device-sync` every 1s, currently fan-only.
- `party-mode` every 2s.
- `weather-ingest` every 5m.
- `asc-version-poll` every 1m (latest TestFlight build of the iOS shell, powering the board's update-available banner).

The runtime in `products/control-center/worker/src/runtime.ts` prevents overlapping cycles per worker, isolates failures, logs failure and recovery transitions, warns on slow cycles, and exposes stats.

`products/control-center/media-worker` is separate because downloads and enrichment are heavier than home-control loops. It imports through `@control-center/api/media` at `products/control-center/api/src/media.ts` and runs through the product-owned wrapper at `products/control-center/media-worker`.

- `queue-worker` every 2s.
- `playlist-poller` every 10m.

It checks media storage free space before claiming download work.

## Logging And Config

`packages/logger` provides `createLogger({ service })` and `getLogger()`. Backend processes create one root logger at startup. Shared domain services can call `getLogger()`, so the same code logs under `service: "api"`, `service: "worker"`, or `service: "media-worker"` depending on the running process.

Logger behavior is keyed off runtime env like `APP_ENV`, `LOG_LEVEL`, and `LOG_PRETTY`, not `NODE_ENV`, because Bun can inline `NODE_ENV` in single-file bundles.

API config is parsed in `products/control-center/api/src/env.ts`. Production secrets are mounted as files under `/run/secrets/<NAME>` and hydrated at boot. Real credentials and private home-location values live outside git.

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

## Platform Migration

The repo is moving toward a multi-product platform shape documented in `docs/platform/README.html` and `docs/platform/NORTH_STAR.html`. Read those before touching product/platform split work. The target model is products under `products/<name>` with platform-owned primitives for namespaces, routing/TLS, secrets, CNPG Postgres databases, NAS backups, local dev, CI/deploy, and iOS workflows.

Control Center now has a product boundary at `products/control-center`. For M7 compatibility, the product packages delegate to the legacy `products/control-center/web`, `products/control-center/api`, `products/control-center/worker`, and `products/control-center/media-worker` source paths so production behavior does not change until the CI, infra, database, and route cutovers land.

CI path filters treat `products/control-center/**` as a Control Center app change, while unrelated `products/*` folders do not rebuild or deploy Control Center unless shared `packages/**` or `bun.lock` changes. The Control Center Tiltfile lives at `products/control-center/Tiltfile`; root `bun run dev` delegates to the product package. Product-scoped local commands live on `@product/control-center`, including `dev`, `dev:web`, `dev:api`, `dev:worker`, `dev:media-worker`, `dev:storybook`, `dev:db`, and `ios:*` aliases.

M1 foundation lives in `packages/platform`. It is representation-only today: `controlCenterProductManifest()` proves Control Center can be expressed through the new model without changing the current Pulumi production path.

## Development Rules To Preserve

- Use `bun` and `bunx`, never `npm` or `npx`.
- Run tests with `bun run test`, never bare `bun test`.
- Do not add fake, fallback, or placeholder data. Unavailable data should shimmer or error and recover.
- Backend code uses structured logging through `@repo/logger`, not `console.*`.
- Tiles should use shared UI primitives from `products/control-center/web/src/components/ui`.
- Component work should be Storybook-first where practical.
- IDs should default to Stripe-style `prefix_<id>`.
- Deployment and operations changes should update docs in the same change.

## Where To Start For A Feature

Most product changes follow this vertical slice:

```text
UI tile/component
  -> products/control-center/web/src/components
  -> tRPC hook from products/control-center/web/src/lib/trpc.ts

API router
  -> products/control-center/api/src/trpc/routers
  -> validates input/output

Domain service
  -> products/control-center/api/src/services
  -> talks DB or integration

Persistent state
  -> products/control-center/api/src/db/schema.ts, if needed

Background work
  -> products/control-center/worker or products/control-center/media-worker, if needed

Deploy shape
  -> infra/src/services.ts or infra/src/crons.ts, if needed
```
