# Wave 1 — Foundation Hoist Review (Track C)

**Reviewer:** wave-boundary code reviewer (independent anti-slop gate)
**Date:** 2026-07-23
**Scope:** P1.4 `c4e39bc6b`, P1.2 `e0c0bd2cc`, P1.3 `a8e5b3676`, P1.5 `e3ad65c6d`, P1.6 `00d8ee043` (precedent P1.1 `da0be339e`).

## Verdict: CLEAN

The foundation-hoist wave is sound. Every client/helper genuinely moved to
`packages/core`, is exported from the `@www/core` barrel, and every importer is
repointed. No lingering old-path imports, no re-export shims, no weakened or
skipped tests. Full verify chain is green. Safe to begin the tile-fold waves.

One MINOR note below; not a blocker.

## Verification chain (run fresh this review)

| Gate | Result |
|---|---|
| `bun run apps:gen` | no drift (dirty files in `git status` are unrelated peer docs, not `_generated/`) |
| `bun run apps:check` | clean |
| `bun run typecheck` | all packages exit 0 (incl. `@control-center/api` = apps/api, `@www/core`) |
| `bun run knip` | clean (only 2 pre-existing `.claude`/`.opencode` config hints) |
| `bun run lint` | 13 errors — ALL pre-existing, none from this wave (see below); boundary rule green |
| `@www/core` tests | 183 passed, 41 skipped (env-gated pg-contracts) |
| apps/api repointed tests | device-ownership, device-sync, sonos-write, climate-enforcer, spotify-service, spotify-browse all pass |

## Findings

### 1. [INFO] Hoist correctness — verified clean
Grep for every old path (`integrations/sonos`, `integrations/spotify`,
`services/media-path`, `services/device-state-mapping`, `services/command-window`,
`services/integration-heartbeat`, `services/photo-path-migration`) returns **zero**
survivors outside docs. All seven old files/dirs confirmed **deleted** (not
shimmed): `device-state-mapping.ts`, `command-window.ts`, `integration-heartbeat.ts`,
`media-path.ts`, `integrations/sonos`, `integrations/spotify`,
`services/photo-path-migration.ts`. knip clean confirms no dead re-exports.

### 2. [INFO] P1.5 split + IntegrationSyncStore mirror — verified correct
- `ha-mapping.ts` (pure HA-shape mapping + value compare) → core.
- `device-ownership.ts` (`ownerOf` / `DeviceOwner`, coupled to `findLight` via
  `config/lights`) correctly **left in apps/api** as the deferred Wave-7 hoist.
- `IntegrationSyncStore` mirrors `DeviceStateStore` exactly: `store.ts` interface +
  `pg.ts` adapter + `memory.ts` adapter; consumers pass the store, apps/api keeps a
  one-line pg singleton (`db/integration-sync-store.ts`) as the default.
- `heartbeat`/`runCycle` moved behind the store in core; command-window shim deleted
  and consumers repointed to `@www/core`.
- `db/schema.ts` re-exports `integrationSyncStatus` as an **identity-preserving**
  identifier re-export (drizzle registration + db-mock tests unchanged) — legit, not
  a copy.
- pg-write parity preserved: `onConflictDoUpdate` intentionally omits `updatedAtUtc`
  to keep first-insert value, matching the original heartbeat write (documented).

### 3. [INFO] biome `noProcessEnv` override — legitimate, not a dodge
The new `**/packages/core/test/integration-sync-pg-contract.test.ts` entry sits in
the SAME override block as the existing `pg-contract.test.ts` device-state exemption,
for the same reason: an env-gated (`CORE_PG_TEST_URL`) real-pg contract test that
must read `process.env`. Mirrors precedent exactly. pg-contract test uses a throwaway
schema for isolation and `describe.skipIf(!url)` — skipped in CI, correct.

### 4. [INFO] P1.3 core `vitest.setup.ts` — sound, not masking init-order bug
Seeds the process-wide `@www/logger` root at `level: "silent"` before test files so
`getLogger()` in core clients (Spotify token-refresh debug log) doesn't throw
"called before createLogger". Standard test-harness root-logger seeding that mirrors
apps/api; output suppressed, no behavior asserted on logs. Not a workaround.

### 5. [INFO] The 13 lint errors are ALL pre-existing (NOT this wave)
- 11 × `infra/esphome/.esphome/**` build-cache JSON (format) — last touched by
  `136199f3d` (chore: track esphome gitignore), untouched by any of the 5 commits.
- 1 × `apps/web/src/components/tiles/GuestWifiDesignSheet.stories.tsx` (noUselessFragments).
- 2 × `apps/web/src/portal/__tests__/bundle-isolation.test.ts` (noTemplateCurlyInString).

None of the 5 reviewed commits touch esphome, stories, or portal files. **No
`noRestrictedImports` / boundary violations** anywhere. Boundary rule green.
(Brief called these "apps/web esphome/stories files" — the bulk are actually
`infra/esphome` build cache, but the conclusion — pre-existing, not from this wave —
holds.)

### 6. [MINOR] In-memory IntegrationSyncStore diverges from pg on `updatedAtUtc`
`memory.ts` sets `updatedAtUtc = now` on every `write`, whereas `pg.ts` keeps the
first-insert value (omits it from `onConflictDoUpdate.set`). The in-memory double is
therefore not a faithful mirror of the pg field-update semantics. **Harmless today**:
no consumer reads `updatedAtUtc` (heartbeat only uses `consecutiveFailures` /
`lastPolledAtUtc` / `lastError`), and the shared store-contract test doesn't assert
it. If a future consumer starts reading `updatedAtUtc`, the in-memory adapter would
mask a pg behavior difference. Optional fix: mirror the pg semantics (preserve the
existing `updatedAtUtc` on update) or drop the field from the in-memory row.

## Slop check
No half-done repoints, no dead exports (knip clean), no duplicated logic between core
and apps/api (the split is a clean pure/config-coupled seam), logger wiring sound, no
test weakened or skipped to go green (the only skips are correctly env-gated pg
contracts). Test coverage was moved, not lost: `integration-heartbeat.test.ts`
(-131) folded into core `heartbeat.test.ts` (+69) + `integration-sync-memory.test.ts`,
and `device-ownership.test.ts` (+84) covers the retained apps/api split.
