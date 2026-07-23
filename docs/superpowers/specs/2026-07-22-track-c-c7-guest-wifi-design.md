# Track C — C7 foundation + guest-wifi canary (design)

> Design spec for the C7 "features-are-apps" foundation and the first fold
> (guest-wifi canary). Derived from the locked grill decisions in
> `docs/superpowers/plans/2026-07-22-track-c-grill-decisions.md` (Q1–Q12) plus two
> decisions resolved during the brainstorm that follows it (substrate seam,
> codegen input flip). The implementation plan is authored separately at
> `docs/superpowers/plans/2026-07-22-track-c-c7-guest-wifi.md`.
>
> Scope: C7 foundation + guest-wifi canary **only**. The remaining 18 folds and
> Slice S (server-side PIN) are out of scope and get their own grills/plans.

## Goal

Stand up the "one folder per feature" architecture (ADR-0001, features-are-apps)
so that adding a feature = making a folder and deleting a feature = deleting a
folder, with a codegen step that is also the validator. Prove it end-to-end by
folding exactly one real feature — guest-wifi — the whole way through, because
its data seam already exists (interface + drizzle adapter + in-memory fake +
tests that inject fakes). The canary is a **relocation + rewire**, not new
architecture, which is why it is the right first fold.

## The model in one paragraph

One folder per feature under `features/<id>/` holds a thin `manifest.ts`
(`defineApp({...})`) plus facet files (`web`, `api`, `jobs`, `schema`) plus
private internals (`service`, `repo`, `repo.fake`). A codegen step (`apps:gen`)
globs the folders and emits checked-in `features/_generated/*.gen.ts` aggregates;
the runtime stays 100% static (no glob at boot). Codegen **is** the validator: it
refuses to emit a broken state (duplicate `id`/router-key/table, ≠1 `home`,
overlapping tile rects, `guestExposed` diverging from the hand-owned
`GUEST_EXPOSED` allowlist). `app-kit/` is a root source dir (no `package.json`)
holding the authoring surface (`defineApp`, `defineApi`/`defineJobs`/`defineCron`,
types) split into `@app-kit` (web-safe) and `@app-kit/server` (trpc primitives).

## Locked decisions (reference)

The 12 grill decisions (Q1–Q12) are the source of truth and are **not**
re-litigated here. Summary of the ones this spec implements:

- **Q2 — manifest shape.** Thin: `id` + tile placement + flags + **direct**
  component refs. No structural arrays.
- **Q3 — structural facets derived.** `api`/`jobs`/`schema` presence is derived
  from facet-file existence, not re-declared on the manifest. Explicit only where
  there is a genuine choice (which web component); derived where there is one
  obvious thing.
- **Q4 — delete custom tile placement.** `TILE_REGISTRY` coords become the single
  source of tile position. Removes `layout-editor/`, `layout-edit-store`,
  `board-layout-service`, the `board_tile_placement` table, the resolveLayout
  override, and the camera/session coupling that fed it.
- **Q5 — `_generated/` drift guard.** Committed (ADR-0002). Guarded by an
  `apps:check` CI step (not a pre-commit hook — bypassable under churn).
  biome-format + stable sort by `id` for byte-stability. Manual reroll convention
  on merge conflict: `git checkout --theirs <gen files> && bun run apps:gen`.
- **Q6 — `app-kit`.** Root source dir, no `package.json`, authoring surface only.
  Barrel split: `@app-kit` (web-safe: `defineApp`, `defineApi`/`defineJobs`/
  `defineCron`, types) vs `@app-kit/server` (trpc primitives). One-way dep rule
  (dependency-cruiser): `platform`/`core` never import `app-kit`/`features`;
  `app-kit` never imports `features`.
- **Q7 — codegen is the validator.** Throws (refuses to emit) on dup
  `id`/router-key/table, ≠1 `home`, overlapping tile rects,
  `guestExposed`≠`GUEST_EXPOSED`. No separate consistency test.
- **Q8 — guest dual mount.** Codegen drives both `appRouter` and `guestRouter`
  from a manifest `guestExposed` flag, **validated against a hand-owned
  `GUEST_EXPOSED` allowlist constant** — gen throws on divergence. Widening the
  guest attack surface requires an explicit, security-reviewed 1-line edit.
