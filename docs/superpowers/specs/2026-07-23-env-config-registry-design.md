# Central Env/Config Registry — Design Spec

Date: 2026-07-23
Status: Design (no code yet)
Fixes: import-order config bug hotfixed in `3db4dde87` (bare `import "./env"`
pinned atop `apps/api/src/server.ts`). This design makes that hotfix
unnecessary.

---

## 1. The bug this fixes

16 feature `config.ts` files each run `z.object({...}).parse(process.env)` at
**module-eval time**. `apps/api/src/server.ts` imported feature modules
(`@features/ac/service`, `@features/booth/service`, …) via its import graph
*before* `./env` ran its `hydrateSecretFiles()` side effect. Those features
therefore parsed an **un-hydrated** `process.env` and baked in schema DEFAULTS:
empty `HA_TOKEN`, localhost `DATABASE_URL`. In prod this produced silent-wrong
behavior — climate/wakes/booth/tv tiles 500ed against real `/run/secrets`
because the feature's own HA client and DB pool had frozen the placeholder
values at import.

The values that broke were **valid-but-wrong defaults**: `""` and
`postgresql://cc:cc@localhost:5432/controlcenter` pass Zod validation, pass CI
green, and only fail against the real secret mount in prod.

### Root defect (three compounding faults)

1. **Import-time reads of mutable global state.** Config parses `process.env`
   at import, when that state is hydrated *late* (after the secret files are
   read into `process.env`). Any import-order change re-breaks it.
2. **Decentralized re-declaration.** 16 schemas hand-copy shared keys
   (`DATABASE_URL` appears in 11 configs, `HA_URL`/`HA_TOKEN` in 5, the
   `UNIFI_*` trio in 2, `HOME_*` in 2) each with its own hand-synced default
   comment ("copied verbatim from apps/api/src/env.ts to stay in lockstep").
3. **Silent-wrong defaults.** A missing prod secret falls back to a default
   that *looks* configured, so the failure surfaces as a runtime 500, never as
   a boot crash.

---

## 2. Goals (all four required)

| # | Goal | How this design meets it |
|---|------|--------------------------|
| 1 | **Fail-fast on missing secrets** | Prod-required keys are declared `.required()` with **no valid-but-wrong default** (an optional `.devDefault()` covers local dev only). `assertEnv(runtime)` runs at boot, after hydration, and `process.exit(1)` with a structured log listing every missing key when `APP_ENV==="production"`. The band-aid becomes a real guard. |
| 2 | **One place to see all env** | A single `defineEnv({...})` manifest in `packages/platform/env/registry.ts` declares every key once — name, type, requiredness, owning runtime(s), owning feature. Answers "what does prod need" in one file and cross-checks against the existing `secretCatalog` (§7), feeding the deferred `vault.yaml` cleanup. |
| 3 | **Order-independent (lazy)** | Config values are read from the hydrated `process.env` on **first property access**, memoized thereafter — never at import. Import order can no longer freeze a value, in any entrypoint. Proven by a regression test that imports a feature config *before* hydration and asserts it still reads the hydrated value (§8). |
| 4 | **No duplicated defaults** | Each key — shared or feature-owned — is declared exactly once in the registry. Feature configs become typed *projections* (`ENV.pick(...)`), never re-declarations. |

---

## 3. Layering decision

Current facts (verified):

- `packages/platform` has **zero runtime dependencies** (only devDeps). It is
  the lowest shared-substrate layer.
- `packages/core` depends on `@www/logger`, `@www/worker-runtime`, `drizzle`,
  `pg`. Neither `platform` nor `core` imports the other today.
- `hydrateSecretFiles()` (`packages/core/src/secrets/hydrate.ts`) and
  `databaseUrlFromSecret()` (`packages/core/src/db/pool.ts`) are called **only**
  by `apps/api/src/env.ts`. `createPool()` (also in `pool.ts`) is called by
  `core` itself and by several feature `db.ts` files.
- Features already import `@www/core` and `@www/logger` as workspace packages,
  so they can import `@www/platform` the same way (no packaging change needed).
