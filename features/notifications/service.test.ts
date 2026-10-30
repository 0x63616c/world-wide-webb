import { readFileSync } from "node:fs";
import { genId } from "@www/platform";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { notificationInputSchema, notificationListSchema } from "./contract";
import * as schema from "./schema";
import { createNotificationService } from "./service";

const input = {
  source_module: "alarms",
  title: "Wake up",
  body: "Morning",
  deep_link: "module/events/alarms",
  priority: "high" as const,
  dedupe_key: "morning",
};
// biome-ignore lint/style/noProcessEnv: opt-in isolated Postgres integration tests
const url = process.env.NOTIFICATIONS_TEST_DATABASE_URL;
describe.skipIf(!url)("notifications against Postgres", () => {
  const namespace = genId("notificationtest");
  const pool = new Pool({ connectionString: url, options: `-c search_path=${namespace},public` });
  const database = drizzle(pool, { schema });
  const service = createNotificationService(database);
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${namespace}"`);
    await pool.query(
      readFileSync(
        new URL("../../apps/api/src/db/migrations/0044_daffy_blonde_phantom.sql", import.meta.url),
        "utf8",
      ).replaceAll('"public".', `"${namespace}".`),
    );
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE notifications");
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    await pool.end();
  });

  it("deduplicates concurrent writes across service instances, re-marks unread and bumps time", async () => {
    const row = await service.create(input);
    await service.act(row.id, "read");
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        createNotificationService(database).create({ ...input, title: `Updated ${i}` }),
      ),
    );
    expect(new Set(results.map((r) => r.id))).toEqual(new Set([row.id]));
    const page = await service.list({});
    expect(page.items).toHaveLength(1);
    expect(page.items[0].read_at).toBeNull();
    expect(page.items[0].created_at > row.created_at).toBe(true);
    expect(new Set(results.map((r) => r.revision)).size).toBe(8);
    expect((await createNotificationService(database).list({})).items).toEqual(page.items);
  });
  it("isolates sources and null keys; dismissal ends the dedupe window", async () => {
    const row = await service.create(input);
    await service.create({ ...input, source_module: "walks" });
    await service.create({ ...input, dedupe_key: null });
    await service.create({ ...input, dedupe_key: null });
    expect((await service.list({})).items).toHaveLength(4);
    await service.act(row.id, "dismiss");
    expect((await service.create(input)).id).not.toBe(row.id);
    expect((await service.list({})).items).toHaveLength(4);
  });
  it("paginates without losing tied timestamps and replays read/dismiss/dedupe changes", async () => {
    await Promise.all(
      Array.from({ length: 5 }, () => service.create({ ...input, dedupe_key: null })),
    );
    await pool.query("UPDATE notifications SET created_at = '2026-01-01'");
    const ids: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await service.list({ since: cursor, limit: 2 });
      ids.push(...page.items.map((r) => r.id));
      cursor = page.cursor;
      if (!page.has_more) break;
    }
    expect(new Set(ids).size).toBe(5);
    const read = await service.act(ids[0], "read");
    const dismissed = await service.act(ids[1], "dismiss");
    expect((await service.list({ since: cursor })).items).toEqual([read, dismissed]);
    expect((await service.list({ unread: "true" })).items).toHaveLength(3);
    expect((await service.list({ unread: "false" })).items).toHaveLength(1);
    const upsert = await service.create(input);
    const update = await service.create({ ...input, body: "Changed" });
    expect((await service.list({ since: upsert.revision })).items).toEqual([update]);
    expect(await service.act("ntf_missing", "read")).toBeNull();
  });
  it("serializes commits so readers cannot advance past an in-flight revision", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(580058)");
      const pending = service.create(input);
      let finished = false;
      const page = service.list({ since: "0" }).then((result) => {
        finished = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(finished).toBe(false);
      await client.query("COMMIT");
      await pending;
      const first = await page;
      const second = await service.list({ since: first.cursor });
      expect([...first.items, ...second.items].map((r) => r.id)).toHaveLength(1);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
  it("dismisses all and prunes only dismissed rows older than 30 days", async () => {
    const old = await service.create(input);
    const active = await service.create({ ...input, dedupe_key: null });
    await service.act(old.id, "dismiss");
    await pool.query(
      "UPDATE notifications SET dismissed_at = now() - interval '31 days' WHERE id = $1",
      [old.id],
    );
    expect(await service.prune()).toBe(1);
    expect((await service.list({})).items.map((r) => r.id)).toEqual([active.id]);
    expect(await service.dismissAll()).toEqual({ dismissed: 1 });
    expect(await service.dismissAll()).toEqual({ dismissed: 0 });
    expect(await service.prune()).toBe(0);
    expect((await service.list({})).items).toEqual([]);
    expect((await service.list({ since: active.revision })).items[0].dismissed_at).not.toBeNull();
  });
});

it("validates helper and HTTP contracts with bounded inputs", () => {
  expect(
    notificationInputSchema.parse({ ...input, priority: undefined, dedupe_key: undefined }),
  ).toMatchObject({ priority: "normal", dedupe_key: null });
  for (const patch of [
    { source_module: "../bad" },
    { title: " " },
    { body: "x".repeat(4001) },
    { deep_link: "https://bad.test" },
    { deep_link: "module/a/../b" },
    { priority: "urgent" },
    { dedupe_key: "" },
  ])
    expect(notificationInputSchema.safeParse({ ...input, ...patch }).success).toBe(false);
  for (const value of [
    { unread: "yes" },
    { limit: 0 },
    { limit: 201 },
    { since: "2026-01-01" },
    { since: "9223372036854775808" },
  ])
    expect(notificationListSchema.safeParse(value).success).toBe(false);
});
