# Track C grill decisions — C7 foundation + guest-wifi canary

> Output of an adversarial requirements grill (2026-07-22), **not** an implementation plan.
> Scope: C7 foundation + the guest-wifi canary fold only. The other ~18 folds and Slice S
> (server PIN) get their own grills later. A separate session brainstorms/plans from this
> record. Supersedes conflicting phrasing in the consolidation roadmap where noted.

## Scope (Q1)

C7 foundation + guest-wifi canary. The remaining 18 folds become mechanical repeats of the
canary; Slice S is grilled separately (it is strictly last, strictly separate anyway).

## The model in one paragraph

One folder per feature under `features/<id>/` holding a thin `manifest.ts` + facet files
(`web`, `api`, `jobs`, `schema`) + private internals (`service`, `repo`, `repo.fake`). A
codegen step (`apps:gen`) globs the folders and emits checked-in `features/_generated/*.gen.ts`
aggregates (the runtime stays 100% static). Codegen **is the validator** — it refuses to emit a
broken state. Add a feature = make a folder; delete a feature = delete the folder.

## Decisions (locked)

| # | Decision | Choice |
|---|----------|--------|
| Q1 | Grill scope | C7 foundation + guest-wifi canary only |
| Q2 | Manifest shape | Thin: `id` + tile placement + flags + **direct** component refs. No structural arrays. |
| Q3 | Structural facets (api/jobs/schema) | **Derived** from facet-file presence, not re-declared on the manifest (ADR-0002). Explicit where there's a choice (web components), derived where there's one obvious thing. |
| Q4 | Custom tile placement (drag-to-rearrange) | **Delete it** — own slice, lands FIRST. `TILE_REGISTRY` coords become the single source of position. Removes `layout-editor/`, `layout-edit-store`, `board-layout-service`, `board_tile_placement` table, resolveLayout override, camera/session coupling. |
| Q5 | `_generated/` drift guard | Committed (ADR-0002); `apps:check` CI guard (not pre-commit — bypassable under churn); biome-format + stable sort by `id` for byte-stability; manual reroll convention on conflict (`git checkout --theirs && bun run apps:gen`). |
| Q6 | `app-kit` | Root source dir (no `package.json`). Authoring surface only. **Barrel split:** `@app-kit` (web-safe: `defineApp`, `defineApi`/`defineJobs`/`defineCron`, types) vs `@app-kit/server` (trpc primitives). One-way dep rule (dependency-cruiser): `platform`/`core` never import `app-kit`/`features`; `app-kit` never imports `features`. |
| Q7 | Ownership guard | **Codegen IS the validator** — throws (refuses to emit) on dup `id`/router-key/table, ≠1 `home`, overlapping tile rects, `guestExposed`≠`GUEST_EXPOSED`. No separate consistency test. Roadmap/ADR-0001 "consistency test" wording → "codegen validation". |
| Q8 | guest-wifi dual mount (full router + isolated guest listener) | Codegen drives both `appRouter` + `guestRouter` from a manifest `guestExposed` flag, **validated against a hand-owned `GUEST_EXPOSED` allowlist constant** — gen throws on divergence. Widening the guest attack surface requires an explicit 1-line security-reviewed edit. |
| Q9 | Fold unit of work | One **atomic** push per fold (the validator makes half-moved states un-pushable — atomicity is emergent, not enforced). Canary done **inline**; later folds subagent-bundled once the pattern is proven. |
| Q10 | Lazy vs eager tiles | **Eager** (no lazy, no Suspense — warm kiosk). Kill the two 20-member unions by retyping `component: ComponentType`. Kill the ~15-file MapLibre mock boilerplate by centralizing the trivial stub to one `vitest.setup.ts`; Tesla map tests keep their functional mock. `app-kit` drops `lazyNamed`; manifest holds direct component refs. |
| Q11 | db/substrate layering | **Dumb connection** (`pool` + `env`) in `packages/core`, knows zero tables; each feature types queries over its OWN `schema.ts` (`drizzle(pool, { schema })`). Breaks the `apps/api ↔ features` cycle AND enforces feature isolation at compile time. The full-schema barrel (`_generated/schema.gen.ts`) is consumed only by drizzle-kit (migrations), never the runtime handle. The canary pulls `env`/`pool`/`unifi` down to core (roadmap decision 2 coming due). |
| Q11b | Shared tables | Two apps **never** share a table. Validator's one-owner rule forces a choice: (1) truly shared → promote to `packages/core` behind a store interface (precedent: `device_state`); (2) two apps that are one app → merge; (3) one owns, another peeks → the peek is the signal it's case 1, promote. feature→feature imports forbidden (compile-enforced). |
| Q12 | Facet export convention | Collect **by brand/type, never by magic name.** `api.ts` exports `defineApi(router(...))`; `jobs.ts` exports `defineJobs([...])` / codegen collects `defineCron` brands; `schema.ts` — codegen collects every exported `pgTable` (self-branded); `web` — manifest names components directly. Missing/mis-branded facet → codegen throws loud. Fixed names + visible `define*` wrappers = explicit, uniform, unbypassable. |

