# Central Env/Config Registry — Implementation Plan

Date: 2026-07-23
Spec: `docs/superpowers/specs/2026-07-23-env-config-registry-design.md`
Fixes / retires hotfix: `3db4dde87` (`import "./env"` atop `apps/api/src/server.ts`)

## Ground rules (shared checkout)

- Work on `main`. Stage **explicit paths only** — never `git add -A`/`.`.
- After each commit: `git show --stat HEAD` — confirm only your files.
- Before each push: `git pull --rebase --autostash -q` then push; retry on
  reject.
- Verify before every push: `bun run typecheck` (exit 0) + the step's tests. Red
  → fix forward, do not push. The api hotfix holds prod, so correctness > speed.
- No backticks in `git commit -m`. Commit + push each step; no PRs.

Each step below is one coherent, independently-green commit.

---

## Step 1 — Scaffold the platform/env package surface + field builders

**Changes**
- `packages/platform/env/fields.ts`: `str/url/pgUrl/num/int/bool/secret/enumOf`
  builders returning `FieldSpec<T>`, chainable `.required/.default/.devDefault/
  .optional/.optionalSecret/.forRuntime/.forFeature`. Zod under the hood.
- `packages/platform/package.json`: add `exports["./env"]: "./env/index.ts"`;
  add `@www/logger` to `dependencies`.
- `packages/platform/env/index.ts`: barrel (empty re-exports for now).
- `packages/platform/tsconfig.json`: ensure `env` is in `include` (it globs
  `src`,`test` today — add `env`).

**Verify**: `bun run --filter @www/platform typecheck`. No runtime behavior yet.

**Commit**: `feat(platform/env): scaffold env field builders + package surface`

---

## Step 2 — Order-independence regression test (RED first, TDD)

**Changes**
- `packages/platform/test/env.test.ts`: write the headline regression test from
  spec §8.1 plus the field-builder tests (§8.2). Reference a tiny local
  `defineEnv({ HA_TOKEN: secret().required().devDefault("") })` fixture.
- These fail to compile/run because `defineEnv`/`ENV`/lazy access don't exist
  yet. That is the RED state.

**Verify**: `bun run --filter @www/platform test` — the new test FAILS (proves
it exercises the not-yet-built lazy path). Commit the red test.

**Commit**: `test(platform/env): failing order-independence regression + field specs`

---

## Step 3 — Lazy Proxy registry: `defineEnv` + `pick` + memoization (GREEN)

**Changes**
- `packages/platform/env/registry.ts`: `defineEnv(spec)` returning the `Proxy`
  accessor `ENV` with the `get`/`has`/`ownKeys` traps, shared module `Map`
  cache, per-key parse (default/devDefault/required-missing/optional rules),
  and `pick(...keys)` returning a scoped Proxy. `__resetEnvCache()` test hook.
  `APP_ENV` read live for devDefault gating.
- `packages/platform/env/index.ts`: export `defineEnv`, field builders, types.

**Verify**: `bun run --filter @www/platform test` — regression + builder +
memoization + pick-isolation tests GREEN. `typecheck` exit 0.

**Commit**: `feat(platform/env): lazy memoized Proxy registry + pick projection`

---

## Step 4 — Move hydration into platform + `assertEnv` + `initEnv`

**Changes**
- Create `packages/platform/env/hydrate.ts`: move `hydrateSecretFiles()` +
  `databaseUrlFromSecret()` verbatim from
  `packages/core/src/secrets/hydrate.ts` and `packages/core/src/db/pool.ts`.
- `packages/core/src/db/pool.ts`: remove `databaseUrlFromSecret` (keep
  `createPool`). Delete `packages/core/src/secrets/hydrate.ts`; drop its dir if
  empty. Update `packages/core/src/index.ts` re-exports (remove the two moved
  symbols).
