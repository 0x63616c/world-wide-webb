import { readFile } from "node:fs/promises";
import { createPgDeviceStateStore, type HaEntity } from "@www/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../packages/core/src/device-state/schema";
import { ddlForTable } from "../../packages/core/test/schema-ddl";
import { createBedroomSwitch } from "./bedroom-switch";
import { BEDROOM_LAMPS, writeLightGroup } from "./light-command";

// biome-ignore lint/style/noProcessEnv: opt-in disposable database contract, never application config
const url = process.env.CORE_PG_TEST_URL;
const entityId = "binary_sensor.test_input";
const config = {
  BEDROOM_SWITCH_INPUT_ENABLED: "true",
  BEDROOM_SWITCH_INPUT_VERIFIED: "true",
  BEDROOM_SWITCH_INPUT_ENTITY_ID: entityId,
};
const sample = (state: string, second: number): HaEntity => ({
  entity_id: entityId,
  state,
  attributes: {},
  last_changed: new Date(second * 1000).toISOString(),
  last_updated: new Date(second * 1000).toISOString(),
});

describe.skipIf(!url)("bedroom input PostgreSQL transactions", () => {
  const namespace = `bedroom_pg_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const pool = new Pool({ connectionString: url, options: `-c search_path=${namespace},public` });
  const db = drizzle(pool);
  const store = createPgDeviceStateStore(db);
  const levels = async () => (await store.list()).map((row) => row.desiredState);

  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${namespace}"`);
    await pool.query(ddlForTable(schema.deviceState, namespace));
    // Exercise the shipped migration rather than reconstructing checkpoint DDL.
    await pool.query(
      await readFile(
        new URL(
          "../../apps/api/src/db/migrations/0045_bedroom_input_checkpoint.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE device_state, input_checkpoint");
    await store.lightTransaction((locked) =>
      writeLightGroup(BEDROOM_LAMPS, () => ({ on: false, brightness: 87 }), locked),
    );
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    await pool.end();
  });

  it("dedupes the same edge across independent adapters and after reconnect", async () => {
    const first = createBedroomSwitch(config, store);
    const second = createBedroomSwitch(config, createPgDeviceStateStore(db));
    await Promise.all([
      first.sample(sample("off", 1), true),
      second.sample(sample("off", 1), true),
    ]);
    await Promise.all([
      first.sample(sample("on", 2), false, sample("off", 1)),
      second.sample(sample("on", 2), false, sample("off", 1)),
    ]);
    expect(await levels()).toEqual(Array(3).fill({ on: true, brightness: 87 }));
    const restarted = createBedroomSwitch(config, createPgDeviceStateStore(db));
    await restarted.sample(sample("off", 1), true);
    await restarted.sample(sample("on", 2), false, sample("off", 1));
    expect(await levels()).toEqual(Array(3).fill({ on: true, brightness: 87 }));
    await restarted.sample(sample("off", 3), false, sample("on", 2));
    expect(await levels()).toEqual(Array(3).fill({ on: false, brightness: 87 }));
    expect(await store.readInput(entityId)).toEqual({
      state: "off",
      changed: "1970-01-01T00:00:03.000000Z",
      actedAt: 3000,
    });
  });

  it("rolls back the entire group if checkpoint persistence fails, then retries once", async () => {
    const binding = createBedroomSwitch(config, store);
    await binding.sample(sample("off", 1), true);
    await pool.query(`
      CREATE FUNCTION reject_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'checkpoint failure'; END $$;
      CREATE TRIGGER reject_checkpoint BEFORE INSERT OR UPDATE ON input_checkpoint
        FOR EACH ROW EXECUTE FUNCTION reject_checkpoint();
    `);
    try {
      await expect(binding.sample(sample("on", 2), false, sample("off", 1))).rejects.toMatchObject({
        cause: { message: "checkpoint failure" },
      });
      expect(await levels()).toEqual(Array(3).fill({ on: false, brightness: 87 }));
      expect((await store.readInput(entityId))?.state).toBe("off");
    } finally {
      await pool.query(
        "DROP TRIGGER reject_checkpoint ON input_checkpoint; DROP FUNCTION reject_checkpoint()",
      );
    }
    await binding.sample(sample("on", 2), false, sample("off", 1));
    await binding.sample(sample("on", 2), false, sample("off", 1));
    expect(await levels()).toEqual(Array(3).fill({ on: true, brightness: 87 }));
  });
});