- Biome's dependency-boundary rule (`biome.json` override ~215) bans
  `platform` + `core` from importing `app-kit`/`features`; it says nothing about
  `platform ↔ core`.

**Decision: the registry lives in `packages/platform/env/` and platform owns
hydration end-to-end.** `hydrateSecretFiles()` and `databaseUrlFromSecret()`
**move into `packages/platform/env/hydrate.ts`**. `packages/core/src/db/pool.ts`
keeps only `createPool()` (a pure `connectionString → Pool` factory with no env
read). Nothing in `core` calls `databaseUrlFromSecret()`, so this move creates
**no** `platform → core` edge and inverts no layer. Platform stays
dependency-light and becomes the single owner of env: declaration + hydration +
validation + access.

Rejected alternative: keep hydration in `core` and have `platform/env` import
`@www/core`. This adds a heavy `platform → core` runtime edge (pulling logger,
worker-runtime, drizzle, pg into the base layer) and inverts the intuitive
layering. Worse on every axis.

One dependency the registry *does* take: `@www/logger` (for the fail-fast log
line). `platform → logger` is a clean downward edge (`logger` imports nothing of
ours), matching `core → logger`. Add `@www/logger` to `packages/platform`
`dependencies`.

---

## 4. Complete env-key inventory

Requiredness tiers used below:

- **required** — must be present in prod. `assertEnv("production")` crashes if
  missing. No prod default. May carry a `devDefault` used only when
  `APP_ENV!=="production"` (keeps local dev booting without leaking a real
  value into the repo).
- **optional-secret** — a secret with **no default**; resolves to `undefined`
  when absent (not `""`). The owning feature's `isConfigured()` gate no-ops the
  feature. Honest replacement for today's `.default("")`.
- **default** — safe, public, non-secret default; identical in every env.
- **optional** — may be absent anywhere → `undefined`.

Secret? column marks values that must never be logged (aligned with the logger
redaction list) and that ride the `/run/secrets` docker-secret mount.

