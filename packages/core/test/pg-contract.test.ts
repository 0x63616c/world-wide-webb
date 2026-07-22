/**
 * Env-gated: runs the full `DeviceStateStore` contract against a real pg
 * adapter over `CORE_PG_TEST_URL`. CI does not set this var (skipped there);
 * point it at a local Tilt Postgres to run it: `CORE_PG_TEST_URL=postgres://... bun run test`.
 *
 * The adapter under test always queries the real `deviceState` table from
 * `../src/device-state/schema` (it isn't table-name-parameterized), so
 * isolation comes from a throwaway Postgres SCHEMA (namespace) per run — the
 * pool's `search_path` is pinned to it, so the same unqualified `device_state`
 * table name resolves inside that private namespace instead of the real one.
 */
import { runDeviceStateStoreContract } from "@www/core/testing";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe } from "vitest";

import { createPgDeviceStateStore } from "../src/device-state/pg";
import * as schema from "../src/device-state/schema";
import { ddlForTable } from "./schema-ddl";

const url = process.env.CORE_PG_TEST_URL;

describe.skipIf(!url)("pg contract", () => {
  const namespace = `core_pg_contract_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

  // biome-ignore lint/style/noNonNullAssertion: describe.skipIf(!url) guards this block
  const pool = new Pool({ connectionString: url!, options: `-c search_path=${namespace},public` });
  const db = drizzle(pool, { schema });

  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${namespace}"`);
    // DDL is derived from the same `deviceState` drizzle table the adapter
    // queries (see `./schema-ddl`), so it can't drift from
    // `../src/device-state/schema.ts` when a column or index changes.
    await pool.query(ddlForTable(schema.deviceState, namespace));
  });

  afterEach(async () => {
    await pool.query(`TRUNCATE TABLE "${namespace}".device_state`);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    await pool.end();
  });

  runDeviceStateStoreContract(() => createPgDeviceStateStore(db));
});
