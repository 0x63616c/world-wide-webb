# Track C Migration — Post-Mortem

**Date:** 2026-07-24
**Status:** Track C complete, deployed green. This is a retrospective, not a plan.

## 1. What Track C was, and how it ended

Track C folded every one of the 21 board tiles into a self-contained
`features/<id>/` App — manifest plus facets (`web.tsx`, `api.ts`, `jobs.ts`,
`schema.ts`) per ADR-0001/0002 — and shrank `apps/{api,worker,web}` down toward
thin, generic shells. The roadmap (`~/.claude/plans/merry-hugging-river.md`)
locked the end state on 2026-07-23: feature granularity is *domain*, not tile
(multi-tile Apps are normal — weather, events, tv, sound each hold more than one
tile); `apps/api` keeps only the tRPC host and app-level routers; `apps/worker`
becomes a generic runner over generated job specs; and three infra capabilities —
worker jobs, cron runs, and HTTP routes — get built as generic, codegen-collected
seams rather than hand-wired per tile.

**Outcome:** all 21 tiles are folded. The three seams (S1 worker-job, S2
cron-run, S3 http-route) and the multi-tile manifest contract (F0) are built and
in production use. The Biome `noRestrictedImports` boundary rule holds with zero
`features/* → apps/api/*` imports surviving. `apps/api` has shed its
`integrations/`, most of `services/`, `purge.ts`, and the hardcoded HTTP route
ladder. Every unit shipped its own green commit to `main` and deployed clean.

The work ran as roughly two work units per day of wall-clock effort across a
single 2026-07-23 session, executed by a manager-orchestrator model (§4) rather
than direct implementation.

## 2. Timeline of shipped units

All commits below are on `main`. Order matches execution order, not file order.

### Phase 0 — warm-up
- **W0 — fold `tile_wifi`** into `features/network/` — `7434656db`, fix
  `e2da340d5`. Second canary after the C7 guest-wifi fold (`8b2a81982`); zero
  pre-work needed since the UniFi client was already in `@www/core`.

### Phase 1 — foundation hoists (mechanical, no behavior change)
- **P1.1 — Home Assistant client** → `@www/core` — `da0be339e`. Highest-leverage
  hoist: unblocked 7 tiles (tesla, ac, ctrl, dogcam, tv, tvapps, weight-ingest).
- **P1.4 — `media-path`** → `@www/core` — `c4e39bc6b`. Pure, trivial; unblocked
  booth + wakes.
- **P1.2 — Sonos client** → `@www/core` — `e0c0bd2cc`. Unblocked sound,
  quickplay.
- **P1.3 — Spotify client** → `@www/core` — `a8e5b3676`. Unblocked quickplay.
- **P1.5 — device-state trio hoist** (command-window, device-state-mapping,
  integration-heartbeat) → `@www/core` — `e3ad65c6d`. Unblocked the
  ac/ctrl/sound enforcer cluster.
- **P1.6 — relocate `photo-path-migration`** to unweld the two photo tiles —
  `00d8ee043`.

### Wave 2 — self-contained folds
- **tesla** — `4c4cd22c5`
- **dogcam** — `dd32ef393`
- **weight** — `69d293a88`
- **deploys** — `cd9fe76e2`

### Infra wave — the 3 seams + multi-tile contract
- **S1 — generic worker-job seam** over `@www/core` + `jobs.gen.ts` — `02c6f68dd`.
  First consumer: **notif**, folded onto the seam — `61e71daae`.
- **F0 — multi-tile manifest support** (N tiles per App, `home` moved to tile
  level) — `a107c5daa`.
- **S2 — generic cron-run seam** over `crons.gen.ts` + `cron.js` dispatch —
  `5d5c13255`. First consumer: guest-wifi's portal purge migrated onto it —
  `0c1375426`.
- **S3 — generic HTTP-route seam** over an app-kit facet + `http.gen.ts` —
  `1c2dd4757`. First consumer: booth + wake photo uploads —
  `47fd0da35`.
- **app-kit CI fix** — wired `app-kit/*.test.ts` into the vitest CI projects
  (previously dark in CI) — `d1b0a1cf0`.

### Wave — first multi-tile fold + CI repair
- **weather** — two-tile `features/weather` (weath + hourly) — `4be52f800`.
  First real consumer of the F0 multi-tile contract; tripped a latent
  `collect.ts` bug (§3).
- **CI repair** following the weather push — `63cd93e1f`.

### Cluster wave — device-state + calendar
- **calendar** (event + clock) → `features/events` — `2bf359ea4`.
- **ac/climate** → features — `ffbdb485a`, fix for a shared-tree import-repoint
  clobber — `65c6985be`.
- **ctrl/controls** → features — `7f073994c`, plus a collect-test fixture
  update — `b1b21f2a9`.
- **felogs** → `features/felogs` — `77df849a4`, plus a story-coverage guard fix
  — `a736f05be`.
- **wakes** (tile + `interaction-session` service) → `features/wakes` —
  `abf934233`.