| Key | Type | Tier | Prod default / devDefault | Secret? | Runtime(s) | Feature/owner |
|-----|------|------|---------------------------|---------|------------|---------------|
| `NODE_ENV` | enum(dev/prod/test) | default | `development` | | all | infra |
| `APP_ENV` | str | default | `development` | | all | logger (carve-out, §6) |
| `LOG_LEVEL` | str | optional | — | | all | logger (carve-out) |
| `LOG_PRETTY` | bool-ish | optional | — | | all | logger (carve-out) |
| `PORT` | int | default | `4201` | | api | api server |
| `BUILD_HASH` | str | default | `dev` | | all | api/web |
| `DATABASE_URL` | pgUrl | **required** | devDefault `postgresql://cc:cc@localhost:5432/controlcenter` | ✅ | all | core/db (11 features) |
| `HA_URL` | url | default | `http://homeassistant.local:8123` | | all | ac, ctrl, dogcam, tesla, tv |
| `HA_TOKEN` | secret | **required** | — | ✅ | all | ac, ctrl, dogcam, tesla, tv |
| `CLIMATE_ENTITY_ID` | str | default | `climate.home` | | api | ac |
| `HA_WEIGHT_ENTITY_ID` | str | default | `sensor.renpho_scale_weight` | | worker | weight |
| `UNIFI_API_KEY` | secret | **required** | — | ✅ | api | network, guest-wifi |
| `UNIFI_CONTROLLER_URL` | url | default | `https://192.168.0.1` | | api | network, guest-wifi |
| `UNIFI_SITE_ID` | str | default | `default` | | api | network, guest-wifi |
| `WIFI_SSID` | secret | **required** | — | ✅ | api | network |
| `WIFI_PASSWORD` | secret | **required** | — | ✅ | api | network, guest-wifi |
| `WIFI_GUEST_SSID` | secret | **required** | — | ✅ | api | network |
| `HOME_LAT` | num | **required** | devDefault `34.0537` (LA City Hall) | ✅ | all | tesla, weather |
| `HOME_LON` | num | **required** | devDefault `-118.2428` | ✅ | all | tesla, weather |
| `HOME_PLACE_NAME` | str | default | `Home` | ✅ | all | tesla, weather |
| `HOME_RADIUS_MILES` | num | default | `1` | ✅ | api | tesla |
| `TESLA_ENTITY_PREFIX` | str | default | `evee` | | api | ac, tesla |
| `MEDIA_STORAGE_DIR` | str | default | `/mnt/media` | | worker, api | booth, wakes, worker |
| `YOUTUBE_INGEST_ENABLED` | bool | default | `false` | | worker | sound/media |
| `SPOTIFY_CLIENT_ID` | secret | optional-secret | — | ✅ | api | sound |
| `SPOTIFY_CLIENT_SECRET` | secret | optional-secret | — | ✅ | api | sound |
| `SPOTIFY_REFRESH_TOKEN` | secret | optional-secret | — | ✅ | api | sound |
| `ASC_KEY_ID` | secret | optional-secret | — | ✅ | worker | worker/asc-poll |
| `ASC_ISSUER_ID` | secret | optional-secret | — | ✅ | worker | worker/asc-poll |
| `ASC_KEY_CONTENT` | secret | optional-secret | — | ✅ | worker | worker/asc-poll |
| `ASC_APP_ID` | str | default | `6762095888` | | worker | worker/asc-poll |
| `GITHUB_ACTIONS_TOKEN` | secret | optional-secret | — | ✅ | worker | deploys |
| `GITHUB_REPO` | str | default | `0x63616c/world-wide-webb` | | worker | deploys |
| `APNS_KEY_ID` | secret | optional-secret | — | ✅ | worker | notif |
| `APNS_TEAM_ID` | secret | optional-secret | — | ✅ | worker | notif |
| `APNS_KEY_CONTENT` | secret | optional-secret | — | ✅ | worker | notif |
| `APNS_BUNDLE_ID` | str | default | `co.worldwidewebb.theworkflowengine` | | worker | notif |
| `APNS_HOST` | url | default | `https://api.push.apple.com` | | worker | notif |
| `GO2RTC_URL` | url | default | `http://go2rtc:1984` | | api | dogcam |
| `CAMERA_STREAM_NAME` | str | default | `bedroom_mjpeg` | | api | dogcam |
| `CAMERA_LABEL` | str | default | `Living Room Cam` | | api | dogcam |
| `GUEST_PORT` | int | optional | — | | api | api/guest-server |
| `GUEST_TLS_DIR` | str | optional | — | | api | api/guest-server |
| `GUEST_STATIC_DIR` | str | optional | — | | api | api/guest-server |
| `GUEST_HTTP_PORT` | int | optional | — | | api | api/guest-server |

### Hydration inputs (not typed registry keys)

`databaseUrlFromSecret()` consumes these to **derive** `DATABASE_URL`; they are
inputs to hydration, not values the app reads through the registry. They stay
inside `packages/platform/env/hydrate.ts` (which retains its `process.env`
carve-out), not the manifest:

- `POSTGRES_PASSWORD` — the mounted secret file (deny-listed from `process.env`
  by `hydrateSecretFiles`, read from its file to build the URL). Required in
  prod *transitively*: if absent, `DATABASE_URL` is undefined and the
  `DATABASE_URL` required-check fires.
- `POSTGRES_PASSWORD_FILE` (default `/run/secrets/POSTGRES_PASSWORD`),
  `POSTGRES_HOST` (`postgres`), `POSTGRES_PORT` (`5432`), `POSTGRES_USER`
  (`postgres`), `POSTGRES_DB` (`control_center`).

### Note on the `required` set vs. the docker-secret mount

