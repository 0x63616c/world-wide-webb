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
- `packages/platform/env/assert.ts`: `assertEnv(runtime)` (spec §5.5) using
  `getLogger()` + `process.exit`. `initEnv(runtime)` (spec §5.6) =
  hydrate → derive DATABASE_URL → assertEnv.
- Update the ONE current importer `apps/api/src/env.ts` to import
  hydrate/databaseUrlFromSecret from `@www/platform/env` (temporary — env.ts is
  deleted in Step 10).
- `packages/platform/test/env.test.ts`: add `assertEnv` fail-fast, parse-fail,
  and devDefault-gating tests (§8.5–8.7).
- Grep for any other importer of the moved symbols (core tests) and repoint.

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

## Step 9 — Wire entrypoints to `initEnv` + `config`; retire the hotfix

**Changes**
- `apps/api/src/server.ts`: replace the bare `import "./env"` (line 7 hotfix)
  with an explicit `initEnv("api")` as the FIRST executable statement. Replace
  `import { env } from "./env"` with `import { ENV as config } from
  "@www/platform/env"` (or keep an `env` alias re-export from a thin module).
  Migrate `env.PORT/NODE_ENV/GUEST_*` call sites to `config.*`.
- `apps/worker/src/index.ts`: call `initEnv("worker")` first thing (before
  `runMigrations`). Migrate `env.YOUTUBE_INGEST_ENABLED/MEDIA_STORAGE_DIR/
  NODE_ENV` reads to `config.*` from `@www/platform/env`.
- `apps/api/src/worker-deps.ts`: repoint `export { env } from "./env"` to the
  registry (or drop it and have the worker import `@www/platform/env` directly).
- Confirm no other module imports `apps/api/src/env`'s `env` (grep).

**Why the hotfix can go**: lazy config makes feature-import-order irrelevant,
and `initEnv` still hydrates at boot before any request — so the ordering the
`import "./env"` line enforced no longer matters. This satisfies the spec's
condition for removing the band-aid (registry provably makes ordering
irrelevant AND boot-time hydration preserved).

**Verify**: `bun run typecheck`; `apps/api` + `apps/worker` tests;
`worker-deps.test.ts`; a manual boot smoke if available. Confirm
`grep -n 'import "./env"' apps/api/src/server.ts` is gone.

**Commit**: `refactor(api,worker): boot via initEnv + registry config, retire env hotfix`

---

## Step 10 — Delete the legacy `apps/api/src/env.ts` schema

**Changes**
- Delete `apps/api/src/env.ts` (its schema is now the registry; its hydration
  moved to platform). If any residual (e.g. `envSchema` type) is imported
  elsewhere, repoint to the registry first.
- Grep-verify no dangling imports of `./env` / `apps/api/src/env`.

**Verify**: `bun run typecheck`; full `bun run test` for api; `apps:check`.

**Commit**: `chore(api): delete legacy env.ts schema (folded into env registry)`

---

## Step 11 — Biome scope change + final sweep

**Changes** (`biome.json`)
- ADD override: `noProcessEnv: off` for `packages/platform/env/**`.
- REMOVE the `features/**/config.ts` override block (~153-162).
- REMOVE `packages/core/src/db/pool.ts` from the pool/hydrate carve-out
  (`hydrate.ts` no longer exists there; `pool.ts` no longer reads env). Keep
  the logger / build-config / infra / scripts carve-outs.
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