- **Q9 — fold unit of work.** One **atomic** push per fold. Atomicity is emergent
  (the validator makes a half-moved state un-pushable), not separately enforced.
  Canary done inline; later folds subagent-bundled once proven.
- **Q10 — eager tiles.** No lazy, no Suspense (warm kiosk). Kill the two
  20-member unions (`TileComponent`/`TileViewComponent`) by retyping
  `component: ComponentType`. Centralize the MapLibre mock to one
  `vitest.setup.ts`; Tesla map tests keep their functional mock. `app-kit` drops
  `lazyNamed`; the manifest holds direct component refs.
- **Q11 — db/substrate layering.** Dumb connection (`pool` + config) in
  `packages/core`, knows zero tables; each feature types queries over its OWN
  `schema.ts` via `drizzle(pool, { schema })`. Breaks the `apps/api ↔ features`
  cycle AND enforces feature isolation at compile time. The full-schema barrel
  (`_generated/schema.gen.ts`) is consumed only by drizzle-kit (migrations),
  never by the runtime handle.
- **Q11b — shared tables.** Two apps never share a table. The validator's
  one-owner rule forces the choice: truly shared → promote to `packages/core`
  behind a store/client interface (precedent: `device_state`); two-apps-that-are-
  one → merge; one-owns-another-peeks → the peek is the signal it is case 1,
  promote. feature→feature imports are forbidden (compile-enforced).
- **Q12 — facet collection by brand/type, never magic name.** `api.ts` exports
  `defineApi(router(...))`; `jobs.ts` exports `defineJobs([...])` / codegen
  collects `defineCron` brands; `schema.ts` — codegen collects every exported
  `pgTable` (self-branded); `web` — the manifest names components directly.
  Missing/mis-branded facet → codegen throws loud.

## Decisions resolved in this brainstorm

Two items the grill surfaced but deliberately left for this design to pin.

### D1 — substrate seam for the canary (Q11 follow-through)

**Chosen: feature owns its config slice (grill "Answer A").**

The forcing constraint: features live under `features/` and are forbidden to
import `apps/api` (the one-way dep rule). Today guest-wifi's config values
(`WIFI_PASSWORD`, `UNIFI_*`, `DATABASE_URL`) come from the ~220-line
`apps/api/src/env.ts` God-schema (~90 importers, ~20 unrelated secrets). After
the move guest-wifi can no longer reach it.

Rather than hoist the whole env God-schema into `packages/core` (which would make
20 unrelated app secrets — Spotify, APNs, HA — "shared substrate", a wrong-layer
over-move and a giant flag-day), pull the **connection substrate seam** cleanly
and let each feature own its own small config slice:

**Moves to `packages/core`:**

1. **`core/db`** — `databaseUrlFromSecret(src)` (DB URL resolution from the
   mounted docker secret) plus a **dumb `createPool(databaseUrl)`** returning a
   `pg.Pool` with **no schema binding**. This is the line that kills the cycle:
   `apps/api/src/db/index.ts:8` currently does `drizzle(pool, { schema })` bound
   to the full barrel; in the new world each feature does
   `drizzle(pool, { schema: ownSchema })` over its own tables.
