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

### Sync model (www-sg4p — read before touching beads sync)

Durable sync is the Dolt git remote: **`refs/dolt/data` on origin**, established and verified working. Rules that keep it working:

- **`dolt.auto-push` MUST stay OFF.** Per-write auto-push fires a `git+ssh` push on every `bd` command; because `.beads/dolt` has no own `.git`, those all run git ops against the shared parent `control-center/.git` and contend/livelock (the original "Uploading…" hang). Sync rides the **lefthook `pre-push` hook** (`bd dolt push`) instead — once per `git push`, batched. `post-merge` runs `bd dolt pull`. Both are non-blocking. `bootstrap-beads.sh` sets auto-push off; new clones must too.
- **`.beads/issues.jsonl` / `interactions.jsonl` are gitignored exports**, NOT the sync channel. Never commit them (upsert-only, can't represent deletions — the documented anti-pattern). The Dolt git remote is the source of truth.
- **Fresh clone:** run `scripts/bootstrap-beads.sh` (it does `bd dolt start` → `bd bootstrap` → auto-push off, in that order — bootstrap needs the server up first because tracked `metadata.json` pins `dolt_mode: server`). It reconstructs the full issue set from origin; no JSONL needed.
- **dolt's `git+ssh` push is slow** (upstream dolt#10537, ~15-44s/round-trip) but reliable once `refs/dolt/data` exists. A *first* push (ref absent) loops on `git fetch refs/dolt/data` — if origin ever loses the ref, re-seed with one clean uncontended `bd dolt push` (no concurrent `bd` commands).
- **lefthook is the SOLE hook owner; it calls beads.** The beads hook lifecycle (pre-push push, post-merge/post-checkout pull, prepare-commit-msg trailers) is wired as commands in `lefthook.yml`, not via beads' own installer. Do NOT run `bd hooks install --shared` (hijacks `core.hooksPath` → `.beads-hooks/`, gitignored) or `--force` (clobbers lefthook's hooks). A plain `bd hooks install` is non-destructive but redundant — just re-run `lefthook install` if hooks ever go missing.

## Dev lifecycle (www-w6j2 — how we work)

Every ticket follows one lifecycle, defined once in **`docs/ticket-standards.md`** (READ IT before creating, starting, or finishing work). The spine:

```
/new-ticket  →  /starting-ticket  →  (build, TDD)  →  /finish-ticket
   open             in_progress                            closed
```

- **`/new-ticket`** — create a *Ready* ticket: type (mapped to a real bd type), priority, area, and checkbox AC with the per-type Definition of Done auto-appended. Never hand-type house rules into AC; the skill generates them.
- **`/starting-ticket`** — Definition-of-Ready gate (refuse if unmet) → `bd update --claim` → `git pull --rebase` → `EnterWorktree` named `www-xxx-slug` → **red test first** → surface the DoD.
- **`/finish-ticket`** — gates green (REFUSE on red) → verify every AC item (screenshot@1366×1024 for UI) → commit `type(area/www-xxx)` → **merge worktree to `main`, NO PR** → push → `bd close` → harden audit.
- **`ship`** (workflow) is the same lifecycle parallelized for a whole epic, hands-off. Use the skills for human-in-the-loop work; use `ship` for an approved epic.

