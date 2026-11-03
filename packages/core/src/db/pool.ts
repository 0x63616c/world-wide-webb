import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// DATABASE_URL derivation from the mounted POSTGRES_PASSWORD secret moved to
// @www/platform/env (databaseUrlFromSecret in packages/platform/env/hydrate.ts)
// when the env registry took ownership of env end-to-end (design spec §3).
// pool.ts keeps only the pure connectionString -> Pool factory; it reads no env.
export function createPool(url: string): Pool {
  const pool = new Pool({
    connectionString: url,
    max: MAX_POOL_CONNECTIONS,
    // Without these, node-postgres waits forever for a connection and keeps
    // dead sockets in the pool: on Oct 27 2026 the api hung for ~10 hours
    // ("Connection terminated unexpectedly", Postgres "canceling authentication
    // due to timeout") and every request 502'd until the pod was restarted.
    connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
    // Server-side cap so one stuck query can't hold a pooled client forever.
    statement_timeout: POOL_STATEMENT_TIMEOUT_MS,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    keepAlive: true,
  });
  // An idle client dying (Postgres restart, network blip) emits `error` on the
  // pool; unhandled, that crashes the process. The pool already discards the
  // client, so just record it.
  pool.on("error", (err) => {
    console.error("pg pool idle client error", err);
  });
  return pool;
}

/** Fail a checkout after 5s instead of queueing forever. */
export const POOL_CONNECTION_TIMEOUT_MS = 5_000;
/** Postgres cancels any single statement that runs longer than 60s. */
export const POOL_STATEMENT_TIMEOUT_MS = 60_000;
/** Recycle idle clients so a half-dead socket is not reused hours later. */
export const POOL_IDLE_TIMEOUT_MS = 30_000;

// One shared pool serves the consolidated www process. PostgreSQL is dedicated
// to Control Center in deploy/mini/compose.yaml; Hindsight has its own database.
// Keep node-postgres's default of ten connections, leaving capacity for backups
// and manual maintenance. Reassess the budget before adding process replicas.
export const MAX_POOL_CONNECTIONS = 10;

/** The handle `createFeatureDb` returns: a drizzle db plus its underlying `pg.Pool` via `$client`. */
export type FeatureDb<TSchema extends Record<string, unknown>> = NodePgDatabase<TSchema> & {
  $client: Pool;
};

const poolsByUrl = new Map<string, FeatureDb<Record<string, unknown>>>();

/**
 * Returns the process-wide drizzle handle for `url`, creating and memoizing
 * the underlying `pg.Pool` on first call. Every feature's `db.ts` (and
 * apps/api's own db module) call this instead of constructing their own
 * `Pool`, so a single process holds exactly one pool per distinct connection
 * string no matter how many features it imports — not one pool per feature.
 *
 * Correctness of the memoization depends on every caller's `url` for the
 * same physical database resolving to the identical string (same
 * host/db/user); in this repo that's guaranteed by every feature and
 * apps/api sourcing `DATABASE_URL` from the single shared env registry key
 * (packages/platform/env/manifest.ts), not a per-feature slice. A future
 * per-feature database split would need to revisit this precondition.
 *
 * The generic `schema` type is per-call-site only — the runtime cache is
 * keyed purely by `url`, so the first caller for a given URL determines the
 * pool's lifecycle and every later caller with that same URL gets back a
 * handle typed against its own `schema` argument over the same pool.
 */
export function createFeatureDb<TSchema extends Record<string, unknown>>(
  url: string,
  schema: TSchema,
): FeatureDb<TSchema> {
  const cached = poolsByUrl.get(url);
  if (cached) return cached as FeatureDb<TSchema>;

  const db = drizzle(createPool(url), { schema });
  poolsByUrl.set(url, db as FeatureDb<Record<string, unknown>>);
  return db;
}
