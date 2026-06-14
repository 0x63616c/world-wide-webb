# Codebase Overview

This repository is a Bun monorepo for a smart-home wall-panel dashboard. The app is built around a fixed iPad wall panel, a tRPC API, background reconciliation workers, and a Pulumi-managed Kubernetes deployment on `homelab`.

## Runtime Shape

```text
iPad / browser
  -> apps/web React board
  -> /trpc same-origin HTTP
  -> apps/api Bun + tRPC server
  -> apps/api/src/services domain services
  -> Home Assistant / UniFi / Spotify / Postgres / media integrations

background loops
  -> apps/worker
  -> @repo/api/worker domain cycles
  -> desired-state reconciliation, weather ingest, party mode

heavy media jobs
  -> apps/media-worker
  -> @repo/api/media queue/media services
  -> YouTube/media ingest and enrichment

deploy
  -> GitHub Actions
  -> GHCR arm64 images
  -> Pulumi in infra/
  -> k3s on homelab
```

## Workspace Layout

- `apps/web` - React dashboard, Storybook, and Capacitor iOS shell.
- `apps/api` - Bun tRPC backend, DB schema, migrations, routers, services, and shared domain logic.
- `apps/worker` - Continuous interval workers for home-state reconciliation and ingest.
- `apps/media-worker` - Heavier queue/media workers, isolated from 1s home-control loops.
- `products/control-center` - Product-owned Control Center boundary. Today it contains compatibility wrapper packages for web, api, worker, media-worker, Storybook, and iOS while source remains in `apps/*`; later M7 tickets move CI, infra, and source fully behind these paths.
- `products/captive-portal/apps/frontend` - Guest WiFi captive portal frontend product app.
- `packages/api` - Browser-safe type bridge that re-exports the API router type only.
- `packages/logger` - Shared pino logger with centralized redaction and runtime-safe config.
- `packages/platform` - Pure platform foundation package for product identity, target, exposure, secret, database, backup, and Control Center representation primitives.
- `infra` - Pulumi program that declares the production k8s stack.
- `infra/unifi` and `infra/cloudflare` - Separate Pulumi projects for those providers.

## Frontend

The main route, `apps/web/src/routes/index.tsx`, renders `Board` from `apps/web/src/components/Board.tsx`.

The dashboard is not a normal responsive layout. It is a fixed wall-panel world:

- Target panel is `1366x1024`; board content constants are in `apps/web/src/lib/grid-constants.ts`.
- `BOARD_W = 1366`, `BOARD_H = 1000`.
- The board is a large `64x64` square-cell world.
- Panning uses native scroll, plus windowing so only visible cells mount.
- Idle reset glides back to the home tile, currently the clock.

Tile placement is centralized in `apps/web/src/lib/tile-registry.ts`. Each tile entry defines its id, label, component, detail view component, world position, and size. Moving or resizing a tile should usually be a registry edit, not a board rewrite.

Data access is through tRPC React Query in `apps/web/src/lib/trpc.ts`. Queries retry with bounded exponential backoff; mutations do not retry. Unavailable data should render skeleton/error states, not invented values.

## API

The API entrypoint is `apps/api/src/server.ts`. It creates the root logger, runs migrations, then serves with `Bun.serve()`.

Routes include:

- `/up` - simple liveness.
- `/health/climate` - verifies live Home Assistant climate reachability.
- `/media/tv-artwork` - proxies Home Assistant artwork bytes so tokenized HA URLs stay private.
- `/trpc/*` - tRPC request handling.

The tRPC root router lives in `apps/api/src/trpc/routers/index.ts` and combines routers for health, weather, network, Tesla, climate, controls, camera, events, media, and portal.

`apps/api/src/trpc/init.ts` adds middleware that remaps `HaError` into tRPC `SERVICE_UNAVAILABLE`, so clients can recover through normal query error handling.

`packages/api/src/trpc.ts` is intentionally tiny. It re-exports only the `AppRouter` type from `@repo/api/trpc`, allowing the web app to have typed tRPC without bundling backend runtime code.

## Domain Services

