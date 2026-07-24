# Plan review: Fold media cluster → features/tv + features/sound (Wave 6)

**Verdict: APPROVE-WITH-FIXES.**

The plan is correct and buildable as written. All load-bearing prerequisites are
present in the tree (S1 job seam, `@www/core` client/store hoists, HaError export,
multi-tile manifest precedent), the router split is clean by client with no shared
proc/type crossing the boundary, and the two-commit progressive-empty structure is
each-commit green. The findings below are clarifications and one substantive
recommendation on the youtube-ingest handler home; none is a hard blocker.

Counts: **0 BLOCKER / 1 MAJOR / 4 MINOR.**

---

## Findings

### 1. [MAJOR] Confirm PLACEHOLDER-2 as **Option B** (keep `runYoutubeIngest` hand-wired in apps/api) — Option A would regress the env-gated "park, don't burn" behavior

The plan's own default (line 528-533) is Option B, and it is the correct call — the
task's Option-A framing (move the handler into a `features/sound/jobs.ts` `defineJobs`
facet) is *not* a clean mechanical drop-in and should be rejected for this unit.

Reason, verified against `apps/worker/src/index.ts:62-88`: `youtube_ingest` is
registered **conditionally** — `...(env.YOUTUBE_INGEST_ENABLED ? [ {type:
"youtube_ingest", maxMs, handler: <disk-guard wrapper around runYoutubeIngest>} ] :
[])`. The conditional registration is deliberate and documented in-code: "an
unregistered type is never claimed, so the queued backlog parks in place instead of
burning attempts against a YouTube block no retry can clear." A `defineJobs` facet is
collected **unconditionally** into `GENERATED_JOBS` (spread with no env gate, mirror
`features/notif/jobs.ts` which registers `notify` unconditionally). Folding
`youtube_ingest` into the seam therefore:
  - loses the env-gated registration → with ingest disabled (its current, IP-blocked
    state) the worker would register + claim the type again, defeating the park; and
  - orphans the `hasSufficientDisk(env.MEDIA_STORAGE_DIR)` disk-guard wrapper that
    lives at the worker entrypoint, not in the handler.

