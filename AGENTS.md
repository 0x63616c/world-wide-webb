# Agent Instructions

## Start Here

- Read `CODEBASE_OVERVIEW.md` first. Compact map of runtime shape, entrypoints, where changes belong.
- `opencode.jsonc` already loads `CLAUDE.md`, `README.md`, main ops docs as instructions. Don't duplicate here unless detail is easy-to-miss working rule.
- Before writing/editing/reviewing TypeScript/TSX, use `writing-scalable-typescript` skill when available, follow `docs/writing-scalable-typescript/README.md`.
- Use Beads for durable tracking: `bd prime`, `bd ready`, `bd show <id>`, `bd update <id> --claim`, `bd close <id>`. Don't treat `.beads/issues.jsonl` as source of truth or run `bd import` during normal work.
- Mentioning any `CC-*` Beads ticket: include id AND title, e.g. `www-4jvw - Add recap skill and www-ticket title rule`.
- Calum asks to research/compare/price/verify current external facts: check online when sensible. Don't rely on stale model knowledge for live/vendor-specific info.

## Commands

- Install deps: `bun install --frozen-lockfile`. `bun`/`bunx` only, never `npm`/`npx`.
- Dev stack: `bun run dev` starts Tilt for local Postgres, API, workers, web, Storybook.
- Unit tests: `bun run test`. Never run bare `bun test`, breaks `vi.mock`, reports false failures.
- Focused tests/typecheck: `bun run --filter @control-center/web test`, `bun run --filter @control-center/api typecheck`, etc.
- Control Center product wrappers: `bun run --filter @product/control-center dev:web`, `dev:api`, `dev:worker`, `dev:media-worker`, `dev:storybook`, `dev:db`, `ios:sync`, `ios:open`, `ios:sim`.
- Full gates before shipping code: `bun run test`, `bun run typecheck`, `bunx biome check .`, `bun run knip`.
- Coverage/browser suite: `bun run test:coverage` slower, needs Playwright Chromium. Storybook browser tests run from `products/control-center/web` with `bunx vitest --project storybook`.
- In `.claude/worktrees/*`, `bunx biome check .` scans zero files because `biome.json` excludes `.claude`. Use lefthook-style tracked-file command or explicit paths instead.

## Architecture

- `products/control-center/web`: React wall panel + Storybook + Capacitor iOS shell. Main route `products/control-center/web/src/routes/index.tsx`, renders `Board`.
- `products/control-center/api/src/server.ts`: Bun+tRPC API entrypoint. Routers under `products/control-center/api/src/trpc/routers`, domain logic under `products/control-center/api/src/services`.
- `products/control-center/worker`: fast interval loops; imports domain cycles via `@control-center/api/worker` (`products/control-center/api/src/worker-deps.ts`).
- `products/control-center/media-worker`: heavier queue/media work; imports via `@control-center/api/media`.
- `products/control-center`: product-owned boundary. Current packages = compatibility wrappers delegating to legacy `apps/*` paths until M7 tickets move CI, infra, source fully behind product paths.
- `packages/api`: browser-safe type bridge only. No backend runtime code in web bundle.
- `packages/logger`: shared backend logger. Backend uses `@repo/logger`, not `console.*`.
- `packages/platform`: pure platform foundation package. Product/platform work prefer its typed product, target, exposure, secret, database, backup, manifest primitives over new infra string soup.
- `infra/`: current Pulumi+k8s deploy program. Old bosun/Swarm docs historical only.

## Product Invariants

- Wall panel fixed, not responsive: physical viewport `1366x1024`, board content `BOARD_W=1366`, `BOARD_H=1000` in `products/control-center/web/src/lib/grid-constants.ts`.
- Tile placement + sizing belong in `products/control-center/web/src/lib/tile-registry.ts`, not board layout rewrites.
- Tiles must use shared primitives from `products/control-center/web/src/components/ui/`: `TileHeader`, `StatCell`, `Pill`, `Skeleton`, `TileWrapper`.
- No fake data. Unavailable data renders skeleton/error + recovers. `FALLBACK`, `PLACEHOLDER` uppercase identifiers banned; `DEMO_`/`demo_` allowed only in sanctioned service/test files enforced by `scripts/check-fake-data.sh`.
- Storybook-first for new UI components where practical. Every story must enable autodocs directly or via sanctioned meta factory.
- IDs default Stripe-style `prefix_<id>` unless user asks otherwise.

## Data And Integrations

- API config parsed in `products/control-center/api/src/env.ts`. Prod secrets mount as files under `/run/secrets/<NAME>`, hydrate at boot.
- Real secrets live in 1Password Homelab. Never commit `.env`, secret values, private home-location values, keys, or placeholder creds.
- Drizzle schema: `products/control-center/api/src/db/schema.ts`. Generate migrations with `bun run --filter @control-center/api db:generate`; API + workers run migrations at boot.
- Desired state DB-authoritative for managed devices. Frontend writes desired state, workers reconcile to integrations, reported state observed separately.
- House climate: target `climate.home`. HA entities named `evee` are Tesla, NOT home thermostat.

## Infra And Deploy

- Push to `main` runs CI, builds changed arm64 images, then `pulumi up --stack prod` against homelab k8s. Infra-only changes deploy without rebuilding images.
- Pulumi image digest config MUST use `ccinfra:` namespace, e.g. `ccinfra:imageDigests.<svc>`. Without it, builds succeed but pods don't roll.
- Cron-style work belongs in Kubernetes `CronJob`s in `infra/src/crons.ts`, not legacy scheduler labels or third-party scheduler.
- Ops/deploy-path changes MUST update relevant docs same change, especially `docs/deployment-design.md` and `docs/k3s-migration/DESIGN.md`.

## Platform Migration

- Platform/product split work? Read `docs/platform/README.html` + `docs/platform/NORTH_STAR.html` first. Repo = platform team building paved roads for app teams.
- Platform primitives make right thing easy: derive names from app context, avoid magic strings, standardize shared infra, expose only necessary customization, no duplicate Kubernetes/Cloudflare/secret/backup wiring across products.
- Product DBs = CNPG Postgres clusters with mandatory platform-managed NAS backups. Backups not optional.
- Secrets stay central in 1Password Homelab, but each product/service must explicitly declare which secrets it accesses. Shared secrets OK when genuinely shared.
- Isolate product work under `products/<name>`. Keep Control Center, Captive Portal, Text Your Ex, AMP separate: separate namespaces, CI/deploy paths, route policies.

## Git And Tickets

- Feature work in ticket-id-led worktree, e.g. `www-xxx-short-slug`. Never develop in shared main checkout.
- Testing agent/opencode/plugin/skill changes from worktree? Launch test session under `tmux` from that worktree so it loads worktree files. Keep probes quick, low timeouts ~5s, always kill the `tmux` session you created when done.
- Ships through PRs to `main`. Push ticket branch, open PR, wait green checks, merge via GitHub, then close Beads issue.
- Commit subjects must be `type(area/www-xxx): desc`; commit-msg hook validates ticket id with `bd show`.
- Pre-push runs Biome, Knip, then non-blocking Beads sync. Knip zero-tolerance; deliberate unused public exports need `/** @public, reason */`.
- Before ending session with code changes: run relevant gates, check `git status`, commit, push, verify branch up to date with origin.

## Shell Safety

- Non-interactive flags for aliasable file commands: `cp -f`, `mv -f`, `rm -f`, `rm -rf`, `scp -o BatchMode=yes`, `ssh -o BatchMode=yes`.
- Never loose `pkill`/`killall` on shared machine. Ports: `fkill :<port>`.
