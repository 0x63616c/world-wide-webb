import { readFileSync } from "node:fs";
import { genId } from "@www/platform";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "./schema";
import { createReleaseService } from "./service";

// biome-ignore lint/style/noProcessEnv: opt-in isolated Postgres integration tests
const url = process.env.RELEASES_TEST_DATABASE_URL;
describe.skipIf(!url)("release service against Postgres", () => {
  const namespace = genId("releasetest");
  const pool = new Pool({ connectionString: url, options: `-c search_path=${namespace},public` });
  const database = drizzle(pool, { schema });
  const service = createReleaseService(database);
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${namespace}"`);
    await pool.query(
      readFileSync(
        new URL("../../apps/api/src/db/migrations/0043_last_jack_murdock.sql", import.meta.url),
        "utf8",
      ),
    );
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE latest_release");
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    await pool.end();
  });
  it("persists across service instances and isolates app ids", async () => {
    expect(await service.latest("panel")).toBeNull();
    const initial = await service.record({ app: "panel", build: 99 });
    expect(initial).toMatchObject({ app: "panel", build: 99, updatedAt: expect.any(String) });
    await service.record({ app: "other", build: 1 });
    expect(await createReleaseService(database).latest("panel")).toEqual(initial);
  });
  it("preserves both build and timestamp on equal and lower retries", async () => {
    const initial = await service.record({ app: "panel", build: 99 });
    expect(await service.record({ app: "panel", build: 99 })).toEqual(initial);
    expect(await service.record({ app: "panel", build: 98 })).toEqual(initial);
    expect(await service.record({ app: "panel", build: 100 })).toMatchObject({ build: 100 });
  });
  it("arbitrates concurrent unordered uploads in Postgres", async () => {
    await Promise.all(
      [110, 99, 120, 119, 120, 80].map((build) => service.record({ app: "panel", build })),
    );
    expect(await service.latest("panel")).toMatchObject({ build: 120 });
  });
  it("rejects invalid writes at service and database boundaries", async () => {
    await expect(service.record({ app: "panel", build: 0 })).rejects.toThrow();
    await expect(
      pool.query("INSERT INTO latest_release (app, build) VALUES ('panel', -1)"),
    ).rejects.toThrow();
    expect(await service.latest("panel")).toBeNull();
  });
});
