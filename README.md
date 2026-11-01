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
| `infra` | Pulumi + Kubernetes deploy program. |

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

This is the first WWW-76 slice: monolith on Postgres, still on Talos. SQLite,
its PVC, the data-copy script, and alarm transaction changes belong to the
follow-up PR. See [ADR-0014](docs/adr/0014-single-www-process.md) for deployment
and rollback. No hardware move or infrastructure teardown happens here.

Workers reconcile desired state and ingest background data. UI tiles read
merged state and show skeletons on missing data instead of fake values.

## Deploy

Push to `main` runs CI, builds changed amd64 images (product-aware: only
changed product images plus shared-package dependents), writes digest pins to
`wwwinfra:imageDigests.*`, then runs `pulumi up` against the `home-server`
stack.

Prod is a single-node **Talos Linux** Kubernetes cluster, `home-server`
(`192.168.0.5`, amd64, RTX 3060) — the only production environment. Talos has
no shell and no sshd, so there is **no SSH into it**; use `talosctl` for the
node and `kubectl` for the cluster:

```sh
export TALOSCONFIG=$PWD/infra/talos/clusterconfig/talosconfig
talosctl dashboard
export KUBECONFIG=$PWD/infra/talos/clusterconfig/hs.kubeconfig
kubectl get pods -A
```

`infra/talos/clusterconfig/` is gitignored and regenerated per session with
`talhelper genconfig`, since it contains the cluster CA and admin client key.
Machine config lives in `infra/talos/talconfig.yaml`.

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
