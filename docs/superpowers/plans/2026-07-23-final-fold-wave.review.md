# Final Fold Wave Review — media split + booth (Track C FOLD close-out)

Reviewer: final-fold wave-boundary reviewer. Read-only. HEAD at booth fold `f6d1ad39b`.

## PART A — verify the two folds

| Check | Result |
|---|---|
| tv fold `6bfb2e46b` on main, tv procs split into `features/tv/api.ts` (tv ns), apple-tv-service + tv-artwork route on feature `http.ts`, web closure moved, HA via `deps.ts` | PASS |
| sound fold `80fedb7b8` on main, remaining Sonos/Spotify/ingest procs → `features/sound/api.ts` (sound ns), `apps/api/src/trpc/routers/media.ts` DELETED | PASS |
| fixes `4ff128774` (collect.test hand-placed example → tile_booth) + `f170fac7f` (media→tv-sound router test) landed | PASS |
| booth fold `f6d1ad39b` on main, `features/booth` complete (manifest/web/api/service/schema + http), `apps/api/src/http/booth.http.ts` DELETED, `INTERIM_HTTP_MODULES` = `[]` (permanently empty, documented) | PASS |
| `apps/web/src/components/tiles/media.ts` deleted; `apps/api/src/trpc/routers/media.ts` gone | PASS |
| `trpc.media.*` in **source** = 0 (19 grep hits are all stale, untracked `apps/web/coverage/*.html`; coverage not git-tracked) | PASS |
| worker-deps intervals :37/:38 (playlist-poller/sonos-volume-enforcer registry entries) removed, :40 kept — relocated to hand-wired `@features/sound/{poller,enforcer}` | PASS |
| CI: HEAD booth run `30053937709` fully green **incl deploy** (all jobs success); media-router-test-fix run `30052590540` green incl deploy | PASS |

**CI caveat (MINOR):** the three intermediate fold pushes — tv `30051142022`, sound `30052179662`, collect-fix `30052222011` — each went **RED on `test-unit`** (stale A1-era assertions) and were fixed forward by `f170fac7f`/`4ff128774`. The tv/sound feature code therefore only reached a fully-green (deployed) state at `f170fac7f`; end-state HEAD (booth) is green + deployed. No prod breakage at HEAD, but three red pushes crossed prod during the split.

## PART B — end-state invariant verdict: **CLEAN**

1. **All tiles folded — PASS.** `REGISTRY_ENTRIES: TileRegistryEntry[] = []` (tile-registry.ts:56). 16 `features/*/manifest.ts`, 20 tile registrations in `tiles.gen.ts` (multi-tile fan-out), every tile sourced from a feature manifest.
2. **Boundary rule — PASS.** `lint` green. Zero `features/* → apps/api` source imports except: `features/_generated/schema.gen.ts` (generated aggregate re-export of `apps/api/src/db/schema`, pre-existing seam) and `deps.ts` files which pull `@www/core` only (verified `features/tv/deps.ts`).
3. **`apps/web/src/components/tiles/` — PASS (with MINOR coherence note).** All tile **faces** now live in `features/*/web/`. What remains is shared/app-level infra by design: `*.stories.tsx` (e.g. `TeslaTileView.stories.tsx` imports the view from `@features/tesla/web`), `detail/` host + wiring, `views/` detail modals, `__stories__/factory.ts`, `TilePlaceholder`, `GuestWifiQr.tsx`, and `WeightPageView.tsx`/`WeightReadingsView.tsx` (consumed by `detail/wiring/weight.tsx`). No orphan tile faces.
4. **Seams intact + consumed generically — PASS.** `jobs.gen` (`GENERATED_JOBS`, from notif) spread into the worker job registry; `crons.gen` (`GENERATED_CRONS`: felogs/guest-wifi/wakes/weather purges) consumed by `infra/src/crons.ts`; `http.gen` (`GENERATED_ROUTES`: booth/tv/wakes) dispatched via `findRoute(GENERATED_ROUTES, …)` in `server.ts:99`. Hand-wired worker intervals are only the allowed set (light/climate/sonos enforcers, deploy/ASC/playlist pollers, env-gated youtube_ingest).
5. **Multi-tile + single home — PASS.** weather(2)/events/tv(tv+tvapps)/sound(sound+quickplay) collect correctly; exactly one `home: true` (Clock, `features/events/manifest.ts:40`); `apps:check` validate (dup-id/overlap/≠1-home) green.
6. **Slop — clean.** knip green (no dead exports/files), typecheck green, no `any` casts introduced, no skipped/weakened tests (stale tests were replaced, not disabled). Only nits below.
7. **queryWithCache 500 — corroborated NOT a fold regression.** No fold commit (`6bfb2e46b`/`80fedb7b8`/`f6d1ad39b`) touches `queryWithCache` or the cache primitive. `booth.list` still calls `listBoothPhotos(db)` (service moved by rename, body unchanged); `wake_photo` path untouched and fails identically. Environmental/pre-existing.

### Findings

- **[MINOR]** `apps/worker/src/index.ts:59` — stale comment: "`youtube_ingest` stays hand-wired below until media folds (Wave 6)". Media folded (Wave 6); youtube_ingest is *intentionally* kept hand-wired/env-gated per the sound commit, so the comment now misleads. Reword to reflect the permanent decision.
- **[MINOR]** Detail-view treatment is inconsistent across the fold phase: booth/tv moved their detail pager/modals *into* the feature (`features/booth/web/PhotoBoothPager.tsx`, `features/tv/web/*Modal.tsx`), while weight's full-page detail views (`WeightPageView.tsx`/`WeightReadingsView.tsx`) stayed app-level under `detail/wiring`. From earlier waves, not media/booth scope; note for shell-cleanup coherence pass.
- **[MINOR]** CI caveat above — three red `test-unit` pushes crossed prod mid-split before fix-forward. Process note only; HEAD is green + deployed.

**Counts: 0 BLOCKER, 0 MAJOR, 3 MINOR.** Fold phase DONE and coherent; ready for apps/api shell-cleanup.