- `packages/platform/env/assert.ts`: `assertEnv(runtime)` (spec §5.5) logging its
  fatal via its OWN `createLogger({ service: "env" })` (NOT `getLogger()` — it
  runs from a side-effect import before the app's `createLogger`; spec §5.5) +
  `process.exit`. `initEnv(runtime)` (spec §5.6) = hydrate → derive DATABASE_URL →
  assertEnv, invoked at import time from each app's `boot-env.ts` (Step 9).
- Update the ONE current importer `apps/api/src/env.ts` to import
  hydrate/databaseUrlFromSecret from `@www/platform/env` (temporary — env.ts is
  deleted in Step 10).
- `packages/platform/test/env.test.ts`: add `assertEnv` fail-fast, parse-fail,
  and devDefault-gating tests (§8.5–8.7). `assertEnv` must source its fatal-line
  logger via `createLogger({ service: "env" })`, **not** `getLogger()` (spec
  §5.5) — the test spies `process.exit` and asserts the `{missingKeys}` fatal was
  logged without a "getLogger() called before createLogger()" throw.
- **Move (not repoint) the core tests that exercise the moved symbols.**
  `packages/core/test/pool.test.ts` and `packages/core/test/hydrate.test.ts`
  currently import `databaseUrlFromSecret`/`hydrateSecretFiles`. Move the cases
  covering those two symbols into `packages/platform/test/` (e.g. fold into
  `env.test.ts` or a new `hydrate.test.ts`) so a `core` test never imports
  `@www/platform` (keeps layering clean). Any `pool.test.ts` cases that still
  cover the surviving `createPool` stay in `packages/core/test/pool.test.ts`;
  confirm that file still has its `noProcessEnv` override coverage if it retains a
  `process.env` read (it should not once `databaseUrlFromSecret` is gone).
- Grep for any other importer of the moved symbols and repoint.

**Verify**: `bun run --filter @www/platform test`,
`bun run --filter @www/core typecheck && test`,
`bun run --filter @control-center/api typecheck`. Root `bun run typecheck`.

**Commit**: `feat(platform/env): own hydration + assertEnv/initEnv boot guard`

---

## Step 5 — Populate the full registry manifest

**Changes**
- `packages/platform/env/registry.ts` (or a dedicated `env.ts`): declare every
  key from spec §4 in one `defineEnv({...})`, correctly tiered/tagged. Export
  the concrete `ENV`.
- Optional: `packages/platform/test/env.test.ts` — add the secretCatalog-parity
  test (spec §7) if cheap; otherwise leave a `// FOLLOW-UP` note.

**Verify**: `bun run --filter @www/platform typecheck && test`. Assert `ENV`
type surface matches expectations with a couple `expectTypeOf` lines.

**Commit**: `feat(platform/env): declare full env manifest (single source of truth)`

---

## Step 6 — Migrate feature configs, batch A (HA cluster)

Features sharing `HA_URL`/`HA_TOKEN`: **ac, ctrl, dogcam, tesla, tv**.

**Changes** — each `features/<id>/config.ts` becomes:
```
import { ENV } from "@www/platform/env";
export const config = ENV.pick(/* exact keys that feature used */);
```
- ac: `DATABASE_URL, HA_URL, HA_TOKEN, CLIMATE_ENTITY_ID, TESLA_ENTITY_PREFIX`
- ctrl: `DATABASE_URL, HA_URL, HA_TOKEN`
- dogcam: `HA_URL, HA_TOKEN, GO2RTC_URL, CAMERA_STREAM_NAME, CAMERA_LABEL`
- tesla: `HA_URL, HA_TOKEN, TESLA_ENTITY_PREFIX, HOME_LAT, HOME_LON, HOME_PLACE_NAME, HOME_RADIUS_MILES`
- tv: `HA_URL, HA_TOKEN`

Delete the Zod schema + `parse(process.env)` + duplicated defaults + the stale
"reads already-hydrated process.env" doc comment (replace with a one-line
"typed slice of the central env registry" comment).

**Verify**: `bun run typecheck`; run each touched feature's tests; `bun run
apps:check` (branded-facet import must not throw — lazy config guarantees it).

**Commit**: `refactor(features): migrate ac/ctrl/dogcam/tesla/tv config to env registry`

---

## Step 7 — Migrate feature configs, batch B (network/wifi cluster)

Features: **network, guest-wifi**.
- network: `WIFI_SSID, WIFI_GUEST_SSID, WIFI_PASSWORD, UNIFI_API_KEY, UNIFI_CONTROLLER_URL, UNIFI_SITE_ID`
- guest-wifi: `WIFI_PASSWORD, UNIFI_API_KEY, UNIFI_CONTROLLER_URL, UNIFI_SITE_ID, DATABASE_URL`

**Verify**: `bun run typecheck`; network + guest-wifi tests; `apps:check`.

**Commit**: `refactor(features): migrate network/guest-wifi config to env registry`

---

## Step 8 — Migrate feature configs, batch C (db / media / misc)

Features: **booth, wakes, weather, weight, events, felogs, deploys, sound,
notif**.
- booth: `DATABASE_URL, MEDIA_STORAGE_DIR`
- wakes: `DATABASE_URL, MEDIA_STORAGE_DIR`
- weather: `DATABASE_URL, HOME_LAT, HOME_LON, HOME_PLACE_NAME`
- weight: `DATABASE_URL`
- events: `DATABASE_URL`
- felogs: `DATABASE_URL`
- deploys: `GITHUB_ACTIONS_TOKEN, GITHUB_REPO, DATABASE_URL`
- sound: `DATABASE_URL, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN`
- notif: `DATABASE_URL, APNS_KEY_ID, APNS_TEAM_ID, APNS_KEY_CONTENT, APNS_BUNDLE_ID, APNS_HOST`

**Verify**: `bun run typecheck`; touched feature tests; `apps:check`; run the
broader `bun run test` for apps/api if fast enough.

**Commit**: `refactor(features): migrate remaining 9 feature configs to env registry`

(After this step: `grep -rn "process.env" features/**/config.ts` returns
nothing.)

---

## Step 9 — Boot each entrypoint via a pinned side-effect `boot-env` import; migrate ALL internal `env` consumers to `config`

**Critical correctness note (why this is NOT an executable `initEnv()` call).**
Feature `deps.ts`/`db.ts`/`service.ts` modules construct pools + HA clients at
*module top* (`features/ac/deps.ts:22-27`, every `features/*/db.ts`,
`apps/api/src/db/index.ts:7`), so the *first lazy access* to
`config.DATABASE_URL`/`HA_TOKEN` happens during the static-import phase — before
any executable statement in `server.ts` runs. Hydration must therefore run as a
**side-effect import placed first**, exactly like the current `import "./env"`
hotfix. Replacing the hotfix with a plain executable `initEnv("api")` first
statement would run it *after* those module-top accesses have already memoized
pre-hydration defaults → the `3db4dde87` prod bug returns (climate/tv/dogcam/booth
500). Spec §5.6.

**Changes**
- New `apps/api/src/boot-env.ts`:
  ```
  import { initEnv } from "@www/platform/env";
  initEnv("api"); // hydrate -> derive DATABASE_URL -> assertEnv, at import time
  ```
- New `apps/worker/src/boot-env.ts`: same, `initEnv("worker")`.
- `apps/api/src/server.ts`: **repoint** the pinned line-7 side-effect import from
  `import "./env"` to `import "./boot-env"` (still the FIRST import, before any
  `@features/*` import — `organizeImports` keeps a bare side-effect import as a
  leading barrier, same as today). Note: `createLogger({ service: "api" })` stays
  at its current executable position (line 26); it does NOT need to precede the
  boot import because `assertEnv` uses its own `createLogger({ service: "env" })`,
  not `getLogger()` (spec §5.5), so the fail-fast fatal works even though it runs
  during import before the app's `createLogger`.
- `apps/worker/src/index.ts`: pin `import "./boot-env"` as the FIRST import
  (before `runMigrations` and any feature import).
- **Migrate all nine `apps/api` `env` consumers** off `import { env } from
  "./env"` to `import { ENV as config } from "@www/platform/env"` and rewrite the
  reads (spec §11 inventory). All nine must be done in THIS step, before Step 10
  deletes `env.ts`:
  1. `apps/api/src/server.ts:17` — `env.PORT/NODE_ENV/GUEST_*` → `config.*`.
  2. `apps/api/src/worker-deps.ts:21` — drop `export { env } from "./env"`
     (nothing should re-export the deleted schema; the worker gets config via
     `@www/platform/env` directly).
  3. `apps/api/src/trpc/routers/health.ts:26` — `env.BUILD_HASH`.
  4. `apps/api/src/integrations/homeassistant/index.ts:12` —
     `env.HA_URL/HA_TOKEN`.
  5. `apps/api/src/db/index.ts:7` — `env.DATABASE_URL` (module-top `createPool`).
  6. `apps/api/src/services/climate-enforcer-service.ts:138,163` —
     `env.CLIMATE_ENTITY_ID`.
  7. `apps/api/src/services/youtube-ingest-service.ts:192` —
     `env.MEDIA_STORAGE_DIR`.
  8. `apps/api/src/services/asc-version-service.ts:56,133,141` —
     `env.ASC_KEY_ID/ASC_ISSUER_ID/ASC_KEY_CONTENT/ASC_APP_ID`. (These are
     `optionalSecret()` → static `string`, so `signAscJwt(...)` still typechecks;
     spec §4 static-type decision — no consumer re-typing needed.)
  9. `apps/api/src/services/weight-service.ts:24` — `env.HA_WEIGHT_ENTITY_ID`.
- `apps/worker/src/index.ts:69,79,170,194` — migrate
  `env.YOUTUBE_INGEST_ENABLED/MEDIA_STORAGE_DIR/NODE_ENV` to `config.*`.
- Grep-confirm the only remaining importers of `./env` are Step-10 test files.

**Why the hotfix line changes but the ordering guarantee does NOT go away**: the
side-effect-import-first mechanism is preserved (just repointed to `boot-env`);
what improves is that boot is now registry-owned, fail-fast (`assertEnv`), and no
longer carries a duplicated Zod schema. Spec §5.6 / §10.

**Verify**: `bun run typecheck` (exit 0 — all nine consumers must compile against
`config`); `apps/api` + `apps/worker` tests; `worker-deps.test.ts` (see Step 10
for its `envSchema` import — if it still imports it here, this step keeps it green
by leaving `env.ts` in place until Step 10). Confirm
`grep -rn 'from "\./env"\|from "\.\./env"' apps/api/src` returns only test files.

**Commit**: `refactor(api,worker): boot via pinned boot-env side-effect import + registry config`

---

## Step 10 — Delete the legacy `apps/api/src/env.ts` schema + fix its test dependents

**Changes**
- Delete `apps/api/src/env.ts` (its schema is now the registry; its hydration
  moved to platform in Step 4). There is **no** exported Zod `envSchema` in the
  registry, so importers of `envSchema` cannot simply be "repointed" — each is
  handled explicitly:
  - `apps/api/src/__tests__/env.test.ts` — **rewrite or delete**. It asserts the
    OLD default behavior the new design intentionally reverses:
    `env.HA_TOKEN).toBe("")`, `env.DATABASE_URL).toBe("postgresql://cc:cc@localhost…")`,
    and `SPOTIFY_* .toBe("")` (lines ~9-24). These assertions are now *wrong by
    design* (fail-fast `required()`; `optionalSecret()` → runtime `undefined`).
    The equivalent coverage already lives in
    `packages/platform/test/env.test.ts` (§8). Delete this file, or replace it
    with a thin api-level boot smoke that imports `boot-env` in a dev-mode env and
    asserts no throw. Do **not** leave it importing `envSchema`.
  - `apps/api/src/__tests__/guest-server.test.ts:7,314` — drop the
    `envSchema.parse({})` usage; construct the guest-server test fixture from
    literal values (or `ENV.pick(...)` for the GUEST_* keys) instead of the
    deleted schema.
  - `apps/api/src/__tests__/worker-deps.test.ts:11,29,34` — same: it calls
    `envSchema.parse({ MEDIA_STORAGE_DIR: ... })`. Repoint to reading
    `config.MEDIA_STORAGE_DIR` from `@www/platform/env` (set/unset via
    `process.env` + `__resetEnvCache()`), or assert against the registry directly.
- **Retarget the `vi.mock("../env")` mocks** that pointed at the deleted module:
  - `apps/api/src/__tests__/asc-version-service.test.ts:39`
    (`vi.mock("../env", () => ({ env: envMock }))`) → `vi.mock("@www/platform/env",
    () => ({ ENV: envMock }))` (match the `import { ENV as config }` used by the
    service after Step 9). Because the shared global `ENV` registry is mocked,
    use a per-test `envMock` object and rely on vitest's module-mock isolation;
    do **not** mutate the real registry cache across tests (would bleed). Prefer
    mocking the whole `@www/platform/env` module (as here) over poking
    `__resetEnvCache()` in these api tests.
  - `apps/api/src/__tests__/youtube-ingest-service.test.ts:106`
    (`vi.mock("../env", …)`) → `vi.mock("@www/platform/env", …)` likewise.
  - Feature tests using `vi.mock("./config")` need **no** change — they replace
    the whole `config` module, so the read-only `pick()` Proxy is never exercised
    in those tests.
- Grep-verify no dangling imports of `./env` / `apps/api/src/env` /
  `envSchema` anywhere.

**Verify**: `bun run typecheck`; full `bun run --filter @control-center/api test`
(env/guest-server/worker-deps/asc/youtube suites green); `apps:check`.

**Commit**: `chore(api): delete legacy env.ts schema (folded into env registry)`

---

## Step 11 — Biome scope change + final sweep

**Changes** (`biome.json`)
- ADD override: `noProcessEnv: off` for `packages/platform/env/**` — use the
  **no-`**/`-prefix** glob style that the neighbouring `packages/platform/**`
  boundary block uses (biome.json:214), i.e. `"packages/platform/env/**"`, not
  `"**/packages/platform/env/**"`, for consistency.
- REMOVE the `features/**/config.ts` override block (biome.json:154-163).
- REMOVE `packages/core/src/db/pool.ts` from the pool/hydrate carve-out
  (`hydrate.ts` no longer exists there; `pool.ts` no longer reads env). Keep
  the logger / build-config / infra / scripts carve-outs.
- **Do NOT touch** the test-file overrides this work does not affect — the core
  pg-contract test carve-out (covers `packages/core/test/pool.test.ts` +
  `integration-sync-pg-contract.test.ts`) and
  `apps/web/src/lib/time-suite/__tests__/alarm-store.test.ts` stay as-is; they
  read `process.env` for unrelated reasons and remain green. If Step 4 left
  `pool.test.ts` reading no `process.env` at all, its override becomes a harmless
  no-op — leave it rather than churn an unrelated block.
- `bun run lint` (mirror CI `biome check .`) — must be clean. Confirm a
  `process.env` in any `features/**/config.ts` would now error (spot-check by
  temporarily adding one, seeing the lint fail, reverting — or reason from the
  removed override).

**Verify**: `bun run lint` clean; `bun run typecheck` exit 0; full test pass;
`bun run apps:check` no drift; `knip` (pre-push) clean.

**Commit**: `chore(biome): sanction platform/env, ban process.env in features`

---

## Post-plan follow-ups (out of scope, note only)

- secretCatalog ↔ registry parity test (spec §7) — feeds the deferred
  `vault.yaml` secrets-cleanup.
- Confirm every prod deploy mounts the Home Location secret before relying on
  `HOME_LAT/LON` being `required()` (spec §11).

---

## Verification matrix

| Concern | Command |
|---------|---------|
| Types | `bun run typecheck` (root, exit 0) |
| Registry unit | `bun run --filter @www/platform test` |
| Order-independence | env.test.ts regression (Step 2 RED → Step 3 GREEN) |
| Feature facets import-safe | `bun run apps:check` |
| Lint / ban | `bun run lint` (`biome check .`) |
| App suites | `bun run --filter @control-center/api test`, worker tests |
| Dead-code | `knip` (pre-push hook) |
