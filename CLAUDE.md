# Project Instructions for AI Agents

Read `CODEBASE_OVERVIEW.md` first. It is the shortest reliable map of the repo.

## Task Tracking

- Use `bd` for durable work tracking.
- `bd prime`, `bd ready`, `bd show <id>`, `bd update <id> --claim`, `bd close <id>`.
- Use `bd remember` for durable repo memory.
- Do not use TodoWrite or markdown TODO lists.

## Commands

```bash
bun install --frozen-lockfile
bun run dev
bun run test
bun run typecheck
bunx biome check .
bun run knip
```

- Use `bun` and `bunx`, never `npm` or `npx`.
- Run tests with `bun run test`, never bare `bun test`.

## Repo Shape

- `products/control-center/web`, React board, Storybook, Capacitor iOS shell.
- `products/control-center/api`, Bun + tRPC API, domain services, schema, migrations.
- `products/control-center/worker`, fast interval workers.
- `products/control-center/media-worker`, heavier queue and media jobs.
- `products/control-center/storybook`, thin wrapper around web Storybook.
- `products/project-management`, standalone Beads UI and Temporal workflow package.
- `products/text-your-ex`, `apps/frontend`, `apps/api`, `apps/e2e`.
- `products/captive-portal`, `apps/frontend`, `apps/api`.
- `products/amp`, static app.
- `packages/api`, browser-safe tRPC type bridge.
- `packages/logger`, shared backend logger.
- `packages/platform`, product and infra primitives.
- `infra`, Pulumi + Kubernetes deploy program.

## Repo Rules

- Wall panel is fixed at `1366x1024`, not responsive.
- Tile placement lives in `products/control-center/web/src/lib/tile-registry.ts`.
- Tiles use shared primitives from `products/control-center/web/src/components/ui/`.
- Unavailable data shows skeletons or errors, never invented values.
- New UI should be Storybook-first.
- IDs default to Stripe-style `prefix_<id>`.
- Backend services throw on error or missing config, the client retries and recovers.

## Deploy And Infra

- Current deploy path is push to `main` -> CI -> build changed images -> `pulumi up --stack prod`.
- Digest pins use the `wwwinfra:imageDigests.*` namespace.
- Cron-style work belongs in `infra/src/crons.ts` as Kubernetes `CronJob`s.

## Git And Workflow

- Work in ticket-led worktrees.
- Ship by commit and push, no PRs.
- Keep commits small and scoped.
- Update docs when behavior, deploy, or ops paths change.

## Safety

- Never add fake, fallback, or placeholder data.
- Never commit secrets or private home-location values.
- Use structured logging, not `console.*`, in backend code.
- Use `fkill :<port>` instead of loose `pkill` or `killall`.
