# Review — Unit F-booth (fold Photo Booth into features/booth)

**Verdict: APPROVE**

Independent review against HEAD source. The plan is a faithful strict-subset of the
landed wakes fold. Every file, line reference, coord, and empty-collection edge was
checked against real code. No blockers. Two minor cosmetics that the plan already
instructs (flagged so the implementer does not skip them).

Findings: **0 BLOCKER / 0 MAJOR / 3 MINOR**.

---

## Empty-collection edges (the crux) — all SAFE

### 1. `REGISTRY_ENTRIES` goes empty — SAFE
- `tile-registry.ts:123-125` `TILE_REGISTRY = [...REGISTRY_ENTRIES, ...FEATURE_MANIFESTS.flatMap(manifestToEntries)]`. Spread of `[]` is a no-op; `TILE_REGISTRY` stays non-empty (15 feature manifests). Confirmed.
- `HOME_TILE` (`:130`) = `TILE_REGISTRY.find(t => t.home) ?? TILE_REGISTRY[0]` — home is the Clock (`features/events`, `tile_clock` `home:true`, proven by the events collect test). `.find` resolves it; the `[0]` fallback is never reached and is non-empty anyway. No `REGISTRY_ENTRIES[0]` / non-empty assumption anywhere.
- `componentMap` loop (`:135`) iterates `TILE_REGISTRY` (feature tiles), not `REGISTRY_ENTRIES`. Fine.
- **collect.ts does NOT read `REGISTRY_ENTRIES`** — it imports `TILE_REGISTRY` and filters out feature-owned ids (`featureTileIds`). Post-fold every `TILE_REGISTRY` entry is feature-owned, so `registryApps = []`. No `.reduce`/index/non-empty assumption. Confirmed.
- validate.ts has zero registry-count assumption; only "exactly one home" (still satisfied by events Clock) and dup/overlap checks.

### 2. `INTERIM_HTTP_MODULES` goes empty — SAFE
- `collect.ts:307` `for (const entry of INTERIM_HTTP_MODULES)` iterates nothing on `[]`; no `.map`/`.reduce`/index over it. `httpModules.sort` still runs on the wakes-only array. Confirmed.
- The empty-array-with-annotation is valid TS; keep `readonly {...}[]` (plan says so).

### 3. Home-tile validator post-booth — SAFE
- `tile_clock home:true` lives in `features/events`, collected as `source:"feature"`; validate sees exactly one home. Booth never had home. Confirmed.

### 4. collect.test assertion deletion — CORRECT, no other non-empty-registry test
- The `expect(...tile_booth...source).toBe("registry")` line lives **inside** the guest-wifi dedup test (`collect.test.ts` ~`:22-25`), not standalone; deleting just that assertion + its comment leaves the test valid. Correct.
- Grepped: **no other test asserts a registry-sourced app** or a non-empty `REGISTRY_ENTRIES`/`TILE_REGISTRY`. The interim-booth test (`:44-54`) and emit.test.ts `:25` are the only other booth codegen assertions, both handled by the plan. Confirmed.

---

## Web closure — 18 files, COMPLETE, gifenc STAYS

`git ls-files` enumeration matches the plan exactly:
- Group A (14): the entire `apps/web/src/components/tiles/photo-booth/` dir. ✓
- Group B (2 + 1 test): `lib/booth-capture.ts`, `lib/booth-filters.ts`, `lib/__tests__/booth-capture.test.ts`. ✓
- Group C (1): `components/tiles/detail/wiring/photo-booth.tsx`. ✓
- **Only 3 external importers** (grep-confirmed): `tile-registry.ts`, `detail/registry.ts`, `tile-title-sync.test.tsx` — all handled in the plan. No cross-tile / cross-feature import of the closure.
- **`gifenc.d.ts` correctly STAYS**: resolved by `apps/web/tsconfig.json:11` `paths` (`"gifenc": ["./src/types/gifenc.d.ts"]`), not location. Moving it would break the mapping. `booth-capture.ts` (camera `getUserMedia` + GIF pipeline) keeps its bare `gifenc` import, resolved via apps/web's program. Correct.
- title-sync glob `features/*/web/*.tsx` (`tile-title-sync.test.tsx:58`) picks up `PhotoBoothTile.tsx` iff it sits directly in `features/booth/web/` — the plan's chosen shape puts the 14 components there, so the guard stays green. storybook glob already covers `features/**/*.stories`. No edit needed. Confirmed.

