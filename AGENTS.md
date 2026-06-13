# Agent Instructions

## Start Here

- Read `CODEBASE_OVERVIEW.md` first. It is the compact map of runtime shape, entrypoints, and where changes usually belong.
- `opencode.jsonc` already loads `CLAUDE.md`, `README.md`, and the main ops docs as instructions. Do not duplicate those docs here unless the detail is an easy-to-miss working rule.
- Use Beads for durable work tracking: `bd prime`, `bd ready`, `bd show <id>`, `bd update <id> --claim`, `bd close <id>`. Do not treat `.beads/issues.jsonl` as source of truth or run `bd import` during normal work.

## Commands

- Install deps with `bun install --frozen-lockfile`. Use `bun`/`bunx` only, never `npm`/`npx`.
- Dev stack: `bun run dev` starts Tilt for local Postgres, API, workers, web, and Storybook.
- Unit tests: `bun run test`. Never run bare `bun test`, it breaks `vi.mock` and can report false failures.
- Focused tests/typecheck: `bun run --filter @repo/web test`, `bun run --filter @repo/api typecheck`, etc.
- Full gates before shipping code: `bun run test`, `bun run typecheck`, `bunx biome check .`, `bun run knip`.
- Coverage/browser suite: `bun run test:coverage` is slower and needs Playwright Chromium. Storybook browser tests run from `apps/web` with `bunx vitest --project storybook`.
- In `.claude/worktrees/*`, `bunx biome check .` scans zero files because `biome.json` excludes `.claude`. Use the lefthook-style tracked-file command or explicit paths instead.

## Architecture

- `apps/web` is the React wall panel plus Storybook and the Capacitor iOS shell. The main route is `apps/web/src/routes/index.tsx`, rendering `Board`.
- `apps/api/src/server.ts` is the Bun+tRPC API entrypoint. Routers live under `apps/api/src/trpc/routers`, domain logic under `apps/api/src/services`.
- `apps/worker` owns fast interval loops and imports domain cycles through `@repo/api/worker` (`apps/api/src/worker-deps.ts`).
- `apps/media-worker` owns heavier queue/media work and imports through `@repo/api/media`.
- `packages/api` is a browser-safe type bridge only. Do not import backend runtime code into the web bundle.
- `packages/logger` is the shared backend logger. Backend code should use `@repo/logger`, not `console.*`.
- `infra/` is the current Pulumi+k8s deploy program. The old bosun/Swarm docs are historical only.

## Product Invariants

- The wall panel is fixed, not responsive: physical viewport `1366x1024`, board content `BOARD_W=1366`, `BOARD_H=1000` in `apps/web/src/lib/grid-constants.ts`.
- Tile placement and sizing usually belong in `apps/web/src/lib/tile-registry.ts`, not in board layout rewrites.
- Tiles must use shared primitives from `apps/web/src/components/ui/`: `TileHeader`, `StatCell`, `Pill`, `Skeleton`, `TileWrapper`.
- No fake data. Unavailable data renders skeleton/error and recovers. `FALLBACK` and `PLACEHOLDER` uppercase identifiers are banned; `DEMO_`/`demo_` is allowed only in the sanctioned service/test files enforced by `scripts/check-fake-data.sh`.
- Storybook-first for new UI components where practical. Every story must enable autodocs directly or through a sanctioned meta factory.
- IDs default to Stripe-style `prefix_<id>` unless the user explicitly asks otherwise.

## Data And Integrations

- API config is parsed in `apps/api/src/env.ts`. Production secrets mount as files under `/run/secrets/<NAME>` and hydrate at boot.
- Real secrets live in 1Password Homelab. Never commit `.env`, secret values, private home-location values, keys, or placeholder credentials.
- Drizzle schema is `apps/api/src/db/schema.ts`. Generate migrations with `bun run --filter @repo/api db:generate`; API and workers run migrations at boot.
- Desired state is DB-authoritative for managed devices. Frontend writes desired state, workers reconcile to integrations, reported state is observed separately.
- For house climate, target `climate.home`. HA entities named `evee` are the Tesla, not the home thermostat.

## Infra And Deploy

- Pushes to `main` run CI, build changed arm64 images, then `pulumi up --stack prod` against homelab k8s. Infra-only changes still deploy without rebuilding images.
- Pulumi image digest config must use the `ccinfra:` namespace, e.g. `ccinfra:imageDigests.<svc>`. Without it, builds can succeed but pods do not roll.
- Cron-style work belongs in Kubernetes `CronJob`s in `infra/src/crons.ts`, not legacy scheduler labels or a third-party scheduler.
- Ops or deploy-path changes must update the relevant docs in the same change, especially `docs/deployment-design.md` and `docs/k3s-migration/DESIGN.md`.

## Git And Tickets

- Feature work happens in a ticket-id-led worktree, e.g. `www-xxx-short-slug`. Do not develop in the shared main checkout.
- This repo ships to `main`, no PRs. Finish by merging the worktree locally, pushing `main`, and closing the Beads issue.
- Commit subjects must be `type(area/www-xxx): desc`; the commit-msg hook validates the ticket id with `bd show`.
- Pre-push runs Biome, Knip, then a non-blocking Beads sync. Knip is zero-tolerance; deliberate unused public exports need `/** @public, reason */`.
- Before ending a session with code changes, run relevant gates, check `git status`, commit, push, and verify the branch is up to date with origin.

## Shell Safety

- Use non-interactive flags for file commands that may be aliased: `cp -f`, `mv -f`, `rm -f`, `rm -rf`, `scp -o BatchMode=yes`, `ssh -o BatchMode=yes`.
- Never use loose `pkill`/`killall` on this shared machine. For ports, use `fkill :<port>`.
