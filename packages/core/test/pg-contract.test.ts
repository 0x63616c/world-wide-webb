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

const url = process.env.CORE_PG_TEST_URL;

describe.skipIf(!url)("pg contract", () => {
  const namespace = `core_pg_contract_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

  // biome-ignore lint/style/noNonNullAssertion: describe.skipIf(!url) guards this block
  const pool = new Pool({ connectionString: url!, options: `-c search_path=${namespace},public` });
  const db = drizzle(pool, { schema });

  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${namespace}"`);
    // Hand-written DDL mirroring `../src/device-state/schema.ts`'s `deviceState`
    // table — there is no migration-from-schema step in this test, so if a
    // column is added/renamed/retyped there, update it here too or this
    // contract silently stops covering it.
    await pool.query(`
      CREATE TABLE "${namespace}".device_state (
        id text PRIMARY KEY,
        kind text NOT NULL,
        entity_id text NOT NULL,
        domain text NOT NULL,
        label text NOT NULL,
        reported_state jsonb,
        reported_at_utc timestamptz,
        reported_changed_at_utc timestamptz,
        desired_state jsonb,
        desired_at_utc timestamptz,
        desired_until_utc timestamptz,
        available boolean NOT NULL DEFAULT false,
        created_at_utc timestamptz NOT NULL DEFAULT now(),
        updated_at_utc timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX device_state_entity_id_idx ON "${namespace}".device_state (entity_id);
      CREATE INDEX device_state_kind_idx ON "${namespace}".device_state (kind);
    `);
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
