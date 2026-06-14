import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../db/index";
import { runMigrations } from "../db/migrate";
import { ensureSeed } from "../seed";

beforeEach(async () => {
  await pool.query(`
    TRUNCATE report_evidence, reports, activity, slips, memberships,
             sessions, otps, user_exes, jars, users RESTART IDENTITY CASCADE
  `);
});

afterAll(async () => {
  await pool.end();
});

describe("production boot", () => {
  it("ensureSeed does NOT insert rows when APP_ENV=production", async () => {
    const origEnv = process.env.APP_ENV;
    process.env.APP_ENV = "production";
    try {
      await runMigrations();
      await ensureSeed();
      const { rows } = await pool.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM users");
      expect(Number(rows[0].n)).toBe(0);
    } finally {
      process.env.APP_ENV = origEnv;
    }
  });

  it("ensureSeed DOES insert rows when APP_ENV is not production", async () => {
    const origEnv = process.env.APP_ENV;
    process.env.APP_ENV = "development";
    try {
      await runMigrations();
      await ensureSeed();
      const { rows } = await pool.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM users");
      expect(Number(rows[0].n)).toBeGreaterThan(0);
    } finally {
      process.env.APP_ENV = origEnv;
    }
  });
});
