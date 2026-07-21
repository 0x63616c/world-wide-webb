# Agent Instructions

## Start Here

- Read `CODEBASE_OVERVIEW.md` first.
- **Beads (`bd`) dropped 2026-07-11.** Do not create, query, or rely on `bd`
  tickets. Archived in `docs/beads-archive/` - `OPEN-IDEAS.md` holds unfinished
  ideas, `beads-export.jsonl` the raw dump. Pull ideas from there.
- Use the `writing-scalable-typescript` skill before writing or reviewing TS/TSX.

## Invariants

- **Design for 10x-100x this repo's size** - never reject a shared primitive on
  "few call sites today". Get data layout (paths, schema, IDs, on-disk formats)
  right up front; code interfaces refactor cheaply later.
- Shared primitives live in `packages/platform`, enforced by a Biome rule banning
  the raw escape hatch (see the sound bus).
- Fixed wall panel, `1366x1024`, not responsive.
- Tile placement belongs in `products/control-center/web/src/lib/tile-registry.ts`.
- Use shared UI primitives from `products/control-center/web/src/components/ui/`.
- All panel audio goes through the sound bus: `playCue()` from
  `products/control-center/web/src/lib/sound/`. Add a named cue there; never
  construct an `AudioContext` or `Audio` elsewhere (Biome-enforced). Loudness is
  the DEVICE volume, set via the `PanelVolume` plugin and the Sound settings page,
  never an in-app gain.
- No fake or placeholder data.
- Storybook-first for new UI.
- IDs default to `prefix_<id>`.
- Backend code uses structured logging.

## Debugging

- Panel/frontend logs live in the control-center Postgres: table `frontend_log`,
  30-day retention, tagged with stable `device_id`, display `device_name`, git
  `sha`, app `build`. Query it (psql via kubectl exec on `control-center-1`); do
  not ask for a device export.

## Infra

- "prod" = the homelab cluster. No other production environment.
- Push to `main` triggers CI and deploy.
- CI/deploy is product-aware: per-product path filters build only changed product
  images plus shared-package dependents.
- Pulumi digest pins use `wwwinfra:imageDigests.*`.
- Cron jobs live in `infra/src/crons.ts`.

## Workflow

- **Work directly on `main` by default.** Use a worktree only when the user
  explicitly asks for one. Name worktrees after the task.
- **Commit and push extremely often, without asking.** A push to `main` deploys to
  prod. Commit each coherent change (a passing test, a working slice, a doc
  update); never batch into one large commit. Push every commit immediately.
- Standing authorization: commit + push to `main` is pre-approved for every
  requested change. Do not pause to ask.
- Verify before pushing where cheap (`bun run typecheck`, relevant tests). On
  failure, fix forward and push again - never sit on unpushed work.
- Do not use PRs for shipping.
- Keep docs current when behavior changes.