### Media split
- **tv + tvapps** → `features/tv` — `6bfb2e46b`.
- **sound + quickplay** → `features/sound` — `80fedb7b8`, plus a collect-test
  fixture update — `4ff128774`.

### Final tile + shell cleanup
- **booth** — the last tile — `f6d1ad39b`.
- **shell-cleanup**: deleted the dead UniFi re-export barrel and the now-empty
  `apps/api/src/config/` dir — `e0b9a1c6c`; migrated `github-purge` onto the S2
  cron seam and deleted `apps/api/src/purge.ts` — `d271be2d8`.

## 3. Technical learnings

**F0 left a latent multi-tile dedup bug that only the first real consumer
tripped.** `collect.ts` deduped registry leftovers by comparing *App* ids
against the *tile*-id set, which happened to work as long as every folded
feature was single-tile (App id == tile id). F0 wired multi-tile render and
validation but not this dedup path. Weather — the first two-tile fold — hit a
duplicate-tile-id throw. The fix was to dedup against the union of each
feature's tile ids (`featureApps.flatMap(a => a.tiles.map(t => t.id))`), which
then unblocked every subsequent multi-tile fold (events, tv, sound) for free.
The general lesson: a contract-widening unit (F0) can pass its own tests while
leaving a bug that only the first *consumer* of the new contract exercises —
independent plan review caught this before implementation, not after a broken
deploy.

**Guard-test and Storybook globs assumed `apps/web/src/components/**`.** The
registry-guard story-coverage test and the tile-title-sync view-source test, plus
Storybook's `main.ts` glob, only scanned that one tree. Weather was the first
feature with views living under `features/*/web/**`, so all three needed the
glob widened. Fixed once in the weather unit; every subsequent
feature-web-subtree fold inherited the fix for free.

**`ha` (the Home Assistant client) is an env-bound `apps/api` singleton, not a
pure module — a straight `@www/core` re-export doesn't work for it.** Unlike
UniFi, which had no env/db binding and hoisted as a clean client factory, HA
needed a `deps.ts`-style pattern: the core-level client factory takes its
config as an argument, and each call site that previously used the bound
singleton now constructs or injects it explicitly. This shape recurred for the
device-state trio (P1.5) and the worker-job seam (S1), where `@www/core` has no
`db` singleton either — feature-level `jobs.ts`/services take a bound `db` or
store as a parameter rather than reaching for a module-level instance, to avoid
a `core → apps/api` import cycle.

**`git add <explicit-paths>` can silently abort partway through the list** if
one of the paths was already `git rm`'d earlier in the same working tree
(pathspec mismatch) — the commit then lands empty or partial with no error
surfaced to the caller. This recurred across multiple implementers before the
standing fix became doctrine: always run `git show --stat HEAD` after
committing to confirm the full expected fileset and insertion counts landed
before pushing.

**Peers broke `main` mid-fold at least once.** A concurrent commit
(`100fa3f7e`) removed the `drizzle/` workspace without regenerating `bun.lock`,
leaving every job's frozen-lockfile install red, and left stale
`COPY drizzle/package.json` lines in three Dockerfiles. The weather implementer
fixed forward to unblock everyone's deploys. Standing pattern: any workspace
removal must be paired with a lockfile regen and a sweep for now-stale
Dockerfile `COPY` lines in the same commit.

**S1's biggest technical risk was a TypeScript declaration-merge across
separate tsconfig programs** (extending the closed `JobType` union so worker
handlers stay open/extensible without losing the compile-fail-on-typo
guarantee). It was spiked against the real codebase before the plan was
finalized, not designed in the abstract — the spike confirmed the
declaration-merged registry approach compiles cleanly across both the
`apps/worker` and `apps/api` tsconfig programs, and that shape shipped as
written.

**S2 has one intentional divergence worth remembering**: `infra/src/crons.ts`
iterates a *data file*, not `GENERATED_CRONS` directly, because the k8s
CronJob resources it produces need to go through Pulumi/ESO for the shared
secret they're gated behind — a heavier path than the in-process worker/cron
dispatch that S1/S2's runtime consumers use.

**The seam pattern, now proven three times (S1/S2/S3):** a branded facet
(`defineJobs`/`defineCron`/http facet) declared in a feature's `jobs.ts` or
`http.ts` → collected by `scripts/apps-gen/collect.ts` → emitted to a checked-in
`features/_generated/*.gen.ts` → consumed by a generic runtime iterator
(`GENERATED_JOBS` folded into the worker's `JOBS[]`, `GENERATED_CRONS` mapped by
`infra/src/crons.ts`, the http route table iterated by `server.ts`). No
per-feature hand-wiring survives once a feature migrates onto a seam.

