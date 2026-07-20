# world-wide-webb

Smart-home wall-panel monorepo for the fixed `1366x1024` Control Center panel.

## Layout

| Path | Purpose |
| --- | --- |
| `products/control-center/web` | React board, Storybook, Capacitor iOS shell. Main route: `src/routes/index.tsx`. |
| `products/control-center/api` | Bun + tRPC API, domain services, schema, migrations. |
| `products/control-center/worker` | Interval workers for reconciliation and ingest. |
| `products/control-center/storybook` | Thin wrapper around the web Storybook. |
| `products/captive-portal` | Split product with `apps/frontend` and `apps/api`. |
| `packages/api` | Browser-safe tRPC type bridge. |
| `packages/logger` | Shared backend logger. |
| `packages/platform` | Platform primitives for product identity, secrets, DBs, backups, and manifests. |
| `infra` | Pulumi + Kubernetes deploy program. |

## Runtime

`web -> tRPC api -> domain services -> Home Assistant / UniFi / Spotify / Postgres / media`

Workers reconcile desired state and ingest background data. UI tiles read merged state and show skeletons on missing data instead of fake values.

## Deploy

Push to `main` runs CI, builds changed arm64 images, writes digest pins to `wwwinfra:imageDigests.*`, then runs `pulumi up --stack prod` against homelab Kubernetes.

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

## Task tracking

Beads (`bd`) is no longer used for task tracking (dropped 2026-07-11). The old
tickets are archived under [`docs/beads-archive/`](docs/beads-archive/)  - 
`OPEN-IDEAS.md` for the unfinished ideas, `beads-export.jsonl` for the full raw dump.

## Docs

- `CODEBASE_OVERVIEW.md`, repo map and runtime shape.
- `CLAUDE.md`, AI agent instructions.
- `AGENTS.md`, repo-specific agent notes.
