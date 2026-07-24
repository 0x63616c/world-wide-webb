# F0 Multi-tile manifest — Plan Review

**Reviewer:** independent (did not author the plan). Verified against in-tree code 2026-07-23.

## Verdict: APPROVE-WITH-FIXES

The shape (`tiles: TileSpec[]`, required per-tile `id`, `home` moved to tile,
flatten-then-validate) is correct and scales. Migration is atomic and the
zero-behaviour-change claim holds. Two concrete fixes needed before implement
(one a real false-positive bug in the test migration), plus minor clarifications.

---

## Findings

### [MAJOR] F1 — test helper migration will make the new dup-tile-id check false-positive
`scripts/apps-gen/validate.test.ts` builds tiles from a shared `base.tile` with
NO id (verified: `base` line 4-6, `app()` line 8-30). Multiple existing cases
pass two apps — line 38 `app({id:"a"}), app({id:"b"})` and line 45
`app({id:"a",...}), app({id:"b",...})`. After F0, the flattened dup-tile-id check
runs over all tiles. If the migrated helper gives every tile the same constant id
(or omits it), those two-app cases throw a spurious `duplicate tile id` and the
suite goes red — masking the real assertion.
**Fix:** the plan's §5.2 must state explicitly that the migrated `app()` helper
derives each tile's id from the app id (e.g. `tiles: [{ id: over.id ?? "a", ... }]`)
so single-tile-per-app test cases keep distinct tile ids. Only the dedicated
"two tiles share a tile id" case sets a colliding id deliberately. Without this
instruction the mechanical migration breaks green tests.

### [MAJOR] F2 — cross-unit ordering with S1/notif is under-specified (author-shape hazard)
`notif` exists TODAY only as a **registry** tile (`tile_notif`, verified in
`features/_generated/tiles.gen.ts:103`); there is NO `features/notif/` folder yet.
S1 is folding it into a feature concurrently. PLACEHOLDER-A correctly tells the
implementer to re-list `features/` and migrate whatever single-tile manifests
exist — good, not hardcoded to 6. But it only covers "notif lands first". The
inverse is the real hazard: **if F0 lands first, S1's notif manifest must be
authored in the NEW `tiles: [{ id, ... }]` shape**, not the old singular `tile:`.
The plan cannot control S1, but it should flag this to the team-lead so S1's
brief is updated, and note that whichever unit lands second must match the other's
shape. Add one line to §12 PLACEHOLDER-A.

### [MINOR] F3 — "exactly two readers" undercounts; keep the file list authoritative
§2 and §3.1 say `AppManifest.tile` has "exactly TWO readers" (collect +
manifestToEntry). True for the *manifest-level* field. But the *collected*
`.tile`/`a.tile` has two more readers the migration must also touch:
`scripts/apps-gen/emit.ts:22,30` (`renderTile`, `CollectedApp["tile"]`) and
`scripts/apps-gen/validate.ts:26,119` (`ValApp.tile`, `overlaps(...tile)`). The
plan DOES migrate both (§4.2, §4.4) and §7 lists every file, so this is not a
missed reader — only the "two readers" framing could lull an implementer.
**Fix:** reword to "two readers of the manifest field; two more of the collected
field (emit, validate) — all four migrated, see §7."

### [MINOR] F4 — O(n²) overlap over all-tiles-of-all-apps: acceptable, note it
Flattening then pairwise is O(n²) over every tile of every app (~20 tiles → 190
pairs today; 100x → ~2000 tiles → ~2M pairs, still sub-ms). Fine at target scale;
no change needed. The plan already flags it. Recorded for completeness.

---

## Pressure-test results (verified against real code)

1. **Shape / readers** — `AppManifest = { id, tile, guestExposed?, home?, sensitive? }`
   (`app-kit/define-app.ts:17-23`), `TileSpec` has no id (5-16). Manifest-field
   readers of `.tile`: exactly 2 (`collect.ts:125-130`, `tile-registry.ts:239-251`).
   Collected-field readers: 2 more (`emit.ts:22,30`, `validate.ts:26,119`). All 4
   migrated by the plan. Dropping singular `tile` for a clean array is the right
   call (sugar would fork every read path forever).
2. **Required `TileSpec.id`** — correct and necessary (board / `board_tile_placement`
   / placeholder-tiles / minimap key on tile id; N tiles can't share the app id).
   It DOES break all 6 existing manifests (they carry only an app-level id, no
   `tile.id`) — but the atomic migration (§7) adds `id` to each in the same commit,
   so `tsc`/`apps:check` never see a partial state. Correct.
3. **Home rule** — verified only ONE home today: the Clock **registry** entry
   (`tile-registry.ts:79`); NO feature manifest sets `home` (grep confirms). F0
   does not touch the registry, so the single home is preserved. All home readers
   accounted for: `validate.ts:106,116` (→ count flattened `t.home`),
   `collect.ts:133,200` (→ per-tile), `emit.ts:32` (→ per-tile), `tile-registry.ts:252`
   (`m.home` → `tile.home`), and `HOME_TILE:263` + `registry-guards.test.ts:53`
   already tile-level and UNCHANGED. Consistent.
4. **Overlap validator** — current 20 tiles (6 feature + 14 registry, all single-tile)
   don't overlap; flattening yields the identical rect set as today, so no false
   positive. Intra-app overlap is genuinely caught because same-app tiles are just
   two entries in the flat list. Dup-tile-id check is sound (map keyed on tile id).
5. **Atomic migration** — §7 correctly bundles types + all N manifests + all
   codegen readers + regenerated `_generated` in one commit. Re-count-live guidance
   present (see F2 for the inverse-ordering gap).
6. **tiles.gen.ts consumption** — verified nothing imports the emitted file or its
   `GENERATED_TILES` const. `renderTiles` is used only by `apps-gen.ts`,
   `apps-check.ts`, `emit.test.ts` (regenerate/diff). Shape change (incl. the
   `GeneratedApp`→per-tile `GeneratedTile` rename) is runtime-inert. Plan correct.
7. **Proof tests** — real and adequate at validate/emit/define-app level over
   synthetic models (no throwaway feature folder). Once F1 is applied they cover:
   2-tile pass, 2nd home fails, intra-app overlap fails, dup tile id fails.

## Placeholders resolved
- **PLACEHOLDER-A** — no `features/notif/` in-tree; `tile_notif` is a registry
  leftover only. Migrate however many single-tile feature manifests exist at
  implement time (6 today). See F2 for the inverse-ordering addition.
- **PLACEHOLDER-B** — keep App id == tile id for all single-tile apps + 14
  registry leftovers (consistent today; verified guest-wifi app id `tile_guestwifi`
  is the allowlist key). Multi-tile guest-exposed apps are a later-fold concern,
  not F0. Correct to defer.
