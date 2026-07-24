/**
 * worker boot side-effect: hydrate `/run/secrets/*` into `process.env`, derive
 * `DATABASE_URL`, then fail-fast validate required prod env — all at module-eval.
 *
 * MUST be the FIRST import in `index.ts`, before `runMigrations` or any feature
 * import, for the same reason as the api's boot-env (design spec §5.6).
 */
import { initEnv } from "@www/platform/env";

initEnv("worker");
