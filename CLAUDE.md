# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->


## Build & Test

`bun`/`bunx` ALWAYS — never `npm`/`npx`. Monorepo: `apps/web` (React board), `apps/api` (tRPC).

```bash
bun run test        # vitest run — the ONLY test runner. NEVER `bun test` (Bun's native runner breaks vi.mock with false failures)
bun run typecheck   # tsc across all workspaces
bunx biome check .  # lint/format gate (use `bunx biome check --write .` to auto-fix)
bun run dev         # tilt up (local dev stack)
```

## Workflows

Reusable multi-agent orchestration scripts live in `.claude/workflows/` (run via the Workflow tool: `Workflow({ name: '<n>', args: {...} })`).

- **`ship`** — Factory-Missions-style pipeline for shipping a bd issue/epic end-to-end. Beads is the shared mission state: scope writes a validation contract into the epic's `--design`, each feature becomes a child issue with `--acceptance` + a `milestone-N` label + deps for serial order; it builds → validates → fixes **per milestone**, then hardens and finalizes. Resumable after a crash via `args.resume=<epicId>`.
  - **Model tiers** (rule: haiku is a good validator but a bad coder, so it never writes code): `opus` scopes, `sonnet` does ALL coding (build/fix/harden), `haiku` runs the adversarial validators + bd/gate bookkeeping.
  - **Intended use:** scope + approve the plan with Calum first, then launch. Conservative git — commits per feature, no `git push` unless `args.push:true`.
- **`wf-finish-dashboard.mjs`** (untracked, repo root `.claude/`) — the original one-shot that finished the dashboard; `ship` is its generalization. Kept for reference.

## Architecture Overview

Smart-home wall-panel dashboard, fixed 1366×1024. `apps/web` renders tiles from shared primitives under `apps/web/src/components/ui/`; `apps/api` is a tRPC backend whose services THROW on error/unconfigured (never return constants). The QueryClient retries infinitely so tiles recover from outages.

**Deploy:** `deploy.config.ts` (a pure typed spec) is rendered + reconciled to a Docker Swarm stack by **bosun** (`packages/bosun`), running on OrbStack single-node Swarm on `homelab`; Portainer is monitoring-only. Push to `main` → CI path-filters + builds changed images → POSTs the per-image digest map to the `bosun-agent` webhook → the agent runs `bosun up` (secrets from 1Password, **digest-pinned** stack deploy so only changed services roll). Secrets resolve via `op`, serialized to avoid a cold-start daemon race.

**Scheduling:** cron jobs are declared with `cronJob()` and run by bosun's own in-process scheduler inside the agent as one-shot Swarm jobs (`--mode replicated-job`), on `TZ=America/Los_Angeles`. There is no third-party scheduler (a lefthook guard enforces this; see Conventions). Full detail in `packages/bosun/README.md`.

## Conventions & Patterns

- **ZERO fake/hardcoded/placeholder data** (web + api). On unavailable data a tile shows a shimmer Skeleton and keeps retrying — never an invented number. A repo-wide grep for `FALLBACK`/`PLACEHOLDER` (uppercase identifiers) must stay empty. Two files are sanctioned exceptions: `apps/api/src/services/network-service.ts` and `apps/api/src/services/weather-service.ts` hold always-on `DEMO_*` data until real integrations land.
- **Pre-commit guard enforces the above.** `scripts/check-fake-data.sh` runs via lefthook on every commit — it exits non-zero if staged TS/TSX introduces `FALLBACK`/`PLACEHOLDER` identifiers or `DEMO_`/`demo_` outside the sanctioned files. Lowercase `fallback` as a parameter name and component names like `TilePlaceholder` are not flagged.
- **No-Ofelia guard.** `scripts/check-no-ofelia.sh` runs via lefthook on every commit — it blocks any staged file (ts/tsx/js/mjs/json/yml/md/sh/toml) that reintroduces `ofelia`/`mcuadros/ofelia`. Scheduling is bosun-native: declare cron tasks with `cronJob()`; the scheduler in `packages/bosun/src/scheduler.ts` runs each as a one-shot Swarm job (`docker service create --mode replicated-job`). The forbidden token is sanctioned only inside the guard script itself.
- **Commit-msg guard enforces traceability.** `scripts/check-commit-msg.sh` runs via lefthook's `commit-msg` stage. The subject MUST be `type(area/CC-xxx)[!]: desc` — a Conventional Commit (type ∈ feat|fix|chore|refactor|docs|test|ci|build|perf|style|revert) whose **scope carries a mandatory area AND the bd ticket id**, e.g. `feat(weather/CC-m9k): add poller` or nested `fix(web/tiles/CC-m9k): …`. The ticket id is the final scope segment and MUST live in the scope — a body-only `refs CC-xxx` trailer no longer satisfies the check (it may additionally appear in the body). The scope ticket is validated as a **real** issue with one `bd show <id>`; if `bd` is offline/unavailable it warns and degrades gracefully rather than hard-blocking. Hermetic tests in `scripts/test-check-commit-msg.sh` (stub `bd` on PATH) cover the pass/reject matrix. EVERY change must ship with a commit naming an area and referencing a real bd ticket — no exceptions.
- **Test runner is `bun run test` (vitest).** NEVER run bare `bun test` — Bun's native runner is incompatible with `vi.mock` and produces false failures.
- Tiles use the shared `components/ui/` primitives — do not re-inline headers/stats/pills/skeletons. Primitives: `TileHeader`, `StatCell`, `Pill`, `Skeleton`, `TileWrapper` (barrel: `apps/web/src/components/ui/index.ts`).
- Imports at top of file only; no module-global mutable vars; comments explain WHY not HOW.
- Board is a fixed **1366×1024** wall panel (iPad Pro on Home). Never design for fluid/responsive.
