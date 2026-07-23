/**
 * Env-gated: runs the full `IntegrationSyncStore` contract against a real pg
 * adapter over `CORE_PG_TEST_URL`. CI does not set this var (skipped there);
 * point it at a local Tilt Postgres to run it:
 * `CORE_PG_TEST_URL=postgres://... bun run test`.
 *
 * Isolation comes from a throwaway Postgres SCHEMA (namespace) per run — the
 * pool's `search_path` is pinned to it, so the unqualified `integration_sync_status`
 * table name resolves inside that private namespace instead of the real one.
 */
import { runIntegrationSyncStoreContract } from "@www/core/testing/integration-sync";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe } from "vitest";

import { createPgIntegrationSyncStore } from "../src/integration-sync/pg";
import * as schema from "../src/integration-sync/schema";
import { ddlForTable } from "./schema-ddl";

const url = process.env.CORE_PG_TEST_URL;

describe.skipIf(!url)("pg contract", () => {
  const namespace = `core_pg_isync_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

  // biome-ignore lint/style/noNonNullAssertion: describe.skipIf(!url) guards this block
  const pool = new Pool({ connectionString: url!, options: `-c search_path=${namespace},public` });
  const db = drizzle(pool, { schema });

  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${namespace}"`);
    await pool.query(ddlForTable(schema.integrationSyncStatus, namespace));
  });

  afterEach(async () => {
    await pool.query(`TRUNCATE TABLE "${namespace}".integration_sync_status`);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    await pool.end();
  });

  runIntegrationSyncStoreContract(() => createPgIntegrationSyncStore(db));
});
