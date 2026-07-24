import { Pool } from "pg";

// DATABASE_URL derivation from the mounted POSTGRES_PASSWORD secret moved to
// @www/platform/env (databaseUrlFromSecret in packages/platform/env/hydrate.ts)
// when the env registry took ownership of env end-to-end (design spec §3).
// pool.ts keeps only the pure connectionString -> Pool factory; it reads no env.
export function createPool(url: string): Pool {
  return new Pool({ connectionString: url });
}