## Slice order (C7)

1. **Delete custom placement** (Q4) — own slice, first.
2. **Registry cleanup** (Q10) — retype away the two unions; centralize the MapLibre stub. No codegen, no `features/`.
3. **Codegen scaffold** (Q5/Q6/Q7/Q12) — `app-kit/` dirs; `apps:gen` reads `tile-registry.ts` transitionally, emits byte-identical `_generated/`; codegen-as-validator; `apps:check` drift guard. **Hard gates (non-negotiable):** CI product-path-filter includes `features/**`+`app-kit/**` for ALL 3 deployables (else stale-image deploys, green CI); Dockerfile COPY + extend `check-dockerfile-manifests`; `@app-kit`/`@features` aliases resolve identically across vite + tsc + vitest + bun.
4. **guest-wifi fold** (Q8/Q9/Q11) — atomic push, inline. `git mv` the already-seamed files into `features/guest-wifi/`; add `manifest.ts` + branded facets; pull `env`/`pool`/`unifi` to `packages/core`; rewire imports; regen; delete old registry entries. `guestRouter` codegen'd from `guestExposed` ∩ `GUEST_EXPOSED`.

## guest-wifi canary — real shape

```
features/guest-wifi/
  manifest.ts     defineApp({ id, tile:{label,component,view,worldCol,worldRow,cols,rows}, guestExposed:true })
  web.tsx         GuestWifiTile, GuestWifiTileView          (facet)
  api.ts          export const api = defineApi(router({...})) (facet, from trpc/routers/portal.ts)
  jobs.ts         export const jobs = defineJobs([...])       (facet, the expired-auth purge cron)
  schema.ts       portalAuthorization, portalRateLimit        (facet)
  service.ts      PortalRepo interface + createPortalService  (internals — do NOT hoist to app-kit)
  repo.ts         createDrizzlePortalRepo                     (internals)
  repo.fake.ts    in-memory adapter for tests                 (internals)
```

Data seam already exists (interface + drizzle adapter + in-memory fake + tests inject fakes) —
the canary is a **relocation + rewire**, which is why it's the right first fold.

## Corrections found during the grill

- guest-wifi is **NOT `sensitive`** (verified: `wiring/guest-wifi.tsx` has no flag; only `activity.tsx` is). Roadmap decision 16's "exercises sensitive/owned-tables/cron/guest-entrypoint" is 3-of-4 — the `sensitive` flag gets its first workout on a gated fold (Activity/climate/controls), not the canary. Fix that doc claim when it lands.
- ADR-0002's lazy-ref note is superseded by Q10 (eager). Record the deviation + why when it lands.

## Doc updates owed when C7 lands

- Roadmap + ADR-0001: "consistency test" → "codegen validation".
- ADR-0001: retire the `tile-registry.ts` tile-placement invariant (CLAUDE.md too).
- ADR-0002: lazy-ref → eager deviation recorded.
- Roadmap decision 16: canary coverage 3-of-4 (no `sensitive`).

## Not grilled (deliberately deferred)

18 remaining folds (weather → weight → climate → controls → sonos → tesla → …); Slice S
(server-side PIN); C8 (settings descriptors, roadmap decision 15). Parked items from the Track C
handoff (Tesla graceful-degrade, guest-wifi-modal-store test coverage, camera warts) unchanged.