The `secretCatalog` in `packages/platform/src/index.ts` mounts ~20 secrets for
both api and worker. Not all are hard-required: `SPOTIFY_*`, `ASC_*`, `APNS_*`,
`GITHUB_ACTIONS_TOKEN` are **optional-secret** — their features self-disable
cleanly (`isConfigured()` / `isApnsConfigured()` gates), so a missing mount is a
degraded feature, not a broken app, even in prod. The **required** set is the
narrow group whose absence in prod is either a hard failure or a silent-wrong
default that the bug exploited: `DATABASE_URL`, `HA_TOKEN`, `UNIFI_API_KEY`,
`WIFI_SSID`, `WIFI_PASSWORD`, `WIFI_GUEST_SSID`, `HOME_LAT`, `HOME_LON`. These
get the fail-fast boot check.

---

## 5. Components & interfaces

All under `packages/platform/env/`, exported from a new subpath
`@www/platform/env` (add to `packages/platform/package.json` `exports`).

### 5.1 Field builders (`fields.ts`)

Thin wrappers over Zod that carry registry metadata. Each returns a
`FieldSpec<T>`:

```
str()      → string
url()      → string, validated as URL
pgUrl()    → string, validated as postgres URL
num()      → number (coerced)
int()      → integer (coerced)
bool()     → boolean ("true"/"1" → true)
secret()   → string, flagged secret:true (never logged; feeds redaction audit)
enumOf(a,b,c) → union
```

Chainable on every builder:

```
.required()        // must exist in prod; assertEnv enforces; no prod default
.default(v)        // optional; same value every env
.devDefault(v)     // fallback ONLY when APP_ENV!=="production"; still prod-required
.optional()        // may be absent anywhere → undefined
.forRuntime(...r)  // "api" | "worker" | "web" | "all"  (default "all")
.forFeature(id)    // owning feature id, documentation + query grouping
```

`FieldSpec` shape (internal): `{ parse(raw): T, required: boolean,
runtimes: Runtime[], feature?: string, secret: boolean, hasDefault: boolean,
devDefault?: T, prodDefault?: T }`.

### 5.2 The manifest (`registry.ts`)

```
export const ENV = defineEnv({
  DATABASE_URL: pgUrl().required().devDefault("postgresql://cc:cc@localhost:5432/controlcenter"),
  HA_URL: url().default("http://homeassistant.local:8123"),
  HA_TOKEN: secret().required().forFeature("ac"),
  CLIMATE_ENTITY_ID: str().default("climate.home").forRuntime("api").forFeature("ac"),
  SPOTIFY_CLIENT_ID: secret().optionalSecret().forRuntime("api").forFeature("sound"),
  // ... every key from §4, declared exactly once ...
});
```

`defineEnv(spec)` returns a **lazy, memoized, typed accessor** `ENV`.
`typeof ENV` is a mapped type `{ readonly [K in keyof spec]: TypeOf<spec[K]> }`
(where an `.optional()`/`optional-secret` field widens to `T | undefined`).

### 5.3 Lazy access mechanism — **Proxy** (decision)

`ENV` is a `Proxy` over an empty target with a `get` trap:

1. On `ENV.HA_TOKEN`: if the key is cached, return it.
2. Else look up the `FieldSpec`, read `process.env["HA_TOKEN"]` (already
   hydrated), apply parse / default / devDefault / required-missing rules,
   cache the result in a module `Map`, return it.

Chosen over a plain object of `Object.defineProperty` getters because:

- **`pick()` projections need it anyway.** A feature config is
  `ENV.pick("DATABASE_URL","HA_URL","HA_TOKEN")` — an arbitrary subset with
  ergonomic `config.HA_TOKEN` access and correct per-key types. A Proxy with a
  `get` trap that validates the key is in the picked set and delegates to the
  shared cache is the cleanest projection; a getter-object would need to
  re-define getters per projection.
- **O(1) construction, no eager enumeration** — matters under the 10x–100x
  key-count invariant. Nothing is parsed until touched.
- Ergonomic `config.X` (not `config().X`) call sites are preserved — a hard
  requirement to keep the migration mechanical.

The static type is supplied by casting the Proxy to the mapped type; TypeScript
sees a fully-typed object, the runtime is the trap. `has`/`ownKeys` traps are
implemented so `"KEY" in ENV` and enumeration work for tooling.

