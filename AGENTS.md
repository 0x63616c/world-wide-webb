# Agent Instructions

## Start Here

- Read `CODEBASE_OVERVIEW.md` first.
- Use `bd` for durable task tracking.
- Before writing or reviewing TypeScript or TSX, use the `writing-scalable-typescript` skill when available.

## Commands

- Install deps: `bun install --frozen-lockfile`.
- Dev stack: `bun run dev`.
- Tests: `bun run test`.
- Typecheck: `bun run typecheck`.
- Lint: `bunx biome check .`.
- Dead code: `bun run knip`.

## Current Shape

- `products/control-center/web`, React board, Storybook, Capacitor iOS shell.
- `products/control-center/api`, Bun + tRPC API and domain logic.
- `products/control-center/worker`, fast interval loops.
- `products/control-center/media-worker`, heavier queue and media jobs.
- `products/control-center/storybook`, wrapper around web Storybook.
- `products/project-management`, standalone Beads UI and Temporal workflow package.
- `products/text-your-ex`, split into `apps/frontend`, `apps/api`, `apps/e2e`.
- `products/captive-portal`, split into `apps/frontend` and `apps/api`.
- `products/amp`, static app.
- `packages/api`, `packages/logger`, `packages/platform`, shared support packages.
- `infra`, current Pulumi + Kubernetes deploy program.

## Invariants

- Fixed wall panel, `1366x1024`, not responsive.
- Tile placement belongs in `products/control-center/web/src/lib/tile-registry.ts`.
- Use shared UI primitives from `products/control-center/web/src/components/ui/`.
- No fake or placeholder data.
- Storybook-first for new UI.
- IDs default to `prefix_<id>`.
- Backend code uses structured logging.

## Infra

- Push to `main` triggers CI and deploy.
- CI builds only changed product images.
- Pulumi digest pins use `wwwinfra:imageDigests.*`.
- Cron jobs live in `infra/src/crons.ts`.

## Workflow

- Work in ticket-named worktrees.
- Do not use PRs for shipping.
- Keep docs current when behavior changes.
