# world-wide-webb

Smart-home wall-panel monorepo for the fixed `1366x1024` Control Center panel.

## Layout

`apps/` = things that run/deploy. `packages/` = things you import.
`features/<id>/` = self-contained Apps (manifest + `web.tsx`/`api.ts`/
`http.ts`/`worker.ts`/`schema.ts`); the folder existing is the App's
registration (ADR-0001).

| Path | Purpose |
| --- | --- |
| `apps/web` | React board. Main route: `src/routes/index.tsx`. |
| `apps/panel` | Expo iOS kiosk shell for the wall panel. |
| `apps/api` | Single www process, API, routers, DB schema and migrations. |
| `apps/worker` | Legacy worker entrypoint retained for rollback. |
| `apps/manage` | Static management UI, served by www on the manage hostname. |
| `features/*` | Self-contained feature Apps (tiles), glob-collected into `features/_generated/*.gen.ts` by `bun run apps:gen`. |
| `packages/api` | Browser-safe tRPC type bridge + wire contracts. |
| `packages/core` | Shared `device_state` store (`@www/core`). |
| `packages/logger` | Shared backend logger. |
| `packages/platform` | Platform primitives for product identity, secrets, DBs, backups, and manifests. |
| `packages/theme` | Shared CSS the web and manage bundles both import. |
| `packages/worker-runtime` | Shared worker scheduling/runtime primitives. |
| `deploy/mini` | Compose, releases, HA startup and NAS backups. |
| `infra/cloudflare` | Pulumi-managed DNS, Access and tunnel ingress. |

See `CODEBASE_OVERVIEW.md` for the full map and `CONTEXT.md` for the domain
glossary.

## Runtime

`www (web + manage + API + tRPC + worker cycles) -> Home Assistant / Sonos / Postgres`

Build the two static bundles once, then start the single backend process:

```sh
bun install --frozen-lockfile
bun run build:www
bun run www
```

Postgres must be reachable at `DATABASE_URL` (the development default is the
Postgres service in `docker-compose.yml`). The panel is at `http://localhost:4201`.
Manage uses the same port with hostname `manage.worldwidewebb.co`; set
`MANAGE_HOST=localhost` to preview Manage locally. `WORKER_CYCLES=off bun run www`
starts an HTTP-only instance; the default is `on`. Only one instance may have
cycles enabled against a database. An instance with cycles off still serves writes.

For the packaged image, with `DATABASE_URL` exported in your shell:

```sh
docker build -t www .
docker run --rm --name www -p 4201:4201 -e DATABASE_URL -e WORKER_CYCLES=on \
  -v www-media:/app/media -e MEDIA_STORAGE_DIR=/app/media www
```

Production also needs the existing runtime secrets (see
`packages/platform/env/manifest.ts`), supplied through environment variables or
read-only files at `/run/secrets/<NAME>`. Set `APP_ENV=production` to validate them.
`/healthz` returns DB availability, whether cycles are enabled, and per-cycle
run/failure counts. A cycle failure is reported without restarting the HTTP
server; database failure and shutdown return 503. `/up` is simple liveness.
Prometheus stays on the internal metrics port (9464), outside the public listener.

Production uses this single image on the Mac mini with PostgreSQL. SQLite is
an optional separate migration. See [the migration runbook](docs/runbooks/mac-mini-migration.md)
for verification and recovery, and [backups](docs/runbooks/mini-backups.md) for
persistent media and database protection.

Workers reconcile desired state and ingest background data. UI tiles read
merged state and show skeletons on missing data instead of fake values.

## Deploy

Push to `main` runs hosted CI. On success, `deploy-mini.yml` builds the exact
revision from the root Dockerfile on ARM64, publishes an immutable GHCR digest,
and deploys over Tailscale SSH to the Mac mini. The release script serializes
updates, checks database/worker health and the build SHA, and rejects stale
releases. No self-hosted GitHub runner is required.

Control Center and PostgreSQL run in OrbStack; Home Assistant runs in a bridged
Colima VM. Hindsight and Bambuddy stay independent. `deploy/mini/` contain versioned runtime/startup configuration. Cloudflare DNS,
Access and tunnel ingress are managed in `infra/cloudflare` (Pulumi `prod`).
Talos is shut down with disks retained. Never restart its old app against stale
data; use the migration runbook for recovery context.

## Commands

```bash
bun install --frozen-lockfile
bun run dev
bun run test
bun run typecheck
bunx biome check .
bun run knip
```

Use `bun` and `bunx`, never `npm` or `npx`.

## Docs

- `CODEBASE_OVERVIEW.md` — repo map and runtime shape.
- `CONTEXT.md` — domain glossary / ubiquitous language.
- `CLAUDE.md` — AI agent instructions (points at `AGENTS.md`).
- `AGENTS.md` — repo-specific agent notes and workflow rules.
- `docs/adr/` — architectural decisions, including `0013` (The
  Simplification: what was deleted from this repo and why).
