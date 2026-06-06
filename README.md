# control-center

[![CI](https://github.com/0x63616c/control-center/actions/workflows/ci.yml/badge.svg)](https://github.com/0x63616c/control-center/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/0x63616c/control-center/main/.github/badges/coverage.json)](https://github.com/0x63616c/control-center/actions/workflows/ci.yml)
[![Code files](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/0x63616c/control-center/main/.github/badges/code-files.json)](https://github.com/0x63616c/control-center)
[![Lines](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/0x63616c/control-center/main/.github/badges/loc.json)](https://github.com/0x63616c/control-center)
[![Files](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/0x63616c/control-center/main/.github/badges/files.json)](https://github.com/0x63616c/control-center)
[![Last commit](https://img.shields.io/github/last-commit/0x63616c/control-center)](https://github.com/0x63616c/control-center/commits)

Smart-home wall-panel dashboard for a fixed **1366×1024** iPad Pro panel (the board
content grid is 1366×1000 — `BOARD_W`×`BOARD_H`) mounted
on the wall. It renders a board of live tiles (climate, controls, weather, network,
Tesla, dog cam, …) driven by a tRPC backend, and deploys itself to a Mac Mini
(`homelab`) through an in-repo deploy tool, **bosun**.

## Monorepo layout

| Path | What |
| --- | --- |
| `apps/web` | React board. Tiles are composed from shared primitives in `src/components/ui/` (`TileHeader`, `StatCell`, `Pill`, `Skeleton`, `TileWrapper`). Fixed 1366×1024 panel (1366×1000 content grid), never responsive. |
| `apps/api` | tRPC backend. Services **throw** on error/unconfigured (never return constants); the web QueryClient retries infinitely, so a tile shows a shimmer `Skeleton` and recovers when data returns. |
| `packages/bosun` | The deploy tool: a pure, typed deploy spec + reconcilers + a webhook agent that deploys the stack and runs the cron scheduler. See `packages/bosun/README.md`. |
| `deploy.config.ts` | The deployment manifest — pure data describing every service, secret reference, route, and cron job. |

## Architecture in one line

`deploy.config.ts` (pure typed spec) → **bosun** renders it to a Docker Swarm
stack and reconciles secrets/routes/services → the stack runs on **OrbStack
single-node Swarm** on `homelab`. **Portainer** is monitoring-only; bosun is the
only thing that deploys.

## Deploy path (push → live)

1. **Push to `main`.** GitHub Actions (`.github/workflows/ci.yml`) path-filters which
   images changed and builds only those (`web`, `api`, `storybook`, `bosun`),
   pushing `ghcr.io/0x63616c/control-center-*:main`.
2. **CI reads each image's `:main` digest** and POSTs `{"images": {<name>: <digest>}}`
   to `https://hooks.worldwidewebb.co/deploy/control-center` with a bearer token.
3. **The `bosun-agent` service** (running on the box) receives the webhook and runs
   `bosun up`: resolve secrets from 1Password → render the stack with images
   **pinned by digest** → `docker stack deploy`. Pinning by digest means only the
   services whose digest actually changed roll (CC-czg).

Config-only changes deploy in seconds; code changes are build-bound. Three things
stay on the host by hand: Tailscale, the Home Assistant VM, and OrbStack.

## Scheduling

Cron jobs (e.g. the nightly Docker image prune) are declared with `cronJob()` in
`deploy.config.ts` and run by **bosun's own in-process scheduler** inside the
`bosun-agent`, as one-shot Swarm jobs (`docker service create --mode
replicated-job`). The agent container runs on `TZ=America/Los_Angeles`, so a
`0 3 * * *` schedule fires at 03:00 LA. See `packages/bosun/README.md`.

## Local development

```bash
bun run dev          # tilt up — local stack (postgres + api + web + storybook)
```

In a cmux workspace, the `setup-cc-workspace` skill spins up the Tilt stack and
opens the app + Tilt log UI. The board is also viewable in Storybook's wall-panel
viewport.

## Commands

```bash
bun run test         # vitest — the ONLY test runner. NEVER `bun test` (Bun's native runner breaks vi.mock)
bun run typecheck    # tsc across all workspaces
bunx biome check .   # lint/format (add --write to auto-fix)
```

`bun`/`bunx` always — never `npm`/`npx`.

## More

- `packages/bosun/README.md` — the deploy tool: spec model, scheduler, routes, secrets, digest-pin deploy.
- `docs/deployment-design.md` — full deployment design.
- `CLAUDE.md` — conventions, enforced guards, and instructions for AI agents.