2. **`hydrateSecretFiles` goes listless.** Today it iterates an explicit 20-name
   `SECRET_FILE_ENV` array (`apps/api/src/env.ts:38-59`) and reads each
   `/run/secrets/<NAME>`. Replace with a directory glob: hydrate **every** file
   present in `/run/secrets/*` into `process.env` if that key is unset, **except a
   small deny-list** (see below). This removes the central cross-feature secret
   list — a feature adding a secret no longer edits a God-list. An explicit env
   var still wins; a missing dir (dev/test) is still a no-op.

   The glob is NOT a pure superset of the 20-name list — the api's `/run/secrets`
   mount (platform manifest, `packages/platform/src/index.ts:358`) also projects
   **`POSTGRES_PASSWORD`**, deliberately absent from the current 20-name list. A
   naive glob would newly hydrate the raw DB password into `process.env` (and every
   child process's env). It is functionally inert for DB-URL resolution
   (`databaseUrlFromSecret` reads the `POSTGRES_PASSWORD_FILE` *file*, not the env
   var, and runs after hydrate), but leaking a credential into env is a regression.
   **Decision: deny-list `POSTGRES_PASSWORD` (and any `*_PASSWORD` DB secret
   resolved via a `_FILE` path) from the glob**, and pin that exclusion with a
   test. (The reverse case — `MEDIA_STORAGE_DIR` is in the 20-name list but not
   mounted — is already a no-op today and unaffected.)
3. **`core/unifi`** — the shared UniFi client moves to core. It is genuinely
   shared: guest-wifi uses `authorizeGuest`/`findActiveAuthorization`; the (not-
   yet-folded) Network tile (`apps/api/src/services/network-service.ts:3`) uses the
   traffic/health methods. Q11b case 1 → promote behind an interface (precedent
   `device_state`). Config arrives via **constructor args** — matching the real
   constructor field names: `createUnifiClient({ apiKey, baseUrl, siteId })` (the
   client's config field is `baseUrl`, not `controllerUrl`; the request timeout
   stays the module const `UNIFI_REQUEST_TIMEOUT_MS`, not a ctor arg). NOT via
   `import { env }` — core imports no app env. Today the module exports a singleton
   `unifi = new UnifiClient()` that falls back to `env` in its constructor
   (`integrations/unifi/index.ts:107-110,217`); that env fallback and the implicit
   singleton **go away**. Both current callers get an explicitly-constructed client:
   - guest-wifi (folded) builds one from its own config slice.
   - **The still-in-`apps/api` Network tile gets an `apps/api`-side configured
     singleton** built from the retained `env` God-schema (a thin
     `apps/api/src/integrations/unifi.ts` wrapper: `createUnifiClient({ apiKey:
     env.UNIFI_API_KEY, baseUrl: env.UNIFI_CONTROLLER_URL, siteId: env.UNIFI_SITE_ID })`).
     Without this the Network import breaks on the canary.
   - `network.test.ts` / `unifi-guest.test.ts` already construct clients with
     `baseUrl` — they follow the client to core and keep passing config explicitly.

**Stays in `apps/api` (unchanged this canary):** the `env` God-schema, for the 18
features not yet folded, **and the full-schema `db` handle** (`db/index.ts`), which
those 18 features still import. guest-wifi parses its **own** config slice
(`WIFI_PASSWORD`, `UNIFI_API_KEY`, `UNIFI_CONTROLLER_URL`, `UNIFI_SITE_ID`,
`DATABASE_URL`) with a tiny feature-local zod object reading the already-hydrated
`process.env`, and builds its own per-feature drizzle handle
(`drizzle(pool, { schema: guestWifiSchema })`). This is the pattern the remaining
18 folds inherit: config and db handle are feature-local; there is no shared env
object; each fold claims its slice when it lands. Q11's "the full-schema barrel is
never consumed by the runtime handle" is the **end state** (all 19 folded); the
transitional truth on the canary is: per-feature handles for folded features, the
full-schema `db` survives for the unfolded ones.

`pool` moves to core; its `apps/api` consumers rewire to import it from core:
`db/index.ts` (rebuilds `db` over the core pool), `purge.ts:22` (the guest-wifi
cron facet, in scope), and `db/seed.ts:6` (rewire too — not part of guest-wifi but
touched by the pool move).

Not a half-move (pool + db-url + hydrator + unifi are taken wholesale) and not an
over-move (the 20-secret schema stays until each feature claims its slice).

**Explicitly deferred (flagged, not this canary):** a full secrets audit /
rationalization across the whole repo. Noted here so the listless hydrator and
the feature-local slices are understood as the first step of that larger pass,
not its conclusion.

### D2 — codegen transitional input flip (no flag-day)

**Chosen: codegen reads the union of both sources during the transition.**

At slice 3, codegen reads today's `tile-registry.ts` and emits byte-identical
`_generated/`. At slice 4, guest-wifi's definition lives in
`features/guest-wifi/manifest.ts` instead. The flip from registry to folders is
**per-feature, not a flag-day**:

- Codegen input = `glob(features/*/manifest.ts)` ∪ `parse(remaining entries in
  tile-registry.ts)`.
- Folding one feature = move its single entry out of `tile-registry.ts` into a
  `features/<id>/` folder, then regen. The registry shrinks by one; the union is
  unchanged in aggregate, so downstream output moves by exactly that one feature.
- At slice 3 `features/` is empty → union = registry alone → output is
  byte-identical to today (this is the determinism proof).
- After all 19 folds `tile-registry.ts` is empty → delete it (that final deletion
  belongs to the last fold, out of scope here).

**Safety net:** the validator throws on duplicate `id`. If a fold forgets to
delete the old registry entry, the `id` appears in both the folder and the
registry → codegen refuses to emit → the half-move cannot be pushed. The flip is
un-screw-uppable by construction (this is the Q9 "atomicity is emergent" property
applied to the transition itself).

**The same transitional union applies to the schema barrel — and this one has a
data-loss trap.** drizzle-kit generates migrations by diffing the DB against a
schema source. Today `apps/api/drizzle.config.ts` points `schema` at
`./src/db/schema.ts`. When guest-wifi's tables (`portalAuthorization`,
`portalRateLimit`, at `apps/api/src/db/schema.ts:278,291`) move to
`features/guest-wifi/schema.ts`, if drizzle-kit still sees only the old file it
will diff those tables as **absent** and emit `DROP TABLE portal_authorization /
portal_rate_limit`. Therefore, in the **same slice** as the table move:

