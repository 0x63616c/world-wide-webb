# Track C — Master Execution Plan

> **For the manager agent:** This is a WAVE + UNIT orchestration plan, not a
> line-by-line code plan. Each unit is delegated through the 4-role cascade
> (below). Do NOT implement units yourself. Do NOT re-litigate the roadmap's
> locked decisions (`~/.claude/plans/merry-hugging-river.md`: domain granularity,
> 3 generic seams built JIT, hard-blocker hoists first).

**Goal:** Fold the remaining 18 board tiles into self-contained `features/<id>/`
Apps (ADR-0001/0002), emptying `apps/api/src/{integrations,services,routers,jobs}`
of tile code and reducing `apps/{api,worker,web}` to generic shells.

**Reference hoist:** P1.1 (Home Assistant → `@www/core`, commit `da0be339e`,
deployed green) is the mechanical pattern every foundation hoist mirrors.

**Reference fold:** `features/guest-wifi/` (full facet set + `jobs.ts` cron) and
`features/network/` (W0, commits `7434656db`, `e2da340d5`) are the two canaries
every fold mirrors.

---

## Ground truth verified this session (do not re-derive)

- **W0 / `tile_wifi` fold is DONE.** `features/network/` holds the full facet set
  (`api.ts` `manifest.ts` `service.ts` `web.tsx` + tests); `apps/api/src/trpc/routers/network.ts`
  is gone; `tile-registry.ts:276` collects `networkManifest`. Landed
  `7434656db` + fix `e2da340d5`. **Skip it.**
- **P1.1 HA hoist is DONE** (`da0be339e`), deployed green.
- **18 tiles remain in `apps/web/src/lib/tile-registry.ts`:** `tile_clock`,
  `tile_weight`, `tile_weath`, `tile_tesla`, `tile_hourly`, `tile_ctrl`,
  `tile_dogcam`, `tile_ac`, `tile_event`, `tile_tv`, `tile_sound`, `tile_tvapps`,
  `tile_quickplay`, `tile_wakes`, `tile_deploys`, `tile_notif`, `tile_felogs`,
  `tile_booth`. (`tile_guestwifi` + `tile_network` are already folded manifests.)
- **The facet brands already exist** in `app-kit/define-facets.ts`:
  `defineApi`/`API_FACET_BRAND`, `defineJobs`/`JOBS_FACET_BRAND` (with `JobSpec`),
  `defineCron`/`CRON_BRAND` (with `CronSpec {name, schedule, run}`).
- **`scripts/apps-gen/collect.ts` collects TODAY:** manifest (`APP_BRAND`), feature
  `schema.ts` tables, feature `api.ts` router (`api` export), and **crons from
  `jobs.ts` via `CRON_BRAND`** (emits `crons.gen.ts`). It does **NOT** yet collect
  `JOBS_FACET_BRAND`, and there is **no runtime consumer** of `crons.gen.ts`. This
  is exactly the S1/S2 gap.
- **`apps/api/src/jobs/queue.ts`:** `JobType` is a **closed union**
  `"notify" | "youtube_ingest"`; `enqueueJob`/`claimOne` live here.
- **`apps/worker/src/index.ts`:** hand-builds `JOBS[]` and imports every domain
  cycle from the `@control-center/api/worker` barrel (`apps/api/src/worker-deps.ts`).
- **`apps/api/src/server.ts`:** raw HTTP routes are a hardcoded `if (url.pathname …)`
  ladder (`/up` :106, `/health/climate` :115, `/media/tv-artwork` :122,
  `/media/camera-stream` :143, `/media/wake-photo` POST :168, `/media/wake-photos/*`
  :197, `/media/booth-photo` POST :225, `/media/booth-photos/*` :275, `/trpc` :291).
- **`AppManifest` (`app-kit/define-app.ts`) has `tile:` SINGULAR only.** Multi-tile
  features (weather, media, calendar) need a manifest-schema change first — see
  Unit **F0** below. This is the biggest gap between roadmap intent ("Tile(s)") and
  current code.

---

## The 4-role cascade contract (every unit runs through this)

Each unit is executed by **four DISTINCT fresh agents in sequence**, never reused
across roles or units (context-rot is the top concern — see memory
`manager-orchestrator-dev-model`):