---

## http fidelity — PRESERVED

- `booth.http.ts` = `defineHttp([{ method:"POST", path:"/media/booth-photo", match:"exact", ... }])`, `req.arrayBuffer()` body. Moves verbatim to `features/booth/http.ts`; `collect.ts` Source A emits ident `boothHttp` (dir "booth", no hyphen) importPath `../booth/http` source `feature:booth`. Interim entry deleted. Route still served via `GENERATED_ROUTES`. Confirmed against `collect.ts:282-303`.

---

## photo-path-migration repoint — COMPILES

- `photo-path-migration.ts:10-11` import `boothPhoto` from `../db/schema` + `defaultBoothPhotoRoot` from `../services/booth-photo-service` → `@features/booth/{schema,service}`. `apps/api → @features` is the allowed direction. `db.update(boothPhoto)` / `db.select().from(boothPhoto)` (`:86-110`) use drizzle query builders that accept any `pgTable`, so a foreign-feature table typechecks. Confirmed.
- **Its test needs NO booth change**: `grep boothPhoto photo-path-migration.test.ts` → **zero hits** (booth is the else-branch; test uses only `wakePhoto` as identity token). Confirmed exactly as the plan claims.

---

## Boundary / knip / atomic — SOUND

- server.ts (`:12` `readBoothPhoto`, `:59` `migrated.booth`, `:170-172` GET serve) repoints import to `@features/booth/service`, GET branch DEFERRED in place — matches wakes. Confirmed.
- `routers/index.ts:3,16` import+mount deleted (key arrives via `featureAppRouter`); dup-router-key validator forces same-commit deletion — correct atomicity reasoning.
- `purge.ts` — **0 booth refs** confirmed; NO `jobs.ts`; correct.
- schema `boothPhoto` at `:135-179` + stale doc comment `:114-133` — deletion targets correct.
- Every service export retains a live consumer post-fold → knip clean (plan enumerates them; matches router/http/server/migration usage).
- coords verbatim 30/22/2×2; `guestExposed` NOT set, `GUEST_EXPOSED` untouched (flag⇔allowlist both-absent is consistent per validate.ts).

---

## MINOR findings

- **[MINOR] emit.test.ts title/string.** `:20` title "wake + booth http modules" and `:25` import string `"../../apps/api/src/http/booth.http"` — plan §3 changes the string to `"../booth/http"` and says update the title. Ensure BOTH land; ident `boothHttp` at `:27` stays unchanged (verified). Fix: as the plan states.
- **[MINOR] collect.test.ts interim-booth `it()` title.** `:44` "yields the migrated booth route from the interim http list" must be rewritten with the body to `feature:booth` (mirror the wakes test `:59-68`). Plan §2 covers it; do not leave the old title.
- **[MINOR] `INTERIM_HTTP_MODULES` doc-comment now describes nothing.** `collect.ts:132-159` CODEGEN-SAFETY prose (about importing each interim file transitively hitting apps/api env) is moot once the list is permanently empty. Harmless; optionally trim to a one-line "permanently empty — all http facets now Source A". Not blocking.

---

## Single most important finding

All three empty-collection edges (`REGISTRY_ENTRIES`, `INTERIM_HTTP_MODULES`, and the
registry-source dedup) are structurally safe — no codegen/validate/apps:check path
assumes a non-empty registry or interim list, and the sole home tile still resolves
from `features/events`.

**Status: ready to implement (yes).**