- `apps:gen` emits `features/_generated/schema.gen.ts` = the union
  `glob(features/*/schema.ts)` ∪ `remaining tables in apps/api/src/db/schema.ts`
  (exactly parallel to the tile union — folded tables come from folders, unfolded
  tables stay in the old file).
- `apps/api/drizzle.config.ts` is **repointed** from `./src/db/schema.ts` to the
  generated barrel `features/_generated/schema.gen.ts` in that same slice.
- Verify: `drizzle-kit generate` produces **no** migration (empty diff) right after
  the move — proof the barrel faithfully re-exports every table and nothing is
  dropped. This barrel is consumed by drizzle-kit only, never by a runtime handle.

## Slice-by-slice shape

The work is five slices in strict order. Slices 1–2 are pure preparation in the
existing tree (no `features/`, no `app-kit/`, no codegen). Slice 3 stands up the
foundation as a no-op transform. Slice 4 lifts the shared substrate to
`packages/core` (independent of any feature). Slice 5 folds the canary.

Slice 4 is deliberately its own push: the substrate lift (pool + db-url + hydrator
+ unifi to core, rewiring `network-service.ts`, `purge.ts`, `db/seed.ts`,
`db/index.ts` + their tests) is cross-cutting and touches files unrelated to
folding guest-wifi. Bundling it into the guest-wifi atomic push would make one
large, hard-to-bisect change; splitting it keeps each push independently
reviewable while both remain atomic (each is green-or-nothing).

### Slice 1 — delete custom tile placement (Q4)

Standalone, lands first. A real feature deletion, not a refactor.

- Remove `layout-editor/`, `layout-edit-store`, `board-layout-service`, the
  `board_tile_placement` table (+ its migration path), the resolveLayout override.
- Unpick the camera/session coupling that fed layout edit. This **collides with
  Track B's most recent work** (the layout-edit camera-freeze fix): expect to
  untangle camera/session state out of the layout path rather than delete it
  wholesale.
- `TILE_REGISTRY` coords become the single source of tile position.
- **Verify:** the `placeholder-tiles` bento test passes (memory:
  bento-tiler-1x1-clearance — a 1×1 tile needs a clear neighbourhood) and the
  real app renders on-panel.

### Slice 2 — registry cleanup (Q10)

No codegen, no `features/`. Pure type + test-infra cleanup.

- Kill the two 20-member unions (`TileComponent`/`TileViewComponent` at
  `apps/web/src/lib/tile-registry.ts`) by retyping to `component: ComponentType`
  (eager).
- Centralize the ~15-file MapLibre mock boilerplate to one global stub in
  `.storybook/vitest.setup.ts` (or a sibling setup file). The trivial mocks
  (`() => ({ default: {} })`) collapse to the global; the ~2–3 functional Tesla
  map mocks stay local.

### Slice 3 — codegen scaffold (Q5/Q6/Q7/Q12)

Stands up the foundation as a **no-op transform**: `apps:gen` reads the existing
`tile-registry.ts` and emits `_generated/` that is byte-identical to what the app
already effectively uses. Nothing about runtime behaviour changes.