**Interval-cycle workers were correctly scoped out of Track C.** S1 generalizes
only the durable job queue (`enqueueJob`/`claimOne`); the enforcers, the 15s
weight-ingest, the 5m weather-ingest, and similar polling loops are `Worker`
intervals, not queue jobs, and k8s CronJob's 1-minute minimum granularity rules
out S2 for anything sub-minute. These stay hand-wired in `apps/worker` importing
`@features/*` (an allowed import direction) — this is a deliberate, permanent
interim, not a gap (see §5).

## 4. Process retrospective — the manager-orchestrator model

Track C ran on a manager-orchestrator pattern: the manager agent did no code
work itself. Every unit — each hoist, each seam, each tile fold — was delegated
through a four-role cascade of **distinct, freshly-spawned agents**, never
reused across roles or across units: a **planner** wrote the unit's plan, a
**plan-reviewer** adversarially checked it against the roadmap's locked
invariants and the accumulating gotchas list, a **plan-fixer** applied the
review findings, and an **implementer** executed the final plan and ran the
full verify chain (typecheck, tests, `apps:check`, knip, lint, commit, push,
watch CI to green). The manager passed receipts between roles, not file
content, and reset its own context between wave boundaries via `/handoff`.
Same-shaped units (e.g. the cluster-wave tile folds) were batched through
Workflows so their receipts stayed out of the manager's running context
entirely.

**What worked:**
- **Independent plan review caught real blockers before implementation, not
  after a broken deploy.** The weather `collect.ts` multi-tile dedup bug (§3),
  S1's compile-red risk around the `JobType` declaration merge, and a secret
  trap in the shell-cleanup unit were all flagged by a plan-reviewer that had
  no stake in the plan it was reading, before an implementer ever touched code.
- **Workflows kept the manager's context small** across large batches of
  same-shaped units (the cluster-wave folds in particular), letting a single
  manager session drive the whole migration without itself accumulating
  file-content noise.
- **Rolling-pipeline parallelism.** Plan and review steps are read-only, so
  later units' cascades ran concurrently with an earlier unit holding `main`;
  only the push step needed to serialize, because checked-in codegen
  (`_generated/*.gen.ts`) races on merge regardless of whether units are on
  worktrees or the shared checkout.

**What was friction:**
- **Silent-idle subagents.** Several implementers (p14, s1, s2, s3 implementers,
  s2-verifier) finished their actual work but reported back with only an idle
  ping and no receipt. This cost extra dedicated verifier-agent dispatches to
  confirm the work had actually landed, and pushed the manager toward reading
  files/git output directly more than the receipts-not-content design intended.
  The standing fix: treat implementer-idle-without-receipt as a trigger to spawn
  a fresh read-only verifier immediately, and fold verification into the next
  unit's step zero where the dependency chain allows it (this is how S2's
  review doubled as S3's verifier).
- **Red-initial-commit-then-fix-forward churn** on some Sonnet-tier
  implementers — an initial commit landing broken, followed by a fix-forward
  commit, rather than the verify chain catching the break before push.
- **Model-tiering needed a mid-project correction.** The cascade settled on
  Opus for planning and review (judgment-heavy) and Sonnet for implementation
  (executing an already-vetted plan), with the full four-distinct-role cascade
  reserved for novel or high-blast-radius units (seams, F0, the device-state
  cluster); trivial reviews with zero blocker/major findings folded the fixer
  role into the implementer's step zero instead of spawning a fourth agent.

## 5. Deferred follow-ups

Explicitly out of scope for Track C, carried forward as separate work:

- **Device-ownership hoist.** `config/lights` and `ownerOf()`/`DeviceOwner` still
  live in `apps/api`, deferred from P1.5. Moving them to `@www/core` unblocks a
  future enforcer extraction out of `apps/worker`.
- **Interval-cycle seam.** The six hand-wired interval workers (weight-ingest,
  github-poll, weather-ingest, playlist-poller, and three device-state
  enforcers) are the one remaining un-generic corner. Decide post-Track-C
  whether they get a fourth generic facet seam like S1/S2/S3, or stay hand-wired
  permanently — the roadmap explicitly left this as an open decision, not a gap
  to close reflexively.
- **`queryWithCache` 500 on booth/wakes photo lists.** Confirmed pre-existing —
  not a regression introduced by either fold.
- **CI hardening.** Shard `test-storybook` before more story-adding work pushes
  it further past its ~15-minute ceiling (it already bit one fold's CI run);
  clean up the 13 pre-existing lint errors on `main` that predate Track C and
  that every implementer was re-confirming as "not mine," burning tokens on
  each recheck.
- **Type-safety sweep (Calum priority).** A dedicated audit of `@ts-ignore`/
  `@ts-expect-error` (especially ones masking real type holes — one was caught
  live during Track C when a peer's change turned a masked hole into a red
  test), `any`/implicit-any/unsafe casts, non-null `!` assertions covering real
  nullability, and untyped exported function boundaries. Planned as a
  grep-inventory-then-fan-out Workflow, feeding back into
  `docs/writing-scalable-typescript`.
- **Secrets cleanup.** Dedupe and curate the now-large `secret/vault.yaml`,
  post-migration (tracked separately, not blocked on anything above).
