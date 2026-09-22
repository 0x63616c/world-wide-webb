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
| `apps/api` | Bun + tRPC API, routers, DB schema, migrations. |
| `apps/worker` | Interval workers for reconciliation and ingest. |
| `apps/manage` | Static nginx bundle framing the small set of ops tools this repo doesn't own. |
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

`web -> tRPC api -> domain services -> Home Assistant / Sonos / Postgres`

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
