import { readFileSync } from "node:fs";
import { genId } from "@www/platform";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startInput } from "./contract";
import * as schema from "./schema";
import { createWalkService } from "./service";

// biome-ignore lint/style/noProcessEnv: opt-in isolated Postgres integration test
const url = process.env.WALKS_TEST_DATABASE_URL;
describe.skipIf(!url)("walk log against Postgres", () => {
  const namespace = genId("walktest");
  const pool = new Pool({ connectionString: url, options: `-c search_path=${namespace},public` });
  const service = createWalkService(drizzle(pool, { schema }));
  const id = "00000000-0000-4000-8000-000000000001";
  const start = (patch = {}) => service.start(startInput.parse({ id, ...patch }));
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${namespace}"`);
    await pool.query(
      readFileSync(
        new URL("../../apps/api/src/db/migrations/0042_careful_mercury.sql", import.meta.url),
        "utf8",
      ),
    );
    await pool.query(
      readFileSync(
        new URL("../../apps/api/src/db/migrations/0044_daffy_blonde_phantom.sql", import.meta.url),
        "utf8",
      ).replaceAll('"public".', `"${namespace}".`),
    );
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE notifications");
    await pool.query('TRUNCATE "walk"');
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    await pool.end();
  });
  it("posts start/stop only on transitions, including a forgotten stop", async () => {
    await Promise.all([start(), start()]);
    await service.stop({ id });
    await service.stop({ id });
    await start(); // consumed ID
    const next = (await start({ id: undefined })).active;
    if (!next) throw new Error("Expected an active walk");
    await service.update({ id: next.id, endedAt: new Date().toISOString() });
    await service.update({ id: next.id, endedAt: new Date().toISOString() });
    const rows = (await pool.query("SELECT * FROM notifications ORDER BY revision")).rows;
    expect(rows.map((r) => r.title)).toEqual([
      "Walk started",
      "Walk stopped",
      "Walk started",
      "Walk stopped",
    ]);
    expect(rows.every((r) => r.deep_link === "module/walks")).toBe(true);
  });
  it("rolls back walk creation if notification persistence fails", async () => {
    await pool.query(
      "ALTER TABLE notifications ADD CONSTRAINT reject_test CHECK (title = 'rejected')",
    );
    try {
      await expect(start()).rejects.toThrow();
    } finally {
      await pool.query("ALTER TABLE notifications DROP CONSTRAINT reject_test");
    }
    expect((await service.state()).active).toBeNull();
    expect((await start()).active?.id).toBe(id);
  });
  it("uses server time, preserves start retries and consumed ids", async () => {
    const before = Date.now();
    const first = await start({ source: "iphone" });
    expect(Date.parse(first.active?.startedAt ?? "")).toBeGreaterThanOrEqual(before);
    expect(first.active?.source).toBe("iphone");
    expect((await start({ startedAt: "2020-01-01T00:00:00Z" })).active).toEqual(first.active);
    await service.stop({ id });
    expect((await start()).active).toBeNull();
    expect((await service.history({ limit: 50 })).walks).toHaveLength(1);
  });
  it("serializes concurrent starts across connections", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => service.start(startInput.parse({}))),
    );
    expect(new Set(results.map((r) => r.active?.id)).size).toBe(1);
    expect((await pool.query('SELECT * FROM "walk"')).rowCount).toBe(1);
  });
  it("enforces one active walk and time order directly in Postgres", async () => {
    await start();
    await expect(
      pool.query(`INSERT INTO walk (id, started_at) VALUES ('other', now())`),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(
      pool.query(`UPDATE walk SET ended_at = started_at - interval '1 second'`),
    ).rejects.toMatchObject({ code: "23514" });
  });
  it("clamps stop and preserves the first stop including its revision", async () => {
    await start({ startedAt: "2026-01-01T12:00:00Z" });
    const stopped = await service.stop({ id, endedAt: "2026-01-01T11:00:00Z" });
    expect(stopped.active).toBeNull();
    const first = (await service.history({ limit: 50 })).walks[0];
    expect(first.endedAt).toBe(first.startedAt);
    await service.stop({ id, endedAt: "2026-01-02T00:00:00Z" });
    expect((await service.history({ limit: 50 })).walks[0]).toEqual(first);
    expect((await service.state()).updatedAt).toBe(stopped.updatedAt);
  });
  it("pages completed history newest first and excludes active walks", async () => {
    for (const day of [1, 2, 3]) {
      const active = (await start({ id: undefined, startedAt: `2026-01-0${day}T12:00:00Z` }))
        .active;
      await service.stop({ id: active?.id ?? "", endedAt: `2026-01-0${day}T13:00:00Z` });
    }
    await start();
    const page = await service.history({ limit: 2 });
    expect(page.walks.map((w) => w.startedAt)).toEqual([
      "2026-01-03T12:00:00.000Z",
      "2026-01-02T12:00:00.000Z",
    ]);
    const next = await service.history({ limit: 2, before: page.walks[1].startedAt });
    expect(next.walks.map((w) => w.startedAt)).toEqual(["2026-01-01T12:00:00.000Z"]);
  });
  it("updates forgotten stops, validates merged dates and reports missing ids", async () => {
    await start({ startedAt: "2026-01-01T12:00:00Z" });
    await expect(service.update({ id, endedAt: "2026-01-01T11:00:00Z" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect((await service.update({ id, endedAt: "2026-01-01T13:00:00Z" })).active).toBeNull();
    await expect(service.update({ id, startedAt: "2026-01-02T00:00:00Z" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await service.update({
      id,
      startedAt: "2026-01-01T10:00:00Z",
      endedAt: "2026-01-01T11:00:00Z",
    });
    expect((await service.history({ limit: 50 })).walks[0].startedAt).toBe(
      "2026-01-01T10:00:00.000Z",
    );
    await expect(service.update({ id: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("deletes active/completed walks idempotently, retaining consumed ids and revision", async () => {
    await start();
    const deleted = await service.delete(id);
    expect(deleted.active).toBeNull();
    expect((await service.history({ limit: 50 })).walks).toEqual([]);
    expect((await service.delete(id)).updatedAt).toBe(deleted.updatedAt);
    expect((await start()).active).toBeNull();
    await expect(service.update({ id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await service.stop({ id: "missing" })).active).toBeNull();
    const second = (await start({ id: undefined })).active;
    await service.stop({ id: second?.id ?? "" });
    await service.delete(second?.id ?? "");
    expect((await service.history({ limit: 50 })).walks).toEqual([]);
  });
});