1. **PLANNER** — reads this unit + the cited files, writes a task-level plan for
   the single unit (file moves, import repoints, facet wiring, tests to add/keep).
2. **PLAN-REVIEWER** — fresh agent, adversarially reviews the plan against the
   roadmap invariants, the gotchas list, and the verify chain. Flags gaps.
3. **PLAN-FIXER** — fresh agent, applies the reviewer's findings, producing the
   final plan.
4. **IMPLEMENTER** — fresh agent, executes the final plan, runs the full per-unit
   verify chain, commits + pushes, watches CI to green.

Manager passes receipts (not file content) between roles. At each **wave boundary**
run a `code-review` skill pass over the wave's commits before starting the next
wave. Use `/handoff` between waves to reset manager context.

---

## Per-unit verify chain (IMPLEMENTER runs ALL, in order)

```
bun run apps:gen                       # regenerate features/_generated/*.gen.ts
bun run typecheck
bunx vitest run <affected test paths>  # incl. apps/web placeholder-tiles test
bun run apps:check                     # codegen drift + validator
bun run knip                           # zero-tolerance, whole tree
bun run lint                           # Biome (dep-boundary rule included)
git pull --rebase --autostash          # parallel sessions push main
git add <explicit paths>               # NEVER git add -A / -A
git commit -m "…"                      # NO backticks in the message
git push
gh run watch <run-id> --exit-status    # FOREGROUND — do not yield to a monitor
# then confirm deploy green + pod image age (memory ci-cancelled-runs-strand-image-digests)
```

Backend + manifest land in ONE atomic commit: codegen only collects a facet when
`manifest.ts` exists, so a half-moved feature breaks `apps:check`.

---

## Known gotchas (inherit these into every unit's plan)

- `features/* → apps/api/*` is **Biome-banned** (`noRestrictedImports`). Hoists
  exist to break this; a fold cannot land while any such import survives. After
  each hoist, confirm the dep rule stays green.
