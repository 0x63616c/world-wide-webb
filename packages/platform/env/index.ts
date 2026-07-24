/**
 * `@www/platform/env` — the ONE central env/config registry.
 *
 * Declares every env key once (`registry.ts`), reads the hydrated `process.env`
 * lazily on first access (order-independent), owns secret-file hydration
 * (`hydrate.ts`), and fail-fast validates required prod secrets at boot
 * (`assert.ts` / `initEnv`). See docs/superpowers/specs/2026-07-23-env-config-registry-design.md.
 */

export { assertEnv, type BootRuntime, initEnv } from "./assert";
export {
  bool,
  enumOf,
  FieldBuilder,
  int,
  num,
  pgUrl,
  type Runtime,
  secret,
  str,
  url,
} from "./fields";
export { databaseUrlFromSecret, hydrateSecretFiles } from "./hydrate";
export { ENV } from "./manifest";
export { __resetEnvCache, defineEnv, type Registry } from "./registry";
