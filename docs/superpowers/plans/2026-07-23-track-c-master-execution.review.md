# Review — Track C Master Execution Plan

**Artifact reviewed:** `docs/superpowers/plans/2026-07-23-track-c-master-execution.md`
**Reviewer:** independent (did not author the plan). Verified every factual claim
against the real code, not the plan's assertions.

## Verdict: APPROVE-WITH-FIXES

The plan's spine is sound: wave ordering respects the hard-blocker-hoist-first
rule, the Biome `features/* → apps/api` boundary is honored, all 18 remaining
tiles are accounted for with none dropped, and the P1.1 HA hoist is genuinely
done and deployed. The file-path and line-number claims are accurate to the
letter (server.ts route ladder, tile-registry contents, the closed `JobType`
union, collect.ts's cron-only collection). **The F0 multi-tile claim is
confirmed TRUE** — `AppManifest.tile` is singular and the validator models one
tile per app.

But the plan carries one structural defect that would misdirect several units if
executed literally, plus a manifest-design gap that Wave 7 depends on. Both are
fixable in the master doc without reworking the wave structure. Fix the two
BLOCKERs and the MAJORs, then proceed.

---

## Findings

### 1. [BLOCKER] The plan conflates interval reconcile/poll cycles with the S1 queue-job seam

This is the most important finding. **S1 generalizes the durable job queue only**
(`enqueueJob`/`claimOne`/`JOBS[]` in `apps/api/src/jobs/queue.ts`). The only true
queue jobs are `notify` and `youtube_ingest` (`JobType` union, queue.ts:33).

Everything else in `apps/worker/src/index.ts` is a `Worker` **interval** entry,
not a job:
- `light-enforcer`/`climate-enforcer`/`sonos-volume-enforcer`/`device-sync` — 1s intervals (index.ts:83-118)
- `weather-ingest` — 5m interval (index.ts:129)
- `weight-ingest` — 15s interval (index.ts:134)
- `github-actions-poll` — 10s interval (index.ts:143)
- `asc-version-poll`, `party-mode`, `playlist-poller` — intervals (index.ts:120-177)

Yet the plan repeatedly routes these through S1:
- Wave 2 T-weight: "keep it hand-wired (interim) **until S1**" — weight-ingest is a 15s interval, S1 will never absorb it.
- Wave 2 T-deploys: "keep the poll cycle hand-wired **until S1**" — github-poll is a 10s interval.
- Wave 6 F-sound: "`playlist-poller-service` (**→ `jobs.ts` via S1**)" — playlist-poller is a 2m interval that *produces* youtube_ingest jobs; it cannot itself be a job.
- Wave 7 F-weather: "`weather-ingest-service` (**→ `jobs.ts` via S1**)" — 5m interval.

An implementer told "weather-ingest → jobs.ts via S1" would try to convert a
periodic producer into a durable job — wrong architecture, wasted work. The
roadmap only ever specified **3 seams (job/cron/http)** and explicitly left
interval cycles to interim hand-wiring ("Whether worker cycles/crons ultimately
live inside each feature vs a shared runtime is settled by S1/S2 design; interim
hand-wiring is acceptable per step"). The plan already applies that correct
mechanism for the **enforcers** (F-devstate placeholder: "stay hand-wired in
apps/worker importing @features/*").

**Fix:** Apply the enforcer treatment uniformly. Add a short "Interval cycles are
not a seam" note to the master doc stating: reconcile/poll interval cycles
(enforcers, weight-ingest, github-poll, weather-ingest, playlist-poller,
asc-poll, party, device-sync) stay hand-wired in `apps/worker` importing
`@features/*` (allowed direction) — permanently, or until a future 4th
interval-worker facet that is explicitly **out of Track C scope**. Then scrub
every "→ jobs.ts via S1" / "until S1" that actually refers to an interval and
relabel it "interim hand-wired interval cycle." Only `notify` (Wave 3) is a real
S1 consumer.

### 2. [BLOCKER] F0 must move `home` from app-level to tile-level, and this is coupled to F-calendar

Today `home?: boolean` lives on `AppManifest` (per-app, define-app.ts:21) and the
validator counts `a.home` per app (validate.ts:87,97). The home tile is
`tile_clock`, and the roadmap folds **clock + event into ONE multi-tile
`features/events`** (Wave 7 F-calendar). So the home-owning tile lands inside a
multi-tile feature. If F0 keeps `home` app-level, a two-tile events feature can't
say "the clock tile is home, the event tile is not," and the validator's "exactly
one home" check operates at the wrong granularity.

The plan's F0 says "=1 `home` tile + no-overlap checks iterate all tiles" but
never states that `home` must become a per-**tile** field (on `TileSpec`), nor
that F-calendar is the reason. It's a latent Wave-7 breakage.

**Fix:** Add to F0's scope: move `home` onto `TileSpec` (per tile), keep the
"exactly one home across all tiles of all apps" invariant in validate.ts, and
update `manifestToEntry` in tile-registry.ts (which currently reads `m.home` at
line 292). Note the F0→F-calendar coupling explicitly.

### 3. [MAJOR] S1 must reconcile two different `JobSpec` shapes — the plan misses this

There are two unrelated `JobSpec` types with the same name:
- app-kit `JobSpec = { name: string; run: () => Promise<void> }` (define-facets.ts:10) — what `defineJobs` brands.
- worker `JobSpec = { type; handler; maxMs }` (apps/api/src/jobs/job-worker.ts:20) — what `JOBS[]` needs to register a claimer.

S1's step (b/c/d) — "collect `JOBS_FACET_BRAND`, emit `jobs.gen.ts`, fold into
`JOBS[]`" — cannot work as written: the feature facet shape `{name, run}` carries
neither a `JobType` discriminant nor a `maxMs`, both of which
`claimOne(type, handler, maxMs)` and the reaper require. The generated handler
also needs to become a `JobHandler<T>(payload, signal)`, not a bare
`() => Promise<void>`.

**Fix:** Add to S1's scope an explicit reconciliation: extend the app-kit
`JobSpec` facet to `{ type, handler(payload, signal), maxMs }` (or a documented
mapping), so a collected facet has everything `JOBS[]` needs. Flag that
`defineJobs`/app-kit `JobSpec` will change shape — its only current consumers are
`app-kit/define-app.test.ts` and the `app-kit/index.ts` re-export, so the blast
radius is tiny.

### 4. [MAJOR] The "20 single-tile call sites" framing in F0 is inaccurate — the diff is smaller

F0's placeholder says "pick the smaller diff against 20 sites." But
`AppManifest.tile` is consumed by only three places: `manifestToEntry` in
tile-registry.ts (web), collect.ts's feature loop (line 114-121), and the
validate.ts model. The 18 registry tiles are a *separate* type
(`TileRegistryEntry` in `REGISTRY_ENTRIES`), not `AppManifest`. Only the **two**
already-folded manifests (network, guest-wifi) use `AppManifest.tile` today.

**Fix / resolve placeholder 1:** There is no 20-site cost. Normalize to a single
`tiles: TileSpec[]` (drop the singular `tile`), update the two existing manifests
plus the three consumers. Because F0 lands in Wave 1 before any further fold,
future folds author `tiles[]` from the start. Recommend `tiles[]`, not
`tile`+`tiles` coexistence — coexistence permanently doubles the codegen paths
for no benefit.

### 5. [MINOR] Resolve placeholder 2 (S1 package home) — @www/core, but flag the job-table move

`queue.ts` imports `db` + the `job` table from `apps/api/src/db`. Moving
`enqueueJob`/`JobType` to `@www/core` (the device_state precedent) requires the
`job` **table** to follow into core's schema too — that's the real work, not just
the functions. This is viable (core already owns device_state end-to-end) and
avoids a new package. **Resolution:** `@www/core`, and call out the `job`-table
relocation as part of S1's scope so it isn't discovered mid-implementation.

### 6. [MINOR] Resolve placeholder 4 (S3 raw-body signature) — confirmed from code

Verified server.ts:168 and :225: wake/booth POST routes read `req.arrayBuffer()`
raw bytes and return streamed `Response` bodies (camera-stream pipes
`upstream.body` verbatim). **Resolution:** the http facet signature must be
`(req: Request, url: URL) => Promise<Response>` — mirror the existing `handle()`
shape exactly, no JSON/tRPC ctx. This placeholder can be closed now.

### 7. [MINOR] Resolve placeholder 5 (integration_sync_status) — follow device_state into core

P1.5's `integration-heartbeat` needs db + the `integration_sync_status` table.
The device_state precedent (core owns the table + a store interface + pg/memory
adapters) is the established pattern. **Resolution:** move the table into
`@www/core` behind a store interface, mirroring device_state. This keeps
`features/*` off `apps/api` schema and matches the locked roadmap decision that
the device-state store "stays in `@www/core` behind its store interface."

### 8. [MINOR] Resolve placeholder 3 (enforcer cycles vs S1) — confirmed correctly open

Verified: enforcers are 1s `Worker` intervals (index.ts:83-118), not queue jobs.
The placeholder correctly identifies this. Folds as: interim hand-wire in
apps/worker importing `@features/*` (allowed direction). This is the same
resolution as finding #1 and should be stated once, uniformly, then referenced.
(k8s CronJob min-granularity is 1 minute, so 1s/15s cycles cannot become S2 crons
either — worth a one-line note so nobody tries.)

### 9. [MINOR] `crons.gen.ts` no-runtime-consumer and `JOBS_FACET_BRAND`-not-collected claims — both confirmed TRUE

`crons.gen.ts` is only *written* by `scripts/apps-gen.ts` and drift-checked by
`scripts/apps-check.ts`; nothing consumes it at runtime — the S2 gap is real.
`JOBS_FACET_BRAND` is referenced only inside app-kit itself and its test;
`collect.ts` collects `CRON_BRAND` but not `JOBS_FACET_BRAND` — the S1 gap is
real. No fix needed; recording that the plan's premises here hold.

---

## Cross-checks that PASSED (recorded so they aren't re-verified)

- **18 tiles** in tile-registry.ts, exactly matching the plan's list; `tile_wifi`
  + `tile_guestwifi` are folded (`FEATURE_MANIFESTS`, line 276). None dropped.
- **All 18 accounted across waves:** W2 tesla/dogcam/weight/deploys; W3 notif;
  W5 booth/wakes; W6 tv/tvapps/sound/quickplay; W7 event/clock/weath/hourly/
  felogs/ac/ctrl = 18.
- **server.ts route ladder line numbers** all exact: /up:106, /health/climate:115,
  /media/tv-artwork:122, /media/camera-stream:143, wake-photo POST:168,
  wake-photos/*:197, booth-photo POST:225, booth-photos/*:275, /trpc:291.
- **`features/network`** holds the full facet set; `apps/api/.../routers/network.ts`
  is gone. W0 correctly marked done.
- **P1.5/P1.4/P1.2-3 file references exist:** command-window.ts,
  device-state-mapping.ts, integration-heartbeat.ts, media-path.ts,
  photo-path-migration.ts; integrations/{homeassistant,sonos,spotify}.
- **`photo-path-migration` welds booth+wake** — confirmed: server.ts imports both
  service families and calls `migratePhotoPaths` at boot; P1.6's unweld is real.
- **Biome allowed direction** (apps/api/worker MAY import @features) — correct;
  camera-stream staying in server.ts after T-dogcam folds camera-service is
  legal, as the plan states.
- **F-devstate sonos-volume-enforcer ownership** placeholder correctly flags it
  belongs to `features/sound`, not a separate device-state feature.

## Wave-ordering verdict

Ordering holds. F0 precedes all multi-tile folds (W6/W7). S1 precedes its only
real consumer notif (both W3). S2 (W4) precedes the purge-bearing folds (W5+).
S3 (W5) precedes booth/wakes/dogcam-stream folds (W5). Foundation units touching
`packages/core/src/index.ts` are flagged to serialize merges. No unit is
scheduled before its hard blocker once findings #1 and #3 correct the *scope* of
S1 (the ordering itself doesn't change).