Making Option A safe needs the S1 seam to support env-gated / conditional job specs
plus a home for the disk guard — that is a distinct seam-extension unit, not part of a
mechanical fold. **Fix:** adopt Option B verbatim:
  - Keep `runYoutubeIngest` in `apps/api/src/services/youtube-ingest-service.ts`.
  - Repoint only its `import { mediaItem } from "../db/schema"` →
    `@features/sound/schema` (apps/api → @features is the allowed direction).
  - Its `import { db } from "../db/index"` and `import { env } from "../env"` **stay**
    (the handler remains an apps/api citizen; it does not adopt the feature's db/config).
  - **Do NOT delete** `apps/api/src/worker-deps.ts:40`
    (`export { runYoutubeIngest } from "./services/youtube-ingest-service"`) — the worker
    entry (`index.ts:29`) still imports it. The plan's blanket "delete worker-deps.ts
    re-exports" (line 385, 500) must be scoped to the **enforcer (`:38`) and poller
    (`:37`)** re-exports only; the `runYoutubeIngest` re-export at `:40` survives.
  - Move `youtube-ingest-service.test.ts` only if it stops resolving; otherwise repoint
    its schema import and leave it in `apps/api/src/__tests__/`.

This keeps Wave 6 bounded, preserves the intended disabled-state behavior, and leaves
the worker's `youtube_ingest` block untouched. The worker comment "`youtube_ingest`
stays hand-wired below until media folds (Wave 6)" is aspirational; honor it in a later
seam unit, not here.

### 2. [MINOR] `features/sound` needs a Spotify config slice; the moved service constructs the client from config, not env

`spotify-service.ts:34-40` lazily builds a singleton
`new SpotifyClient({ clientId: env.SPOTIFY_CLIENT_ID, clientSecret:
env.SPOTIFY_CLIENT_SECRET, refreshToken: env.SPOTIFY_REFRESH_TOKEN })`. `@www/core`
exports the `SpotifyClient` **class only** (no factory), taking
`SpotifyCredentials { clientId, clientSecret, refreshToken }`
(`packages/core/src/spotify/types.ts:7-9`). On the move into `features/sound/service.ts`
the three `env.SPOTIFY_*` reads must become `config.SPOTIFY_*` reads from
`features/sound/config.ts`. **Fix:** `features/sound/config.ts` must declare
`SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`
(`z.string().default("")`, matching `apps/api/src/env.ts` defaults, per the
`features/ac/config.ts` "same default so import never throws" rule). The singleton
Spotify client stays in `service.ts` reading `config`; it does **not** belong in
`deps.ts` (deps.ts is for the device_state stores). This resolves PLACEHOLDER-6.

### 3. [MINOR] State the `enqueueJob` → `@www/core` repoint as a REQUIRED implementer step for the poller

The plan states it (lines 331-332, 519-527) but it is the single boundary-critical edit
in the sound commit and must be called out as non-optional: `playlist-poller-service.ts`
→ `features/sound/poller.ts` **must** import `enqueueJob` from `@www/core` (S1 landed:
`packages/core/src/jobs/queue.ts` exports `enqueueJob`, `JobSpec`, `JobHandler`, and the
`JobTypeRegistry` augmentation interface). Importing it from `apps/api/src/jobs/queue`
is a `features/* → apps/api` Biome violation that fails the commit. Same applies to any
`JobHandler`/`JobType` type imports. IMPLEMENTER step 0's grep already guards this;
keep it.

### 4. [MINOR] Correct the web-closure file counts (47 total, not ~56)

Verified closure is **47 files**, split **TV 22 / SOUND 25**, with zero cross-side
imports and no shared file. Fix the three stale counts:
  - line 343 `**~34 files.**` → `**~25 files.**` (sound side)
  - line 345 `**~56 files**` → `**47 files**` (total)
  - line 221 `**~22 files.**` (tv side) is correct — leave it.

The narrative around each ("media-exclusive, no external importer except the 4 wiring
files, tile-registry.ts, and the two registry guard tests") is accurate.

### 5. [MINOR] deps.ts confirmation — the plan already handles the env-bound config correctly

Both features correctly follow the proven `features/ac` template: `config.ts` reads
the already-hydrated `process.env` and validates only its own keys; `deps.ts` builds
env-free `@www/core` clients/stores from that config slice
(`features/ac/deps.ts` builds `ha` + `deviceStateStore` this exact way). `HaError` is
exported from `@www/core` (`packages/core/src/homeassistant/index.ts:6`), so
`features/tv/service.ts` repoints `HaError` to core cleanly (resolves PLACEHOLDER-4).
No deps.ts gap. One confirm-item for the implementer: if `SonosClient` construction in
the moved sonos services reads any env/base-URL config, that key must also land in
`features/sound/config.ts` — the enforcer already imports `SonosClient` from
`@www/core`, so the client class is hoisted, but its per-feature config surface should
be verified during the move.

---

## Placeholder resolutions (all 6)

- **PLACEHOLDER-1 — `enqueueJob` in `@www/core`? YES (S1 landed).** `enqueueJob`,
  `JobSpec`, `JobHandler`, and the `JobTypeRegistry` module-augmentation surface are in
  `packages/core/src/jobs/queue.ts`; `features/notif/jobs.ts` already consumes the seam.
  The unit CAN land. Poller relocation must repoint `enqueueJob` to `@www/core`
  (Finding 3).

- **PLACEHOLDER-2 — youtube_ingest handler home → Option B (keep hand-wired in
  apps/api).** Move only its `mediaItem` import to `@features/sound/schema`; leave
  `db`/`env` imports and the worker's conditional `youtube_ingest` block +
  `worker-deps.ts:40` re-export intact. Option A (defineJobs facet) would
  unconditionally register the type and lose the env-gated park-don't-burn behavior +
  disk-guard wrapper — defer to a dedicated seam unit. See Finding 1.

- **PLACEHOLDER-3 — addUrls caller.** The only references to `addUrls` in the entire
  tree are the router definition (`media.ts:197`) and `apps/api/src/__tests__/
  media-adduris.test.ts`. **No web caller and no external caller exist.** Repointing the
  `media` → `sound` namespace fully covers it; the only client-side work is relocating
  `media-adduris.test.ts` into `features/sound`. No non-obvious caller. Fully covered.

- **PLACEHOLDER-4 — `HaError` from `@www/core`. Present.** Exported at
  `packages/core/src/homeassistant/index.ts:6`. `features/tv/service.ts` repoints cleanly.

- **PLACEHOLDER-5 — tile-registry union mechanism.** Established: hand-edit
  `apps/web/src/lib/tile-registry.ts` (add the manifest import line + a `FEATURE_MANIFESTS`
  array entry), mirroring the multi-tile weather/events precedent. Delete the 4 media
  registry entries + their 8 component imports in the same commit as each manifest is
  added.

- **PLACEHOLDER-6 — Spotify config surface.** The core `SpotifyClient` reads
  `clientId`/`clientSecret`/`refreshToken` (env keys `SPOTIFY_CLIENT_ID`,
  `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`). `features/sound/config.ts` must
  declare all three with the same defaults as `apps/api/src/env.ts`; the moved
  `spotify-service` constructs its singleton `SpotifyClient` from `config`, not `env`.
  See Finding 2.

---

## Commit structure — 2 commits confirmed safe (do NOT collapse to 1)

Each commit is independently green:
  - **Commit 1 (tv):** `media.ts` is emptied of the 10 tv procs but stays mounted as
    `media:` holding the 11 sound procs → sound web still calls `trpc.media.sonos*`,
    nothing breaks. `tile_tv`/`tile_tvapps` registry entries are deleted in the SAME
    commit the `tvManifest` supplies them → no duplicate tile id, no orphan. tv-artwork
    route + `getTvArtwork` import removed together → knip clean.
  - **Commit 2 (sound):** empties the rest, DELETES `media.ts`, removes `media:` from
    baseRouter, moves tables (deleting from apps/api schema.ts in the same commit → the
    dup-table validator stays happy). Each commit reruns the full verify chain incl. the
    load-bearing `placeholder-tiles` test (4 tiles removed at col18/22/26/30 reshapes the
    bento fill — the 1x1-clearance regression this test catches).

Keep 2 commits, not 1 atomic: smaller reviewable diffs, tv (table-free, HA-only) proves
the namespace+http-move mechanism at lower risk before the heavier sound half, and if
commit 2 stalls, commit 1 is already deployed with the board still rendering sound via
the surviving `media:` router. A single atomic commit would bundle ~47 file moves +
table moves + two interval relocations + router deletion into one un-bisectable change —
strictly worse.

**Ready to implement after applying Findings 1-4** (Finding 5 is a confirm-item, not a
blocker).
