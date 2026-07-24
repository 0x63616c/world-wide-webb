/**
 * api boot side-effect: hydrate `/run/secrets/*` into `process.env`, derive
 * `DATABASE_URL`, then fail-fast validate required prod env — all at module-eval.
 *
 * This MUST be the FIRST import in `server.ts`, before any `@features/*` import.
 * Feature `deps.ts`/`db.ts` modules construct pools + HA clients at module top,
 * so the first lazy `config.X` read happens during the static-import phase; if
 * hydration ran later (an executable `initEnv()` statement) those reads would
 * memoize pre-hydration defaults and 500 in prod (the 3db4dde87 bug). A pinned
 * side-effect import is the only mechanism that runs before feature imports.
 * Biome's organizeImports keeps a bare side-effect import as a leading barrier.
 * See design spec §5.6.
 */
import { initEnv } from "@www/platform/env";

initEnv("api");