The standards doc holds the taxonomy, Definition of Ready, Definition of Done (+ per-type adders), priority rubric, AC format, and the enforcement matrix. `scripts/lint-tickets.sh` is the advisory backstop. The lifecycle never opens a PR — worktrees merge to `main` locally.

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
bun run test        # vitest run (unit, jsdom) — the default. NEVER `bun test` (Bun's native runner breaks vi.mock with false failures). Fast, no browser.
bun run test:coverage # MERGED coverage: unit (jsdom) + Storybook (Playwright/chromium), via scripts/coverage.sh (blob runs + vitest --mergeReports). Slow; needs chromium.
bun run badges      # regenerate self-hosted README badges (.github/badges/{coverage,loc}.json) from real runs
bun run typecheck   # tsc across all workspaces
bunx biome check .  # lint/format gate (use `bunx biome check --write .` to auto-fix)
bun run dev         # tilt up (local dev stack)
```

**CI test gate (www-hjvu):** the `test` job in `.github/workflows/ci.yml` runs typecheck + `test:coverage` (installs Playwright chromium) on every push, and **`deploy` depends on it** — failing/flaky **tests** block prod deploys. The Storybook browser project is pinned to `fileParallelism: false` (parallel files overload the single Chromium instance and flake); keep it serial. The CI job is the **sole** badge source: it regenerates and commits all badge JSON (coverage/loc/files/commit) back to `main` with `[skip ci]`. Pre-commit no longer stages badges — that baked churn into every commit and conflicted on every worktree→main merge (www-w6j2.8).

**Coverage is reported, never gated.** `vitest.config.ts` has coverage `include`/`exclude` + reporters (the % feeds the README badge) but deliberately **no `thresholds`** — a coverage drop must never fail a job or block a deploy. Do NOT re-add `thresholds`/`autoUpdate` (the merged unit+browser % is slightly nondeterministic, so a ratchet flakes CI). Only real test failures gate.

## Workflows

Reusable multi-agent orchestration scripts live in `.claude/workflows/` (run via the Workflow tool: `Workflow({ name: '<n>', args: {...} })`).

- **`ship`** — Factory-Missions-style pipeline for shipping a bd issue/epic end-to-end. Beads is the shared mission state: scope writes a validation contract into the epic's `--design`, each feature becomes a child issue with `--acceptance` + a `milestone-N` label + deps for serial order; it builds → validates → fixes **per milestone**, then hardens and finalizes. Resumable after a crash via `args.resume=<epicId>`. It is the manual dev lifecycle parallelized and follows the same `docs/ticket-standards.md` (taxonomy, Definition of Ready/Done, `type(area/www-xxx)` commits).
  - **Model tiers** (rule: haiku is a good validator but a bad coder, so it never writes code): `opus` scopes, `sonnet` does ALL coding (build/fix/harden), `haiku` runs the adversarial validators + bd/gate bookkeeping.
  - **Intended use:** scope + approve the plan with Calum first, then launch. Conservative git — commits per feature, no `git push` unless `args.push:true`.
- **`wf-finish-dashboard.mjs`** (untracked, repo root `.claude/`) — the original one-shot that finished the dashboard; `ship` is its generalization. Kept for reference.

## Architecture Overview

Smart-home wall-panel dashboard, fixed 1366×1024. `apps/web` renders tiles from shared primitives under `apps/web/src/components/ui/`; `apps/api` is a tRPC backend whose services THROW on error/unconfigured (never return constants). The QueryClient retries infinitely so tiles recover from outages.

**Deploy:** `deploy.config.ts` (a pure typed spec) is rendered + reconciled to a Docker Swarm stack by **bosun** (`packages/bosun`), running on OrbStack single-node Swarm on `homelab`; Portainer is monitoring-only. Push to `main` → CI path-filters + builds changed images → POSTs the per-image digest map to the `bosun-agent` webhook → the agent runs `bosun up` (secrets from 1Password, **digest-pinned** stack deploy so only changed services roll). Secrets resolve via `op`, serialized to avoid a cold-start daemon race.

**Scheduling:** cron jobs are declared with `cronJob()` and run by bosun's own in-process scheduler inside the agent as one-shot Swarm jobs (`--mode replicated-job`), on `TZ=America/Los_Angeles`. There is no third-party scheduler (a lefthook guard enforces this; see Conventions). Full detail in `packages/bosun/README.md`.

**Worker framework + the `worker` app (www-7d5b.1 → www-xjba):** continuous interval loops are uniform `Worker`s — `interface Worker { name; intervalMs; runOnStart?; run() }` (`apps/worker/src/types.ts`) driven by `createWorkerRuntime()` (`apps/worker/src/runtime.ts`), which gives each worker its own await-before-reschedule timer (no overlapping cycles), wraps every `run()` in try/catch (one failure never kills its loop or a sibling), and tracks per-worker stats (`lastRunAt`, `lastDurationMs`, `totalRuns`, `consecutiveFailures`, `lastError`, sampled memory). It is its **own app + image** (`apps/worker` → `control-center-worker`): the entrypoint (`src/index.ts`) + framework + job registry live in `apps/worker`, and it imports its domain cycles from `@repo/api` via the `./worker` barrel (`apps/api/src/worker-deps.ts`) — an interim seam until the planned `packages/core` domain extraction. CI has a dedicated `build-worker` job + `worker` path filter (rebuilds on `apps/worker/**` OR `apps/api/**`, since the worker bundles api code), and bosun's digest-pin rolls it **independently of the api**. The **api is request-only** (it no longer starts loops in-process; its image ships `server.js` only). Workers registered today: `light-enforcer` (1s), `climate-enforcer` (1s), `device-sync` (1s, fan-only), `party-mode` (2s), `weather-ingest` (5m). **Future cron-style automations use bosun `cronJob()`, NOT worker loops** — the framework is for interval/reconcile workers only.

**Lights are DB-authoritative (www-7d5b.2):** `device_state.desiredState` is the **source of truth** for managed lights; HA/Hue is just an **actuator**. The `light-enforcer` worker (`light-enforcer-service.ts`) reconciles each cycle: seeds `desired` from `reported` once when null (no push), then on steady-state drift (tolerant compare — rgb per-channel ≤12, kelvin ±250, brightness ±3; NOT the exact `stateEquals`, which is for reported-change detection) branches on the device's **control policy** (below). It writes HA **only on drift**, skips a device with an in-flight command (the command owns that transition), and on unreachable sets `available=false` (never paints `desired` as real). The **frontend reads `desired`** (via `mergeDeviceState`, desired-authoritative) so the panel is instantly self-consistent — no cooldown/flicker hack. **`device-sync` is now fan-only** and skips any `findLight()` row so it never double-drives the lights.

**Per-device control policy (`lights.ts`):** `LightEntry.control: 'enforce' | 'adopt'`, resolved by `lightControl()` which **defaults unspecified → `adopt`**. On unsolicited external drift: `enforce` → push `desired` to HA (we win) — the **7 Hue lamps**, so scenes/party persist; `adopt` → set `desired = reported` (absorb the change as new intent, never fight) — the **2 Shelly `switch.` fixtures** (`overhead_lights`, `under_cabinet`) with real wall switches, and the safe default for any new device. App commands (dashboard taps) always write `desired` + actuate immediately for BOTH policies; `control` governs only drift, so a Shelly responds to its wall switch AND the dashboard (last-writer-wins).

**Party mode (www-7d5b.3):** a persistent **lamp mode** in the `lamp_mode` singleton table (`mode` `none|party`, `speed`, `updated_at_utc`; code enum `LampMode`). `setLampMode({mode, speed?})` writes the row; the `party-mode` worker (`party-service.ts`) reads it + lamp on-state and starts/stops/restarts an in-process animation **engine** that drives `light.turn_on` with an HA `transition` crossfade per `LAMP_MODE_SPEED_CONFIG`, cycling `partyColorsAtTick` (deterministic wave). DB-row-as-truth makes party **durable across worker restarts** (the reconciler re-arms). While `mode==='party'` the **enforcer yields the COLOUR dimension** to the engine (still enforces on/off so lamps stay lit); on stop, colour enforcement resumes from `desired`.

## iOS wall-panel app (Capacitor → TestFlight) — www-w1a4

The iPad runs a thin **native iOS Capacitor "kiosk" shell** (`apps/web/ios`) that loads `https://dashboard.worldwidewebb.co` full-screen — it does **not** bundle the dashboard. The web app deploys via bosun exactly as above; the shell just renders that URL, so **dashboard changes are OTA — no App Store rebuild needed**. Migrated verbatim from the `evee` repo (www-w1a4).

- **Identity is inherited, intentionally.** Bundle id `co.worldwidewebb.theworkflowengine` (legacy, immutable, never user-visible), Apple team `X9E4HG27NK`. Home-screen display name is **"Control Center"** (`CFBundleDisplayName` in `Info.plist` + `appName` in capacitor.config). This is the SAME app record as the original evee TestFlight build (which displayed "Evee"), so new builds land as updates to it (was 1.0 b48). The display name is freely changeable; do NOT change the bundle id or you fork off into a new TestFlight app. `server.url` lives in `apps/web/capacitor.config.ts` (override locally with `CAPACITOR_DEV_SERVER_URL`).
- **Kiosk behavior:** idle timer disabled (never sleeps), landscape-locked on iPad, dark, status bar hidden — `AppDelegate.swift` / `KioskViewController.swift` / `Info.plist`.
- **Build & ship:** `.github/workflows/ios-build.yml` (macOS runner) on push touching `apps/web/ios/**` / `capacitor.config.ts` / `apps/web/package.json`, a **monthly cron** (`0 12 1 * *` — refreshes the 90-day TestFlight build expiry), or manual dispatch. Steps: bun install → `bun run build` (web) → `bunx cap sync ios` → `bundle exec fastlane release`. Signing is **fastlane match** (certs in private repo `0x63616c/certificates`); the IPA uploads to TestFlight.
- **Build number = `latest_testflight_build_number + 1`** (in `ios/fastlane/Fastfile`), NOT the CI run number — this repo's `github.run_number` starts low and would collide with / regress below the existing builds, which ASC rejects.
- **Secrets (repo-level, sourced from 1Password Homelab):** `ASC_KEY_ID` / `ASC_ISSUER_ID` / `ASC_KEY_CONTENT` (item "App Store Connect API", `.p8` base64'd) + `MATCH_PASSWORD`; `MATCH_GIT_URL` (`https://github.com/0x63616c/certificates.git`) + `MATCH_GIT_BASIC_AUTHORIZATION` (base64 of `0x63616c:<PAT>` from item "GitHub Personal Access Token").
- **Gemfile gotcha:** must keep `gem "multi_json"` — fastlane 2.235+ loads its Google Play actions at startup which `require "multi_json"`, and it's no longer pulled in transitively, so the lane dies before running without it.
- **Local:** `bun run --filter @repo/web cap:sync` (build + sync), `cap:open` (Xcode), `ios:sim` (live-reload simulator).

## Conventions & Patterns

- **ZERO fake/hardcoded/placeholder data** (web + api). On unavailable data a tile shows a shimmer Skeleton and keeps retrying — never an invented number. A repo-wide grep for `FALLBACK`/`PLACEHOLDER` (uppercase identifiers) must stay empty. Two files are sanctioned exceptions: `apps/api/src/services/network-service.ts` and `apps/api/src/services/weather-service.ts` hold always-on `DEMO_*` data until real integrations land.
- **Pre-commit guard enforces the above.** `scripts/check-fake-data.sh` runs via lefthook on every commit — it exits non-zero if staged TS/TSX introduces `FALLBACK`/`PLACEHOLDER` identifiers or `DEMO_`/`demo_` outside the sanctioned files. Lowercase `fallback` as a parameter name and component names like `TilePlaceholder` are not flagged.
- **No-Ofelia guard.** `scripts/check-no-ofelia.sh` runs via lefthook on every commit — it blocks any staged file (ts/tsx/js/mjs/json/yml/md/sh/toml) that reintroduces `ofelia`/`mcuadros/ofelia`. Scheduling is bosun-native: declare cron tasks with `cronJob()`; the scheduler in `packages/bosun/src/scheduler.ts` runs each as a one-shot Swarm job (`docker service create --mode replicated-job`). The forbidden token is sanctioned only inside the guard script itself.
- **Gitleaks secret guard.** A `gitleaks` lefthook pre-commit hook (`gitleaks git --staged -c .gitleaks.toml`) BLOCKS any commit whose staged diff contains a secret (prefixed tokens, private keys, high-entropy strings). Config + allowlist live in `.gitleaks.toml` — it extends the default ruleset and narrowly allowlists git/image SHAs and `<port>/api/...` fragments that the noisy `generic-api-key` heuristic false-flags. Full history scans clean. All real secrets live in 1Password (`op://`); this keeps it that way, especially ahead of going public (www-4ma). Full-history audit: `gitleaks git . -c .gitleaks.toml`. Requires `gitleaks` on PATH (`brew install gitleaks`).
- **No-home-address guard.** `scripts/check-no-home-address.sh` runs via lefthook on every commit — it BLOCKS any staged file that reintroduces the private home-location name (any casing). The blocked pattern is base64-encoded inside the guard so the name is never written in cleartext anywhere in this public repo. The real home coords + place name live ONLY in 1Password (`HOME_*` env, item "Home Location"); the repo ships a public LA placeholder. Use `env.HOME_*` (api) or `apps/web/src/config/home.ts` (web), never a literal address. Full git history was rewritten to purge the address, and the repo was re-created public from clean history with no PR/pull/dolt refs (www-3zi / www-d3j).
- **Storybook docs guard.** `scripts/check-storybook-docs.sh` runs via lefthook pre-commit (staged `*.stories.tsx`) AND in CI's `test` job over all tracked stories (authoritative backstop, since pre-commit is `--no-verify`-bypassable; `deploy` needs `test`, so a missing doc blocks the deploy). It BLOCKS any story file that doesn't enable Storybook **autodocs** — either directly (`tags: ["autodocs"]`) or through a sanctioned meta factory that injects it (`defineTileMeta`; extend `FACTORY_NAMES` in the script for new factories). Keeps every component's Docs page present. Hermetic tests in `scripts/test-check-storybook-docs.sh` cover the pass (direct/factory) + fail (missing) matrix (www-o0ko).
- **Commit-msg guard enforces traceability.** `scripts/check-commit-msg.sh` runs via lefthook's `commit-msg` stage. The subject MUST be `type(area/www-xxx)[!]: desc` — a Conventional Commit (type ∈ feat|fix|chore|refactor|docs|test|ci|build|perf|style|revert) whose **scope carries a mandatory area AND the bd ticket id**, e.g. `feat(weather/www-m9k): add poller` or nested `fix(web/tiles/www-m9k): …`. The ticket id is the final scope segment and MUST live in the scope — a body-only `refs www-xxx` trailer no longer satisfies the check (it may additionally appear in the body). The scope ticket is validated as a **real** issue with one `bd show <id>`; if `bd` is offline/unavailable it warns and degrades gracefully rather than hard-blocking. Hermetic tests in `scripts/test-check-commit-msg.sh` (stub `bd` on PATH) cover the pass/reject matrix. EVERY change must ship with a commit naming an area and referencing a real bd ticket — no exceptions.
- **Test runner is `bun run test` (vitest).** NEVER run bare `bun test` — Bun's native runner is incompatible with `vi.mock` and produces false failures.
- Tiles use the shared `components/ui/` primitives — do not re-inline headers/stats/pills/skeletons. Primitives: `TileHeader`, `StatCell`, `Pill`, `Skeleton`, `TileWrapper` (barrel: `apps/web/src/components/ui/index.ts`).
- Imports at top of file only; no module-global mutable vars; comments explain WHY not HOW.
- Board is a fixed **1366×1024** wall panel (iPad Pro); the content grid is **1366×1000** (`BOARD_W`×`BOARD_H` in `grid-constants.ts`). Never design for fluid/responsive.