- `apps/api` + `apps/worker` **MAY** import `@features/*` (allowed direction;
  guest-wifi's cron already does). So soft-blocker seams can be hand-wired interim.
- **Interval cycles are NOT a seam.** S1 generalizes the durable job queue ONLY
  (`enqueueJob`/`claimOne`/`JOBS[]`); the only true queue jobs are `notify` +
  `youtube_ingest` (`queue.ts:33`). Everything else in `apps/worker/src/index.ts`
  is a `Worker` **interval**, not a job: the enforcers (`light`/`climate`/
  `sonos-volume`/`device-sync`, 1s), `weight-ingest` (15s), `github-actions-poll`
  (10s), `weather-ingest` (5m), `playlist-poller` (2m, a *producer* of
  `youtube_ingest` jobs), `asc-version-poll`, `party-mode`. These stay hand-wired
  in `apps/worker` importing `@features/*` (allowed direction) — **permanently**,
  or until a future 4th interval-worker facet that is explicitly **out of Track C
  scope** (roadmap §Out-of-scope: interim hand-wiring is acceptable). NEVER route
  an interval through S1 (`→ jobs.ts via S1` is wrong for all of them). k8s CronJob
  min granularity is 1 minute, so 1s/15s/10s cycles cannot become S2 crons either.
  Only `notify` (Wave 3) is a real S1 consumer.
- `bun build` reads the **CWD** tsconfig `paths`, not the entry's — Docker api
  build must `cd apps/api` first (memory `bun-build-alias-needs-cwd-tsconfig`).
  Local typecheck/vitest pass even when this is wrong; it fails CI-only.
- **knip is zero-tolerance** and scans the working tree; a dead re-export shim left
  behind after a hoist turns pre-push red.
- Parallel Claude sessions push `main` (~8-10 concurrent). Always
  `git pull --rebase --autostash`; **never** `git add -A` (memory
  `never-git-add-all-shared-checkout`); lefthook format re-stages the whole tree
  (memory `lefthook-format-restages-whole-tree`) — stage explicit paths and
  `git show --stat HEAD` before push.
- No backticks in `git commit -m` (zsh command substitution).
- `CLAUDE.md` is a **symlink** to `AGENTS.md` — never `sed -i` it
  (memory `apps-layout-move-landed`).
- `drizzle db:generate` meta JSON must be `bunx biome format --write`'d before lint
  (memory `drizzle-generate-needs-biome-format`).
- Subagents die if they yield to a background CI monitor — IMPLEMENTER dispatch
  MUST mandate foreground `gh run watch --exit-status` (memory
  `subagent-background-wait-stalls`).

---

## Waves

Order = roadmap §"Suggested execution order" (leverage × risk). Units inside a
wave are same-shaped and independent unless a dependency is noted. Foundation
units that both touch `packages/core/src/index.ts` must **serialize their merges**
(shared-checkout race).

---

### Wave 0 — Warm-up  ✅ DONE

- **W0 · `tile_wifi` fold** — DONE (`7434656db`, `e2da340d5`). No action.

---

### Wave 1 — Foundation: hoists + manifest enabler

Mechanical, no behavior change. Mirrors P1.1. Each its own green commit. Unblocks
every later fold. **F0 must land before any multi-tile fold (Waves 6-7).**

- **F0 · Multi-tile manifest support** — roadmap "domain granularity / Tile(s)".
  - Goal: extend `AppManifest` so one feature can register N tiles.
  - **Shape (resolved):** normalize `AppManifest.tile: TileSpec` (singular,
    `define-app.ts:19`) to a single `tiles: TileSpec[]` — drop the singular field
    entirely; do NOT keep `tile` + `tiles` coexisting (permanently doubles the
    codegen paths for no benefit). There is **no 20-site cost**: `AppManifest.tile`
    has only three consumers — `manifestToEntry` (`tile-registry.ts:278`),
    `collect.ts`'s feature loop, and the `validate.ts` model — and only the **two**
    already-folded manifests (network, guest-wifi) author it today. The 18 registry
    tiles are a separate type (`TileRegistryEntry`), untouched. Because F0 lands in
    Wave 1, every later fold authors `tiles[]` from the start.
  - **Home must move to tile level (resolved):** `home?: boolean` today lives on
    `AppManifest` (per-app, `define-app.ts:21`) and `validate.ts` counts `a.home`
    per app (`validate.ts:87`). F-calendar (Wave 7) folds clock + event into ONE
    two-tile `features/events`, where only the clock tile is home — impossible if
    `home` stays app-level. Move `home` onto `TileSpec` (per tile), keep the
    "exactly one home across ALL tiles of ALL apps" invariant in `validate.ts`, and
    update `manifestToEntry` (reads `m.home` at `tile-registry.ts:292`) +
    `HOME_TILE` (`tile-registry.ts:303`). **F0 is coupled to F-calendar** — this is
    a latent Wave-7 breakage if skipped.
  - Files: `app-kit/define-app.ts` (`tiles: TileSpec[]`; move `home` onto
    `TileSpec`), `app-kit/define-app.test.ts`, `scripts/apps-gen/collect.ts` (emit
    each tile), `scripts/apps-gen/emit.ts`, `scripts/apps-gen/validate.ts` (=1
    `home` + no-overlap checks iterate all tiles of all apps),
    `apps/web/src/lib/tile-registry.ts` (`manifestToEntry` + `HOME_TILE`), the two
    existing manifests (network, guest-wifi).
  - Dep: none. Blocks: F-weather, F-media-tv, F-media-sound, F-calendar.
- **P1.2 · Hoist Sonos client** — `apps/api/src/integrations/sonos/` →
  `packages/core/src/sonos/`, export from `@www/core`; repoint sonos-*/media
  services. Unblocks sound, quickplay. Touches `packages/core/src/index.ts`.
- **P1.3 · Hoist Spotify client** — `apps/api/src/integrations/spotify/` →
  `@www/core`; repoint `spotify-service.ts`, playlist poller, quickplay. Unblocks
  quickplay. Touches `packages/core/src/index.ts`.
- **P1.4 · Hoist `media-path`** — `apps/api/src/services/media-path.ts` (+
  `media-path.test.ts`) → `@www/core` (pure `node:fs`+`node:path`). Trivial.
  Unblocks booth + wakes.
- **P1.5 · Finish device-state trio hoist** — `command-window.ts` (delete shim,
  already a core re-export), `device-state-mapping.ts`, `integration-heartbeat.ts`
  (needs db + `integration_sync_status` table) → `@www/core`. Unblocks ac/ctrl/
  sound enforcer cluster. Touches `packages/core/src/index.ts` + schema.
  - **Resolved:** `integration-heartbeat` needs db + the `integration_sync_status`
    table; move the table into `@www/core` behind a store interface, mirroring the
    device_state precedent (core owns the table + a store interface + pg/memory
    adapters). Keeps `features/*` off `apps/api` schema and matches the locked
    roadmap decision that the device-state store stays in `@www/core` behind its
    store interface.
- **P1.6 · Relocate `photo-path-migration`** —
  `apps/api/src/services/photo-path-migration.ts` (+ test) imports BOTH booth and
  wake services (welds the two photo tiles) and runs at startup. Move to an
  `apps/api` startup module that imports the two feature services (allowed
  direction), OR `packages/platform`. Unwelds booth from wakes.

**Wave-1 boundary review:** `code-review` over the hoist commits; explicit check
that no `features/* → apps/api` import exists and knip is clean.

---

### Wave 2 — Fold self-contained singles (unblocked by P1.1 + Wave 1)

Pure fold pattern: `tile → web.tsx`, `router → api.ts` (`defineApi`),
`service → service.ts`, `schema → schema.ts`, write `manifest.ts` (coords VERBATIM
from registry), delete the registry entry, `apps:gen`. No new seam needed. Fully
independent — parallelizable (serialize only the pushes).

- **T-tesla · fold `tile_tesla`** — `tesla-service.ts`, `routers/tesla.ts`; HA
  touch is via `@www/core` now (P1.1). No table.
- **T-dogcam · fold `tile_dogcam`** — `camera-service.ts`, `routers/camera.ts`; HA
  via core. NOTE camera-stream HTTP route (`server.ts:143`) stays hand-wired until
  S3 — fold the tile now, migrate the stream route in Wave 5.
- **T-weight · fold `tile_weight`** — `weight-service.ts`, `weight-domain.ts`,
  `weight-sql.ts`, `routers/weight.ts`, `weight_measurement` table. `weight-ingest`
  is a **15s interval cycle** (not a queue job) — it stays hand-wired in
  `apps/worker` importing `@features/*` (interim; see "Interval cycles are NOT a
  seam"). It is NOT an S1 consumer.
- **T-deploys · fold `tile_deploys`** — `github-actions-service.ts`,
  `routers/github.ts`; GitHub client is worker-only (`runGithubPollCycle`), api
  reads DB. `github-actions-poll` is a **10s interval cycle** (not a queue job) —
  stays hand-wired in `apps/worker` importing `@features/*` (interim). NOT S1.

**Wave-2 boundary review:** `code-review`; confirm placeholder-tiles (bento 1x1
clearance, memory `bento-tiler-1x1-clearance`) passes after each registry deletion.

---

### Wave 3 — Seam S1 (worker-job) + first consumer

- **S1 · Worker job-handler seam (keystone)** — roadmap S1. Covers **queue jobs
  only** (`notify`, `youtube_ingest`); intervals are out of scope (see gotchas).
  - **Package home (resolved):** `@www/core`. `queue.ts` imports `db` + drizzle, so
    core is the natural home (device_state precedent, no cycle). **The `job` table
    itself must follow into core's schema** — that table relocation is the real
    work, not just moving the functions. Call it out in S1 scope so it isn't
    discovered mid-implementation.
  - **Reconcile two `JobSpec` shapes (do not miss this):** there are two unrelated
    types named `JobSpec`. app-kit's facet is `{ name, run: () => Promise<void> }`
    (`define-facets.ts:10`) — what `defineJobs` brands. The worker's is
    `{ type, handler, maxMs }` (`job-worker.ts:20`) — what `JOBS[]` needs, and
    `claimOne(type, handler, maxMs)` + the reaper require both a `JobType`
    discriminant AND `maxMs`, neither of which the facet carries. The generated
    handler must become a `JobHandler<T>(payload, signal)` (`queue.ts:29`), not a
    bare `() => Promise<void>`. **Fix:** extend the app-kit `JobSpec` facet to
    `{ type, handler(payload, signal), maxMs }` so a collected facet has everything
    `JOBS[]` needs. Blast radius is tiny — `defineJobs`/app-kit `JobSpec`'s only
    consumers are `app-kit/define-app.test.ts` and the `app-kit/index.ts`
    re-export.
  - Build: (a) move `enqueueJob`/`JobType` + the `job` table out of
    `apps/api/src/jobs/queue.ts` into `@www/core` and make `JobType`
    **open/extensible**; (b) extend the app-kit `JobSpec` facet (above) and collect
    `JOBS_FACET_BRAND` in `scripts/apps-gen/collect.ts`; (c) emit `jobs.gen.ts`
    (`scripts/apps-gen/emit.ts`); (d) fold generated handlers into `JOBS[]` in
    `apps/worker/src/index.ts` generically.
  - Files: `apps/api/src/jobs/queue.ts`, `app-kit/define-facets.ts`,
    `scripts/apps-gen/{collect,emit,validate}.ts`,
    `features/_generated/jobs.gen.ts` (new), `apps/worker/src/index.ts`,
    `apps/api/src/worker-deps.ts`, `packages/core` (schema + exports).
- **F-notif · fold `tile_notif`** (first S1 consumer) — `notification-service.ts`,
  `apns-service.ts`, `routers/notifications.ts`; the APNs fan-out becomes a
  `jobs.ts` facet on the feature. Depends: S1. NOTE APNs stack gotchas (memory
  `apns-push-stack-gotchas`): worker (not media-worker) drains notify jobs; Bun
  fetch can't do HTTP/2 so apns uses `node:http2`.

**Wave-3 boundary review:** `code-review`; confirm the notify job still drains
(check job table / worker logs), and the old hand-wired `runNotifyJob` import is
gone from worker with knip green.

---

### Wave 4 — Seam S2 (cron-run) + migrate guest-wifi purge

- **S2 · Cron-run seam** — roadmap S2. `crons.gen.ts` is emitted but has no runtime
  consumer. Build a generic scheduler entrypoint that consumes `crons.gen.ts` and a
  single `infra/src/crons.ts` wiring.
  - Files: `features/_generated/crons.gen.ts` (exists), a new generic cron runtime
    consumer, `infra/src/crons.ts`, `apps/api/src/purge.ts` (guest-wifi's hand-wired
    purge, to be retired).
  - First consumer: migrate **guest-wifi's purge** (`features/guest-wifi/jobs.ts`
    `defineCron`) off the hand-wired path onto the seam.
  - `PLACEHOLDER: does the generic cron runtime run inside apps/worker as an
    interval, or as its own k8s CronJob per crons.gen.ts entry (infra/src/crons.ts
    is k8s-native today)? roadmap leaves this to S2 design — decide from the
    guest-wifi purge cadence.`

**Wave-4 boundary review:** `code-review`; verify guest-wifi purge still fires on
schedule via the new path; the hand-wired `apps/api/src/purge.ts` is removed.

---

### Wave 5 — Seam S3 (http-route) + photo/stream folds

- **S3 · HTTP-route seam** — roadmap S3. Replace the hardcoded route ladder in
  `apps/api/src/server.ts` with an `http.ts` facet collected into a generated route
  table that `server.ts` iterates.
  - Files: `app-kit/define-facets.ts` (add `defineHttp` + brand),
    `scripts/apps-gen/{collect,emit}.ts`, `features/_generated/http.gen.ts` (new),
    `apps/api/src/server.ts`.
  - **Signature (resolved):** verified `server.ts:168`/`:225` — wake/booth POST
    routes read `req.arrayBuffer()` raw bytes and return streamed `Response` bodies
    (camera-stream pipes `upstream.body` verbatim). The http facet signature must be
    `(req: Request, url: URL) => Promise<Response>` — mirror the existing `handle()`
    shape exactly, no JSON/tRPC ctx.
- **F-booth · fold `tile_booth`** — `booth-photo-service.ts` (+ test),
  `routers/booth-photos.ts`, `POST /media/booth-photo` + `/media/booth-photos/*`
  routes → feature `http.ts`. Depends: P1.4, P1.6, S3.
- **F-wakes · fold `tile_wakes`** — `wake-photo-service.ts`,
  `wake-photo-purge-service.ts`, `interaction-session-service.ts` (sessions land
  with wakes), `routers/wake-photos.ts` + `sessions.ts`, `wakePhoto` table,
  `POST /media/wake-photo` + `/media/wake-photos/*` routes. Depends: P1.4, S3
  (upload), S2 (purge). Entangled with felogs (Wave 7) via
  `interaction-session-service`.
- **F-dogcam-stream · migrate camera-stream route** — move `/media/camera-stream`
  (`server.ts:143`) onto the dogcam feature's `http.ts`. Depends: S3, T-dogcam
  (Wave 2).

**Wave-5 boundary review:** `code-review`; smoke the photo upload + serve paths
(the raw-body seam is the riskiest); confirm no route left in the server ladder
except `/up` + `/trpc`.

---

### Wave 6 — Media cluster split → tv + sound (heaviest)

Roadmap locked: split `apps/api/src/trpc/routers/media.ts` (334 lines) by client
into TWO features BEFORE folding. Depends: F0 (multi-tile), P1.1 (HA), P1.2/P1.3
(Sonos/Spotify), S1 (playlist poller as job), S3 (tv-artwork route), device_state
store in core.

- **F-media-split · split `routers/media.ts`** into two feature router facets
  (tv procedures vs sound procedures) — prerequisite sub-unit, its own commit.
- **F-tv · fold `features/tv`** = `tile_tv` + `tile_tvapps` (2 tiles, needs F0) —
  `apple-tv-service.ts`, tv procedures, `/media/tv-artwork` route (`server.ts:122`)
  → feature `http.ts`. HA via core.
- **F-sound · fold `features/sound`** = `tile_sound` + `tile_quickplay` (2 tiles) —
  `sonos-*-service.ts` (sound-system/favorites/write/volume-enforcer),
  `spotify-service.ts`, `playlist-poller-service.ts` (**2m interval cycle** that
  *produces* `youtube_ingest` jobs — stays hand-wired in `apps/worker` importing
  `@features/*`; NOT an S1 consumer, see "Interval cycles are NOT a seam"),
  `media_source`/`media_item` tables. Sonos/Spotify via core; device_state via core.

**Wave-6 boundary review:** `code-review`; panel visual-confirm both tiles render
live on `app.worldwidewebb.co` (memory `feedback-self-critique-ui-before-showing`).

---

### Wave 7 — Most-entangled pairs + device-state cluster (last)

- **F-calendar · fold `features/events`** = `tile_event` (owner) + `tile_clock`
  (needs F0 for 2 tiles) — `events-service.ts`, `routers/events.ts`, `events` table.
  Clock keeps a read-only dep on the events feature's `list` procedure via the
  generated router (cross-feature import is fine).
- **F-weather · fold `features/weather`** = `tile_weath` + `tile_hourly` (2 tiles,
  needs F0) — `weather-service.ts`, `weather-read-service.ts`,
  `weather-ingest-service.ts` (**5m interval cycle** — stays hand-wired in
  `apps/worker` importing `@features/*`; NOT S1, see "Interval cycles are NOT a
  seam"), `weather-purge-service.ts` (→ cron via S2), `routers/weather.ts`,
  `weather_reading` + `weather_daily_reading` tables. Depends: F0, S2.
- **F-felogs · fold `tile_felogs`** — `frontend-log-service.ts`,
  `frontend-log-purge-service.ts` (→ cron via S2), `routers/logs.ts`, `frontend_log`
  table. Fold BEFORE finishing the wakes/sessions weld (F-wakes in Wave 5 landed
  sessions; `interaction-session-service` reads BOTH `wakePhoto` and `frontendLog`).
  - `PLACEHOLDER: interaction-session-service straddles wakes + felogs. Confirm the
    final owner: roadmap says sessions land with wakes (Wave 5) and felogs owns only
    frontendLog ingest — verify felogs no longer needs the sessions service after
    the wakes fold, else split the read.`
- **F-devstate · fold device-state cluster** = `tile_ac` + `tile_ctrl` +
  `tile_sound-enforcer` as SEPARATE features (roadmap: separate routers, shared
  `@www/core` device_state store). Each has a **1s enforcer interval cycle**
  (`runClimateEnforcerCycle`, `runEnforcerCycle`/light, `runSonosVolumeEnforcerCycle`,
  `runDeviceSyncCycle`) — **these are intervals, not queue jobs; S1 is a JOB seam.**
  They stay hand-wired in `apps/worker` importing `@features/*` (allowed direction;
  interim per roadmap §Out-of-scope). NOT S1 consumers, and 1s < k8s CronJob's
  1-minute minimum so not S2 crons either (see "Interval cycles are NOT a seam").
  - Files: `climate-service.ts` + `climate-enforcer-service.ts`,
    `controls-service.ts` + `light-enforcer-service.ts`, `device-sync-service.ts`,
    `party-service.ts` (`lamp_mode` table), `sonos-volume-enforcer-service.ts`,
    `routers/{climate,controls}.ts`.
  - **Resolved (sonos-volume-enforcer ownership):** the `sonos-volume-enforcer`
    belongs to `features/sound` (Wave 6), NOT a separate device-state feature, so it
    does not double-own the Sonos client. It reads the shared `@www/core`
    device_state store; its interval cycle is hand-wired like the other enforcers.

**Wave-7 boundary review:** `code-review`; final `apps:check` + full test run;
confirm `apps/api/src/{services,integrations}` and `routers/` contain ONLY the
app-level survivors (`health`, `settings`, `device-settings`, `system`, `sessions`)
and the central `tile-registry.ts` is a generated-tiles consumer (or deleted).

---

## Definition of done (Track C complete)

- All 18 tiles folded; `tile-registry.ts` has no hand-authored tile entries.
- `apps/api/src/{integrations}` empty of tile clients (all in `@www/core`);
  `apps/api/src/services` holds only app-level services;
  `apps/api/src/trpc/routers/` holds only health/settings/deviceSettings/system/
  sessions.
- `apps/worker/src/index.ts` runs generated `jobs.gen.ts` handlers generically;
  `server.ts` route ladder reduced to `/up` + `/trpc`.
- Biome dep-boundary rule green (no `features/* → apps/api`); knip green;
  `apps:check` green; deploy green; panel visual-confirm on a folded tile.

---

## Resolved during review reconciliation (do NOT re-open)

- **F0 manifest shape** → single `tiles: TileSpec[]` (drop singular `tile`, no
  coexistence); `home` moves onto `TileSpec`. No 20-site cost.
- **S1 package home** → `@www/core`, and the `job` table relocates into core schema.
- **S1 JobSpec reconciliation** → extend the app-kit facet to
  `{ type, handler(payload, signal), maxMs }`.
- **Enforcer / interval cycles vs S1** → intervals are NOT a seam; all stay
  hand-wired in `apps/worker` importing `@features/*` (interim). Only `notify` is an
  S1 consumer. (Applies to enforcers, weight-ingest, github-poll, weather-ingest,
  playlist-poller, asc-poll, party, device-sync.)
- **S3 raw-body signature** → `(req: Request, url: URL) => Promise<Response>`, mirror
  `handle()`.
- **integration_sync_status table** → into `@www/core` behind a store interface
  (device_state precedent).
- **sonos-volume-enforcer ownership** → belongs to `features/sound` (Wave 6).

## Genuinely-open PLACEHOLDERs (manager: resolve at the unit's PLANNER stage)

1. **S2 cron runtime shape** (Wave 4) — does the generic `crons.gen.ts` consumer run
   inside `apps/worker` as an interval, or as its own k8s CronJob per entry
   (`infra/src/crons.ts` is k8s-native today)? Roadmap leaves this to S2 design;
   decide from the guest-wifi purge cadence. (Note: k8s CronJob min granularity is
   1 minute — fine for a purge, but rules out sub-minute cycles.)
2. **interaction-session-service owner** (Wave 7 F-felogs) — the service straddles
   wakes + felogs (reads BOTH `wakePhoto` and `frontendLog`). Roadmap lands sessions
   with wakes (Wave 5) and felogs owns only `frontendLog` ingest. Verify felogs no
   longer needs the sessions service after the wakes fold, else split the read.