A single module-level `Map<string, unknown>` backs both `ENV` and every
`pick()` view, so a key parsed once is shared. `__resetEnvCache()` (test-only,
underscore-prefixed) clears it between test cases.

### 5.4 `pick()`

```
pick<K extends keyof Spec>(...keys: K[]): { readonly [P in K]: TypeOf<Spec[P]> }
```

Returns a Proxy whose `get` trap throws if the accessed key is not in `keys`
(so a feature can't silently reach a key it didn't declare), else delegates to
the shared cache. This is what every feature `config.ts` becomes:

```
// features/ac/config.ts
import { ENV } from "@www/platform/env";
export const config = ENV.pick("DATABASE_URL", "HA_URL", "HA_TOKEN", "CLIMATE_ENTITY_ID", "TESLA_ENTITY_PREFIX");
```

No Zod, no `process.env`, no duplicated defaults, no import-time parse.

### 5.5 `assertEnv(runtime)` — the fail-fast guard

```
assertEnv(runtime: "api" | "worker"): void
```

- No-op unless `process.env.APP_ENV === "production"` (read live — never the
  bundle-baked `NODE_ENV`, per the logger's `www-rw07` lesson). Dev/test boot
  unchanged.
- Iterates every `FieldSpec` where `required === true` and the runtime is in
  `runtimes` (or `runtimes` includes `"all"`).
- Collects keys whose hydrated `process.env` value is absent or empty.
- If the missing list is non-empty: `getLogger().fatal({ missingKeys, runtime },
  "required env missing — refusing to boot")` then `process.exit(1)`. Loud,
  structured, lists every missing key at once (not one-at-a-time).
- Also validates that present required keys *parse* (e.g. `DATABASE_URL` is a
  valid pg URL), surfacing a malformed secret as a boot crash too.

### 5.6 `initEnv(runtime)` — the boot entry

```
initEnv(runtime: "api" | "worker"): void
```

The single call each entrypoint makes first thing:

1. `hydrateSecretFiles()` — read `/run/secrets/*` into `process.env`.
2. `const url = databaseUrlFromSecret(); if (url) process.env.DATABASE_URL = url;`
3. `assertEnv(runtime)`.

After `initEnv`, `process.env` is fully hydrated and validated; every
subsequent lazy `config.X` read is correct regardless of when the config module
was imported.

### 5.7 `hydrate.ts`

`hydrateSecretFiles()` and `databaseUrlFromSecret()` move here verbatim from
`packages/core`. Behavior unchanged (listless `/run/secrets` hydration,
`POSTGRES_PASSWORD` deny-list, explicit-env-wins). This file keeps a
`process.env` Biome carve-out (it is the hydration boundary).

---

## 6. Biome enforcement

`noProcessEnv` is **already a global `style` rule at `error`** (biome.json:45).
The ban exists; this work adjusts its scope. Two carve-out mechanisms are
already in use and both are kept:

- **Override blocks** (biome.json `overrides`): api/env.ts, drizzle.config,
  vite.config, e2e-portal, scripts, `packages/logger/src`, infra/unifi, core
  pg-contract tests, `packages/core/src/db/pool.ts` + `secrets/hydrate.ts`, and
  `features/**/config.ts`.
- **Inline `// biome-ignore lint/style/noProcessEnv`** — capacitor.config.ts,
  infra/src/vault.ts.

Changes for this work:

1. **Add** an override turning `noProcessEnv` off for
   `packages/platform/env/**` — the ONE sanctioned place that reads
   `process.env` (registry + hydration).
2. **Remove** the `features/**/config.ts` override (biome.json ~153-162) once
   all 16 features are migrated. After migration no feature config reads
   `process.env`; deleting the carve-out makes a regression *unshippable* — a
   new feature that reaches for `process.env` fails lint. This is the
   enforcement teeth, mirroring the sound-bus `AudioContext` ban.
3. **Update** the existing `packages/core/src/db/pool.ts` +
   `secrets/hydrate.ts` override: `hydrate.ts` moves to platform (covered by
   #1); `pool.ts` no longer reads `process.env` once `databaseUrlFromSecret`
   moves out, so drop `pool.ts` from the carve-out (or leave it harmless — the
   plan removes it for cleanliness).

**Legitimate lower-layer / build-time carve-outs that stay:**

- `packages/logger/src/**` — the logger is the lowest layer and deliberately
  reads `APP_ENV`/`LOG_LEVEL`/`LOG_PRETTY` live (it cannot depend on the
  registry; the registry depends on *it*). `APP_ENV`/`LOG_*` are listed in the
  manifest §4 as documentation only; the logger keeps reading them directly.
- `apps/api/drizzle.config.ts`, `apps/web/vite.config.ts`,
  `apps/web/capacitor.config.ts`, `apps/web/e2e-portal/playwright.config.ts` —
  build-time / tooling configs that run outside the app runtime.
- `scripts/**`, `infra/**` (unifi override + inline ignores in vault.ts) —
  Pulumi / one-shot tooling, not the app runtime.

---

## 7. Relationship to `secretCatalog` (goal 2 payoff)

`packages/platform/src/index.ts` already declares `secretCatalog` +
`controlCenterServiceSecretUsages()` — the **infra** view of which secrets each
service's `/run/secrets` mount receives, keyed to SOPS vault keys. The registry
is the **runtime** view of the same secrets plus all the non-secret config.

They must not drift. Because both now live in `packages/platform`, a small
consistency test can assert: every registry key tagged `secret` + `required`
(or `optional-secret`) has a matching `secretCatalog` entry, and vice versa.
This is the single source of truth that feeds the deferred `vault.yaml`
secrets-cleanup (memory: `secrets-cleanup-after-track-c`). The test is
**recommended, not required** for this work — noted as a follow-up so the two
manifests are provably in sync.

---

## 8. Testing

`packages/platform/test/env.test.ts` (vitest, matching platform's existing test
layout):

1. **Order-independence regression (the headline test, TDD-first, must fail
   before the lazy Proxy exists).**
   - Arrange: ensure `process.env.HA_TOKEN` is unset/empty.
   - Import a config that picks `HA_TOKEN` (or `ENV` directly). Assert the
     import itself does **not** throw and does **not** freeze a value.
   - Set `process.env.HA_TOKEN = "real-token-xyz"` (simulating late
     hydration).
   - Access `config.HA_TOKEN`. Assert `=== "real-token-xyz"`.
   - This reproduces the exact bug: module imported before hydration, value
     still correct. Against today's eager `parse(process.env)` it would return
     `""`.
2. **Field builders**: each of str/url/pgUrl/num/int/bool/secret parses and
   rejects correctly; `.default`/`.devDefault`/`.required`/`.optional`
   semantics.
3. **Memoization**: second access returns cached value; `__resetEnvCache()`
   forces a re-read.
4. **`pick()` isolation**: accessing a key not in the picked set throws;
   accessing a picked key returns the shared cached value.
5. **`assertEnv` fail-fast**: with `APP_ENV="production"` and a required key
   absent, `assertEnv("api")` calls `process.exit` (spied) and logs the missing
   key. With the key present it is a no-op. With `APP_ENV` unset (dev), missing
   required keys do **not** exit.
6. **`assertEnv` parse failure**: a present-but-malformed `DATABASE_URL` in prod
   mode fails the boot check.
7. **`devDefault` gating**: `HOME_LAT` unset + `APP_ENV!=="production"` →
   `34.0537`; unset + `APP_ENV="production"` → `assertEnv` exits (no silent LA
   City Hall in prod).
8. **secretCatalog parity** (recommended follow-up, §7).

Existing suites that must stay green: `apps/api` tests (env/server),
`apps/api/src/__tests__/worker-deps.test.ts`, `packages/core` db/hydrate tests
(update import paths), every feature's own tests, `apps:check` codegen (imports
the branded facets — must not throw at import, which the lazy config guarantees
even more strongly than today).

---

## 9. Fail-fast behavior summary

| Situation | Today | After |
|-----------|-------|-------|
| Prod, `HA_TOKEN` secret unmounted | features bake `""`, tiles 500 per-request | `assertEnv("api")` logs `{missingKeys:["HA_TOKEN"]}` + `exit(1)` at boot; deploy crash-loops visibly instead of serving broken tiles |
| Prod, `DATABASE_URL` underivable (no `POSTGRES_PASSWORD` mount) | localhost default → connection errors | boot crash listing `DATABASE_URL` |
| Dev, no secrets mounted | works via defaults | works via `devDefault` / defaults; `assertEnv` no-op (`APP_ENV!=="production"`) |
| Feature imported before hydration | value frozen to default (the bug) | value read lazily post-hydration; correct |
| New feature reaches for `process.env` | allowed (carve-out) | Biome lint error (carve-out removed) |

---

## 10. Migration approach

Incremental, each slice independently committable + verifiable (see the plan
doc). Order: scaffold registry + fields + tests (regression test RED first) →
lazy Proxy + pick + memoization (regression GREEN) → move hydration into
platform + `assertEnv`/`initEnv` → populate the full manifest → migrate the 16
feature configs in batches (grouped by shared-key cluster) → migrate
`apps/api` + `apps/worker` entrypoints to `initEnv` + `config`, retire the
`import "./env"` hotfix → Biome scope change (add platform/env carve-out, remove
features carve-out) → delete the now-empty `apps/api/src/env.ts` schema, final
verify.

The api hotfix stays in place until the entrypoint is wired to `initEnv` and
the lazy config proves import order irrelevant; only then is the bare
`import "./env"` line replaced by an explicit `initEnv("api")` boot call
(retiring the band-aid without a coverage gap).

---

## 11. Risks

- **Shared checkout / parallel sessions.** ~8–10 sessions push `main`. The
  16-file config migration touches many files; stage explicit paths, never
  `git add -A`, `git show --stat HEAD` after each commit, rebase-autostash
  before each push. Batch feature migrations so each commit is small and
  independently green.
- **`worker` env import path.** The worker imports `env` via
  `@control-center/api/worker` (`worker-deps.ts` re-exports `./env`). After
  migration the worker must call `initEnv("worker")` itself and read
  `config` — verify `worker-deps.ts`'s `export { env }` is repointed or the
  worker imports `@www/platform/env` directly. Missing this re-breaks worker
  hydration order.
- **`env.*` call-site surface.** `server.ts` and the worker read `env.PORT`,
  `env.NODE_ENV`, `env.GUEST_*`, `env.MEDIA_STORAGE_DIR`,
  `env.YOUTUBE_INGEST_ENABLED`. All must migrate to `config.*`. A missed site
  that still imports the deleted `env` fails typecheck (caught pre-push).
- **Proxy vs. static typing.** The `as` cast to the mapped type is the only
  unsound spot; the field-builder tests + a couple of `expectTypeOf` assertions
  pin the inferred types so a wrong builder return can't silently widen.
- **`devDefault` for `HOME_LAT`/`HOME_LON`.** Promoting these to `required()`
  means prod now crashes if the Home Location secret is unmounted (previously it
  silently showed LA City Hall). This is the intended fail-fast, but it is a
  behavior change for any prod deploy currently relying on the placeholder —
  confirm the Home Location secret is mounted in prod before shipping the
  entrypoint wiring (it is, per `secretCatalog.homeLocation` in the api/worker
  mount).
- **`assertEnv` prod-gating correctness.** Relies on `APP_ENV="production"`
  being set in prod (verified: infra/src/services.ts:137-138). If a future
  runtime forgets to set it, `assertEnv` silently no-ops. The secretCatalog
  parity test (§7) is the backstop.
- **Bun `NODE_ENV` inlining.** Never gate registry behavior on `NODE_ENV`
  (bundle-baked). Use live `APP_ENV`. Same trap that crash-looped prod in
  `www-rw07`.