Most business logic lives in `apps/api/src/services`. Important services include climate, controls, device state/commands, light and climate enforcers, party mode, weather ingest/read, network, Tesla, Apple TV, Spotify, Sonos, playlist polling, YouTube ingest, and captive portal flows.

A key pattern is DB-authoritative desired state:

```text
frontend writes desired state
  -> worker reconciles desired state to Home Assistant / Sonos
  -> reported state is observed separately
  -> frontend reads merged/effective state
```

This keeps dashboard taps immediately self-consistent and avoids fighting upstream systems unless the device policy says to enforce.

## Database

The Drizzle schema is in `apps/api/src/db/schema.ts`.

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

`apps/worker` owns the interval runtime and imports domain cycles through the narrow `@repo/api/worker` barrel at `apps/api/src/worker-deps.ts`. The product-owned wrapper is `products/control-center/worker`.

Registered workers currently include:

- `light-enforcer` every 1s.
- `climate-enforcer` every 1s.
- `sonos-volume-enforcer` every 1s.
- `device-sync` every 1s, currently fan-only.
- `party-mode` every 2s.
- `weather-ingest` every 5m.

The runtime in `apps/worker/src/runtime.ts` prevents overlapping cycles per worker, isolates failures, logs failure and recovery transitions, warns on slow cycles, and exposes stats.

`apps/media-worker` is separate because downloads and enrichment are heavier than home-control loops. It imports through `@repo/api/media` at `apps/api/src/media.ts` and runs through the product-owned wrapper at `products/control-center/media-worker`.

- `queue-worker` every 2s.
- `playlist-poller` every 10m.

It checks media storage free space before claiming download work.

## Logging And Config

`packages/logger` provides `createLogger({ service })` and `getLogger()`. Backend processes create one root logger at startup. Shared domain services can call `getLogger()`, so the same code logs under `service: "api"`, `service: "worker"`, or `service: "media-worker"` depending on the running process.

Logger behavior is keyed off runtime env like `APP_ENV`, `LOG_LEVEL`, and `LOG_PRETTY`, not `NODE_ENV`, because Bun can inline `NODE_ENV` in single-file bundles.

API config is parsed in `apps/api/src/env.ts`. Production secrets are mounted as files under `/run/secrets/<NAME>` and hydrated at boot. Real credentials and private home-location values live outside git.

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

## Platform Migration

The repo is moving toward a multi-product platform shape documented in `docs/platform/README.html` and `docs/platform/NORTH_STAR.html`. Read those before touching product/platform split work. The target model is products under `products/<name>` with platform-owned primitives for namespaces, routing/TLS, secrets, CNPG Postgres databases, NAS backups, local dev, CI/deploy, and iOS workflows.

Control Center now has a product boundary at `products/control-center`. For M7 compatibility, the product packages delegate to the legacy `apps/web`, `apps/api`, `apps/worker`, and `apps/media-worker` source paths so production behavior does not change until the CI, infra, database, and route cutovers land.

M1 foundation lives in `packages/platform`. It is representation-only today: `controlCenterProductManifest()` proves Control Center can be expressed through the new model without changing the current Pulumi production path.

## Development Rules To Preserve

- Use `bun` and `bunx`, never `npm` or `npx`.
- Run tests with `bun run test`, never bare `bun test`.
- Do not add fake, fallback, or placeholder data. Unavailable data should shimmer or error and recover.
- Backend code uses structured logging through `@repo/logger`, not `console.*`.
- Tiles should use shared UI primitives from `apps/web/src/components/ui`.
- Component work should be Storybook-first where practical.
- IDs should default to Stripe-style `prefix_<id>`.
- Deployment and operations changes should update docs in the same change.

## Where To Start For A Feature

Most product changes follow this vertical slice:

```text
UI tile/component
  -> apps/web/src/components
  -> tRPC hook from apps/web/src/lib/trpc.ts

API router
  -> apps/api/src/trpc/routers
  -> validates input/output

Domain service
  -> apps/api/src/services
  -> talks DB or integration

Persistent state
  -> apps/api/src/db/schema.ts, if needed

Background work
  -> apps/worker or apps/media-worker, if needed

Deploy shape
  -> infra/src/services.ts or infra/src/crons.ts, if needed
```
