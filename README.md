# control-center

[![CI](https://github.com/0x63616c/control-center/actions/workflows/ci.yml/badge.svg)](https://github.com/0x63616c/control-center/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/0x63616c/control-center/main/.github/badges/coverage.json)](https://github.com/0x63616c/control-center/actions/workflows/ci.yml)
[![Files](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/0x63616c/control-center/main/.github/badges/files.json)](https://github.com/0x63616c/control-center)
[![Lines](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/0x63616c/control-center/main/.github/badges/loc.json)](https://github.com/0x63616c/control-center)
[![Commit](https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/0x63616c/control-center/main/.github/badges/commit.json)](https://github.com/0x63616c/control-center/commits/main)
[![Last commit](https://img.shields.io/github/last-commit/0x63616c/control-center)](https://github.com/0x63616c/control-center/commits)

Smart-home wall-panel dashboard for a fixed **1366×1024** iPad Pro panel (the board
content grid is 1366×1000, `BOARD_W`×`BOARD_H`) mounted
on the wall. It renders a board of live tiles (climate, controls, weather, network,
Tesla, dog cam, …) driven by a tRPC backend, and deploys itself to a Mac Mini
(`homelab`) through a **Pulumi** program that targets the box's **Kubernetes**
cluster.

## Monorepo layout

| Path | What |
| --- | --- |
| `products/control-center/web` | React board. Tiles are composed from shared primitives in `src/components/ui/` (`TileHeader`, `StatCell`, `Pill`, `Skeleton`, `TileWrapper`). Fixed 1366×1024 panel (1366×1000 content grid), never responsive. |
| `products/control-center/api` | tRPC backend. Services **throw** on error/unconfigured (never return constants); the web QueryClient retries infinitely, so a tile shows a shimmer `Skeleton` and recovers when data returns. |
| `products/control-center` | Product-owned Control Center boundary. Current packages are compatibility wrappers around the legacy `apps/*` source paths so M7 can migrate CI, infra, data, iOS, and routes safely without changing runtime behavior in this first step. |
| `infra` | The deploy program: a Pulumi TypeScript stack that declares every service, secret, route, and cron as typed `ComponentResource`s and reconciles the homelab Kubernetes cluster. See `docs/k3s-migration/DESIGN.md`. |

## Architecture in one line

`infra/` (Pulumi TypeScript) → `pulumi up --stack prod` reconciles the **OrbStack
built-in Kubernetes** cluster on `homelab` to match the declared stack. Secrets
via the External Secrets Operator (1Password), TLS via cert-manager, Postgres via
CNPG, and the Cloudflare tunnel via in-cluster `cloudflared` (2 replicas).

## Deploy path (push → live)

1. **Push to `main`.** GitHub Actions (`.github/workflows/ci.yml`) path-filters which
   images changed and builds only those (`web`, `api`, `worker`, `media-worker`,
   `storybook`, `drizzle`, `captive-portal`), pushing `ghcr.io/0x63616c/control-center-*:main`.
2. **The `deploy` job joins the tailnet** on an ephemeral `tag:ci` auth key (so the
   runner can reach homelab's kube-apiserver), reads each image's `:main` digest, and
   sets the per-image digest map as Pulumi config (`pulumi config set --path
   ccinfra:imageDigests.<svc>`).
3. **`pulumi up --stack prod`** reconciles the cluster. Images are **pinned by digest**,
   so only the workloads whose digest actually changed roll (www-czg lineage). The
   ephemeral node is revoked after the deploy.

Code changes are build-bound; an `infra/**`-only change still triggers a `pulumi up`.
Three things stay on the host by hand: Tailscale, the Home Assistant VM, and OrbStack.

## Scheduling

Cron jobs are **Kubernetes `CronJob`s declared in `infra/src/crons.ts`** (e.g. the
nightly DB purge and the nightly Postgres backup to the NAS). They run on
`TZ=America/Los_Angeles`, so a `0 3 * * *` schedule fires at 03:00 LA. See
`docs/k3s-migration/DESIGN.md`.

## Local development

```bash
bun run dev          # tilt up, local stack (postgres + api + web + storybook)
bun run --filter @control-center/web dev          # product wrapper for the web dev server
bun run --filter @control-center/api typecheck    # product wrapper around the legacy api package
bun run --filter @product/control-center dev:web  # product-scoped web dev command
bun run --filter @product/control-center ios:sync # product-scoped iOS sync command
```

In a cmux workspace, the `setup-cc-workspace` skill spins up the Tilt stack and
opens the app + Tilt log UI. The board is also viewable in Storybook's wall-panel
viewport.

## Commands

```bash
bun run test         # vitest, the ONLY test runner. NEVER `bun test` (Bun's native runner breaks vi.mock)
bun run typecheck    # tsc across all workspaces
bunx biome check .   # lint/format (add --write to auto-fix)
```

`bun`/`bunx` always, never `npm`/`npx`.

## More

- `docs/k3s-migration/DESIGN.md`, the deploy program: Pulumi components, secrets (ESO), TLS (cert-manager), Postgres (CNPG), in-cluster cloudflared, the CI pulumi-up pipeline.
- `docs/deployment-design.md`, operator-facing deploy overview + recovery knobs.
- `CLAUDE.md`, conventions, enforced guards, and instructions for AI agents.