- Create `app-kit/` root source dir (no `package.json`): `@app-kit` (web-safe
  `defineApp`, `defineApi`/`defineJobs`/`defineCron`, types) and `@app-kit/server`
  (trpc primitives). `defineApp` returns a branded manifest; `defineApi`/
  `defineJobs`/`defineCron` are branded wrappers for facet collection (Q12).
- Implement `apps:gen`: read the union input (slice 3: just registry), validate
  (Q7 rules), emit sorted-by-`id` biome-formatted `_generated/*.gen.ts`
  aggregates (`appRouter`, `guestRouter`, tile list, schema barrel, cron list).
- Implement `apps:check`: regen into a temp location and diff against the
  committed `_generated/`; fail CI on drift. Not a pre-commit hook.
- **Hard gates (non-negotiable — a miss here ships stale images on green CI):**
  - CI product-path-filter includes `features/**` and `app-kit/**` for **all
    three** deployables (web, api, worker), or a change under those paths deploys
    stale images with green CI (memory: ci-cancelled-runs-strand-image-digests,
    main-push-cancels-queued-runs).
  - Dockerfile `COPY` covers the new dirs; extend
    `scripts/check-dockerfile-manifests.ts` so a missing COPY fails the check.
  - `@app-kit` / `@features` path aliases resolve **identically** across vite,
    tsc, vitest, and bun (verify each resolver independently — they do not share
    config).
- **Determinism proof:** committing the generated output after wiring
  `apps:gen` must produce zero diff on a re-run of `apps:gen` (byte-identical).

### Slice 4 — substrate lift to `packages/core` (D1)

Its own atomic push, ahead of the fold. No `features/` involved — this is pure
relocation + rewire of the shared connection substrate, so the canary fold (slice
5) only has to *consume* core, not build it.

- Move to `packages/core`: `databaseUrlFromSecret`, the dumb `createPool(url)` (no
  schema binding), the listless `hydrateSecretFiles` (with the `POSTGRES_PASSWORD`
  deny-list, D1.2), and the UniFi client (`createUnifiClient({ apiKey, baseUrl,
  siteId })`, no `env` import, D1.3).
- Rewire `apps/api` consumers to import from core: `db/index.ts` (rebuild `db` over
  the core pool — the full-schema `db` handle survives for the 18 unfolded
  features), `purge.ts:22`, `db/seed.ts:6`.
- Add the `apps/api`-side configured UniFi singleton
  (`apps/api/src/integrations/unifi.ts`) built from the retained `env` God-schema,
  for the unfolded Network tile.
- **Verify:** `env.test.ts`, `network.test.ts`, `unifi-guest.test.ts` pass
  (updated to construct clients with `baseUrl` explicitly / import from core); a
  test pins that the listless hydrator does **not** hydrate `POSTGRES_PASSWORD`;
  the api + worker boot; `drizzle-kit generate` still empty (schema unchanged this
  slice).

### Slice 5 — guest-wifi fold (Q8/Q9/Q11) — the canary

One **atomic** push, done inline. `git mv` the already-seamed files into place,
add the manifest + branded facets, consume the core substrate (from slice 4),
rewire imports, flip codegen input (D2, tiles **and** schema barrel), repoint
`drizzle.config.ts`, regen, delete the old registry entry.

Target folder shape:

```
features/guest-wifi/
  manifest.ts     defineApp({ id, tile:{label,component,view,worldCol,worldRow,cols,rows}, guestExposed:true })
  web.tsx         GuestWifiTile, GuestWifiTileView          (facet)
  api.ts          export const api = defineApi(router({...})) (facet, from trpc/routers/portal.ts)
  jobs.ts         export const jobs = defineJobs([...])       (facet, the expired-auth purge cron)
  schema.ts       portalAuthorization, portalRateLimit        (facet)
  service.ts      PortalRepo interface + createPortalService  (internals — NOT hoisted to app-kit)
  repo.ts         createDrizzlePortalRepo                     (internals)
  repo.fake.ts    in-memory adapter for tests                 (internals)
```

- Substrate consumption (D1): guest-wifi parses its own config slice and builds
  its own `drizzle(pool, { schema: guestWifiSchema })` over the core pool (the
  substrate itself already moved in slice 4).
