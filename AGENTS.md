# Agent Instructions

## Start Here

- Read `CODEBASE_OVERVIEW.md` first.
- **Beads (`bd`) is no longer used** for task tracking (dropped 2026-07-11). Do not
  create, query, or rely on `bd` tickets. The old tickets are archived in
  `docs/beads-archive/` - `OPEN-IDEAS.md` holds the unfinished ideas, and
  `beads-export.jsonl` is the full raw dump. Pull ideas from there as needed.
- Before writing or reviewing TypeScript or TSX, use the `writing-scalable-typescript` skill when available.

## Invariants

- **Design for 10x-100x the current repo size.** Many more products, and many more
  apps once the app construct lands. Do not reject a shared primitive because
  today's call-site count is small or because the existing code is "already
  testable" - that is a snapshot, not the design target. Weigh the cost at the
  projected scale. Still split decisions by reversibility: data layout (storage
  key/path layouts, DB schema, IDs, on-disk formats) is expensive to change later,
  so get it right up front; code-level interfaces are cheap to refactor and can
  wait for real consumers. Prefer centralize-plus-enforce over convention - put the
  primitive in `packages/platform` and add a Biome rule banning the raw escape
  hatch, the way the sound bus does.
- Fixed wall panel, `1366x1024`, not responsive.
- Tile placement belongs in `products/control-center/web/src/lib/tile-registry.ts`.
- Use shared UI primitives from `products/control-center/web/src/components/ui/`.
- All panel audio goes through the sound bus: `playCue()` from
  `products/control-center/web/src/lib/sound/`. Add a named cue there rather than
  constructing an `AudioContext` or `Audio` anywhere else (a Biome rule enforces
  this). Loudness is the DEVICE's volume, set through the `PanelVolume` plugin
  and the Sound settings page , never an in-app gain.
- No fake or placeholder data.
- Storybook-first for new UI.
- IDs default to `prefix_<id>`.
- Backend code uses structured logging.

## Debugging

- Panel/frontend logs are queryable in the control-center Postgres: table
  `frontend_log`, 30-day retention, tagged with stable `device_id`, display
  `device_name`, git `sha`, and app `build`. Query it (psql via kubectl exec on
  `control-center-1`) instead of asking for a device export.

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
