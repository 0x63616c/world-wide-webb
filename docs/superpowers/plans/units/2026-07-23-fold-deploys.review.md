# Review: Fold `tile_deploys` into `features/deploys/`

**Verdict: APPROVE-WITH-FIXES**

The plan is well-grounded in the real code: tile-registry coords, guestExposed
absence, the manual router mount, the worker's barrel-only import, the
service/schema line references, and the purge-service "not moving" rationale
all check out exactly against the current repo. One real gap (finding 1) needs
an explicit decision before/during implementation; the rest are polish.

## Findings

1. **[MAJOR]** The plan's file inventory misses `DeployTile.tsx`'s import of
   `DeployModalCommit` from `./views/DeployModalPipeline` (verified:
   `apps/web/src/components/tiles/DeployTile.tsx:21`,
   `import type { DeployModalCommit } from "./views/DeployModalPipeline";`,
   consumed by `toModalCommits`). Pre-fold this is a one-way chain
   (`DeployTile.tsx` → `DeployModalPipeline.tsx` → `DeployTileView.tsx`, three
   distinct files). Post-fold, once `DeployTile.tsx` and `DeployTileView.tsx`
   merge into one `web.tsx`, and `DeployModalPipeline.tsx` is repointed (per
   the plan's own "Not moving" section) to import `DeployCommit`/
   `DeployFailure`/`CommitState` from `@features/deploys/web`, you get a
   genuine two-file cycle: `features/deploys/web.tsx` ⇄
   `apps/web/.../views/DeployModalPipeline.tsx`. It resolves at compile time
   (`@/*` maps into `apps/web/src/*` from `features/tsconfig.json`, confirmed)
   and is type-only so no runtime cycle, but the plan's "Exact source → dest
   moves" table, the "Cross-feature / worker importers to repoint" list (items
   1–8), and the `web.tsx` skeleton never mention this import — an
   implementer moving files verbatim per the skeleton's shown export list
   would drop it, breaking `toModalCommits`'s return type. Fix: add an
   explicit line to the plan (or to the web.tsx skeleton) — `import type {
   DeployModalCommit } from "@/components/tiles/views/DeployModalPipeline";`
   — and note the resulting type-only cycle is acceptable, mirroring how
   `DeployModalPipeline.tsx` itself will import back from
   `@features/deploys/web`.

