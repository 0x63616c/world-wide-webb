# Agent Instructions

## Start Here

- Read `CODEBASE_OVERVIEW.md` first.
- **Beads (`bd`) is no longer used** for task tracking (dropped 2026-07-11). Do not
  create, query, or rely on `bd` tickets. The old tickets are archived in
  `docs/beads-archive/` - `OPEN-IDEAS.md` holds the unfinished ideas, and
  `beads-export.jsonl` is the full raw dump. Pull ideas from there as needed.
- Before writing or reviewing TypeScript or TSX, use the `writing-scalable-typescript` skill when available.

## Commands

- Install deps: `bun install --frozen-lockfile`.
- Dev stack: `bun run dev`.
- Tests: `bun run test`.
- Typecheck: `bun run typecheck`.
- Lint: `bun run lint`.
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

- "prod" means the homelab cluster; there is no other production environment.
- Push to `main` triggers CI and deploy.
- CI/deploy is product-aware: per-product path filters build only changed product images plus shared-package dependents.
- Pulumi digest pins use `wwwinfra:imageDigests.*`.
- Cron jobs live in `infra/src/crons.ts`.

## Workflow

- **Default to working directly on `main`.** Only use a worktree when the user
  explicitly asks for one. If the request does not mention a worktree, do the work
  in the main checkout. Name worktrees after the task when they are used.
- **Commit and push extremely often, without asking.** This is continuous delivery:
  a push to `main` deploys to prod. Commit as soon as a change is coherent (a
  passing test, a working slice, a doc update) instead of batching work into one
  large commit, and push every commit immediately.
- Standing authorization: the user has pre-approved commit + push to `main` for
  every change they request. Do not pause to ask.
- Verify before pushing where it is cheap (`bun run typecheck`, relevant tests).
  If verification fails, fix forward and push again - never sit on unpushed work.
- Do not use PRs for shipping.
- Keep docs current when behavior changes.