- Codegen flip (D2): move the guest-wifi entry out of `tile-registry.ts` **and**
  its two tables out of `apps/api/src/db/schema.ts`; codegen now globs
  `features/guest-wifi/manifest.ts` ∪ registry leftovers (tiles) and
  `features/guest-wifi/schema.ts` ∪ leftover tables (schema barrel); repoint
  `drizzle.config.ts` at `schema.gen.ts`; regen. `drizzle-kit generate` must
  produce an empty diff (no table dropped).
- Guest dual mount (Q8): `guestRouter` codegen'd from `guestExposed` ∩
  `GUEST_EXPOSED`. The guest listener is a separate entrypoint
  (`apps/api/src/guest-server.ts` + `trpc/guest-router.ts` mounting only
  `portal`, ADR-0006 security boundary).
- **Verify:** existing portal tests (which inject fakes) pass unchanged after the
  relocation; `apps:check` clean; guest listener still mounts only `portal`; the
  real panel renders the guest-wifi tile.

## Testing strategy

- **Slice 1:** `placeholder-tiles` bento test + on-panel render. Any camera/
  session tests touched by the un-coupling stay green.
- **Slice 2:** the full vitest suite passes with the centralized MapLibre stub;
  Tesla map tests (functional mock) still pass.
- **Slice 3:** `apps:gen` output byte-identical (determinism proof);
  `apps:check` green; the four alias resolvers (vite/tsc/vitest/bun) each resolve
  `@app-kit`/`@features`; the codegen validator has unit coverage for each throw
  path (dup id, dup router-key, dup table, ≠1 home, overlapping rects,
  `guestExposed`≠`GUEST_EXPOSED`).
- **Slice 4 (substrate lift):** `env.test.ts`, `network.test.ts`,
  `unifi-guest.test.ts` pass (clients constructed with `baseUrl`, imported from
  core); a new test pins that the listless hydrator does NOT hydrate
  `POSTGRES_PASSWORD`; api + worker boot; `drizzle-kit generate` yields an empty
  diff (schema untouched this slice).
- **Slice 5 (guest-wifi fold):** the existing portal service/router/schema/purge
  tests pass unchanged (they already inject fakes — proof the relocation preserved
  the seam); guest-router mount test still shows only `portal`; `apps:check` clean;
  `drizzle-kit generate` yields an empty diff (barrel re-exports every table — no
  `DROP TABLE`).

## Corrections carried from the grill

- guest-wifi is **NOT `sensitive`** (verified: `wiring/guest-wifi.tsx` has no
  flag; only `activity.tsx` is). Roadmap decision 16's "exercises
  sensitive/owned-tables/cron/guest-entrypoint" is **3-of-4** — the `sensitive`
  flag gets its first workout on a gated fold (Activity/climate/controls), not
  the canary.
- ADR-0002's lazy-ref note is superseded by Q10 (eager) — record the deviation
  and why when C7 lands.

## Doc updates owed when C7 lands

- Roadmap + ADR-0001: "consistency test" → "codegen validation".
- ADR-0001: retire the `tile-registry.ts` tile-placement invariant (CLAUDE.md
  too).
- ADR-0002: lazy-ref → eager deviation recorded.
- Roadmap decision 16: canary coverage is 3-of-4 (no `sensitive`).

## Out of scope

- The remaining 18 folds (weather → weight → climate → controls → sonos → tesla →
  …) — mechanical repeats of the canary, each its own atomic push, later
  subagent-bundled.
- Slice S (server-side PIN) — grilled and planned separately; strictly last,
  strictly separate.
- C8 (settings descriptors, roadmap decision 15).
- The full secrets audit (D1) — a separate later pass.
- Parked Track C handoff items (Tesla graceful-degrade, guest-wifi-modal-store
  test coverage, camera warts) — unchanged.

## Process gotchas (trust memory/MEMORY.md — do not relearn)

- SDD scratch collision → use a private per-plan dir, not the fixed
  `.superpowers/sdd/`.
- lefthook format re-stages the whole tree → stage explicit paths, never
  `git add -A`.
- main-push cancels queued CI → verify recovery by pod age.
- biome-format generated meta/JSON before lint (applies to `_generated/` too).
- subagent background-wait stalls → foreground `gh run watch --exit-status`.
- ExitWorktree-after-merge quirk (if worktrees are used at all here).