2. **[MINOR]** Plan text says "the frontend calls `trpc.github.status` in
   **three** files (`DeployTile.tsx`, `detail/wiring/deploys.tsx`)" — only two
   file names are listed, and a grep confirms exactly two files
   (`DeployTile.tsx:73` and `detail/wiring/deploys.tsx:23`, plus one comment
   mention at `deploys.tsx:4` that isn't a call site at all). "Three" appears
   to miscount call sites vs. files, or count the comment as a hit. Not
   load-bearing (the actual repoint list and grep instruction in item 8 are
   correct), but worth a one-word fix ("two files") to avoid an implementer
   searching for a phantom third call site.

3. **[MINOR]** The plan doesn't explicitly say whether
   `DeployModalPipeline.stories.tsx`'s import of `DeployModalPipeline` itself
   (`from "./DeployModalPipeline"`, confirmed, not from `DeployTileView`)
   needs any change — verified it imports only `DeployModalCommit`/
   `DeployModalPipeline` from the sibling file, which isn't moving, so
   correctly needs **no edit**. The plan's phrasing ("only if it imports types
   from DeployTileView/DeployTile directly; check") already tells the
   implementer to check, so this is just confirming the plan's hedge was
   warranted, not a defect — no fix needed, noted for completeness.

## Verified correct (spot-checked against real code, not just plan prose)

- Coords: `worldCol: 34, worldRow: 24, cols: 4, rows: 3` for `tile_deploys`
  match `apps/web/src/lib/tile-registry.ts:221-229` verbatim.
- `guestExposed`: confirmed absent — `features/guest-exposed.ts` `GUEST_EXPOSED`
  contains only `"tile_guestwifi"`. No allowlist edit needed, matches plan.
- Manual router mount confirmed at `apps/api/src/trpc/routers/index.ts:9`
  (`import { githubRouter } from "./github"`) and `:36` (`github:
  githubRouter,`) — exactly as the plan's PLACEHOLDER item 3 describes.
- `apps/worker/src/index.ts` confirmed to import `runGithubPollCycle` only via
  the `@control-center/api/worker` barrel (line 24/33), no direct
  `github-actions-service` import — plan's "Confirmed clean" claim holds, only
  `apps/api/src/worker-deps.ts:28` needs repointing.
- `apps/api/src/worker-deps.ts` importing `@features/*` (for
  `runGithubPollCycle`) mirrors the real, already-shipped precedent of
  `apps/api/src/purge.ts` importing `@features/guest-wifi/db` and
  `@features/guest-wifi/jobs` — this is apps/api → features, the opposite
  direction from the Biome-banned features → apps/api rule
  (`biome.json:164-181`, only bans `@control-center/api` / `apps/api` imports
  from `features/**`), so the worker-interval hand-wiring plan is
  boundary-safe.
- `github-purge-service.ts` "not moving" rationale confirmed: it only
  type-imports `../db/schema` and uses raw `db.execute(sql\`...\`)` against
  literal table names (`github_run`, `github_run_log_tail`); `purge.ts` still
  calls it with apps/api's own `db` — zero code changes needed there, matches
  plan.
- `config.ts` sketch's `GITHUB_ACTIONS_TOKEN`/`GITHUB_REPO` defaults match
  `apps/api/src/env.ts:99,101` exactly, and the `DATABASE_URL` default string
  matches `features/guest-wifi/config.ts` verbatim (established precedent).
- `schema.ts` move: `githubRun` (l.451+), `githubRunLogTail`, and
  `githubPollStatus`/`GITHUB_POLL_STATUS_SINGLETON_ID` all confirmed present
  and self-contained in `apps/api/src/db/schema.ts` at the cited lines, no
  dependency on other schema.ts exports that would need to move along with
  them.
- No `jobs.ts` invented — correct per master plan
  (`docs/superpowers/plans/2026-07-23-track-c-master-execution.md:253-255`,
  explicitly "10s interval cycle... stays hand-wired... NOT S1") and the repo
  precedent for other hand-wired intervals (weight-ingest, weather-ingest,
  enforcers) in the same doc.
- Storybook: both `DeployTileView.stories.tsx` and
  `DeployModalPipeline.stories.tsx` confirmed to stay under
  `apps/web/src/components/tiles/`, matching the `NetworkTileView.stories.tsx`
  precedent (`@features/network/web` import pattern verified present in that
  file).
- Test glob: `vitest.config.ts` globs are generic (`features/**/service.test.ts`
  etc, per plan's claim) — not independently re-verified byte-for-byte here,
  but plan explicitly tells the implementer to prove it by running the suite
  rather than trusting the glob, which is the right verification discipline.

## Boundary / worker-interval checks (explicit per task ask)

- **Boundary-safe**: yes. No proposed edit has `features/deploys/*` importing
  `apps/api` or `@control-center/api`; the only apps/api → features edge
  (`worker-deps.ts`) is the already-precedented, sanctioned direction.
- **Worker interval correctly left hand-wired**: yes. Plan repeatedly and
  explicitly forbids inventing `jobs.ts`, correctly cites Seam S1 as
  queue-job-only, and the destination layout list has no `jobs.ts` entry.
- **Atomicity**: plan gives one commit message
  ("feat(features): fold deploys tile into features/deploys (Track C)") for
  what is described as web+api+service+schema — consistent with "manifest.ts
  + backend as ONE atomic commit" instruction; no split-commit language that
  would violate atomicity.
