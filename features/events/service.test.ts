import { readFileSync } from "node:fs";
import { genId } from "@www/platform";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { alarmInputSchema } from "./contract";
import * as schema from "./schema";
import { createAlarmService } from "./service";

// Same isolated-schema contract pattern as packages/core's PG tests.
// biome-ignore lint/style/noProcessEnv: opt-in local Postgres integration test
const url = process.env.ALARM_TEST_DATABASE_URL;
describe.skipIf(!url)("alarm service against Postgres", () => {
  const namespace = genId("alarmtest");
  const pool = new Pool({ connectionString: url, options: `-c search_path=${namespace},public` });
  const database = drizzle(pool, { schema });
  const defaults = () => ({ snoozeMinutes: 9, lightTarget: "light.bed_lamp_left" });
  const service = createAlarmService(database, defaults);
  const before = new Date("2026-10-05T15:59:00Z");
  const due = new Date("2026-10-05T16:00:00Z");
  const definition = (patch = {}) =>
    alarmInputSchema.parse({ time: "09:00", timeZone: "America/Los_Angeles", ...patch });
  const make = (patch = {}, key?: string) => service.create(definition(patch), key, before);
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${namespace}"`);
    const ddl = readFileSync(
      new URL("../../apps/api/src/db/migrations/0041_sparkling_gravity.sql", import.meta.url),
      "utf8",
    ).replaceAll('REFERENCES "public".', `REFERENCES "${namespace}".`);
    await pool.query(ddl);
  });
  beforeEach(async () => {
    await pool.query("TRUNCATE alarm CASCADE");
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA "${namespace}" CASCADE`);
    await pool.end();
  });

  it("creates, edits, disables, enables and deletes durable alarms", async () => {
    const { id } = await make();
    await service.update(
      id,
      definition({ label: "Morning", time: "10:00", repeatDays: [1] }),
      before,
    );
    expect((await service.snapshot(before)).next).toMatchObject({
      label: "Morning",
      at: "2026-10-05T17:00:00.000Z",
    });
    await service.setEnabled(id, false, before);
    expect((await service.snapshot(before)).next).toBeNull();
    await service.setEnabled(id, true, before);
    expect((await service.snapshot(before)).next?.id).toBe(id);
    await service.remove(id);
    expect((await service.snapshot(before)).alarms).toEqual([]);
  });
  it("deduplicates simultaneous creates and rejects key reuse with a changed body", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => make({}, "shortcut-request-123")),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect((await service.snapshot(before)).alarms).toHaveLength(1);
    await expect(make({ label: "Different" }, "shortcut-request-123")).rejects.toMatchObject({
      status: 409,
    });
  });
  it("concurrent workers claim exactly one occurrence and advance the schedule atomically", async () => {
    await make({ repeatDays: [1, 2, 3, 4, 5] });
    const claims = await Promise.all(Array.from({ length: 8 }, () => service.claimDue(due)));
    expect(claims.reduce((a, b) => a + b, 0)).toBe(1);
    const state = await service.snapshot(due);
    expect(state.active).toHaveLength(1);
    expect(state.next?.at).toBe("2026-10-06T16:00:00.000Z");
    expect(await service.claimDue(due)).toBe(0);
  });
  it("persists rings across new service instances, and one-offs disable after firing", async () => {
    await make();
    await service.claimDue(due);
    const restarted = createAlarmService(database, defaults);
    const state = await restarted.snapshot(due);
    expect(state.active[0]?.status).toBe("ringing");
    expect(state.alarms[0]?.enabled).toBe(false);
    expect(await restarted.claimDue(due)).toBe(0);
  });
  it("snoozes once despite racing clients and rejects stale actions after refiring", async () => {
    await make();
    await service.claimDue(due);
    const [ring] = (await service.snapshot(due)).active;
    const actions = await Promise.allSettled([
      service.act(ring.id, ring.version, "snooze", due),
      service.act(ring.id, ring.version, "snooze", due),
    ]);
    expect(actions.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    expect((await service.snapshot(due)).next?.at).toBe("2026-10-05T16:09:00.000Z");
    expect(await service.claimDue(new Date("2026-10-05T16:08:59Z"))).toBe(0);
    expect(
      await createAlarmService(database, defaults).claimDue(new Date("2026-10-05T16:09:00Z")),
    ).toBe(1);
    await expect(service.act(ring.id, ring.version, "stop", due)).rejects.toMatchObject({
      status: 409,
    });
    const [again] = (await service.snapshot(due)).active;
    await service.act(again.id, again.version, "stop", due);
    expect((await service.snapshot(due)).active).toHaveLength(0);
  });
  it("recovers within the grace window, records old occurrences as missed, and expires rings", async () => {
    const { id } = await make();
    await service.claimDue(new Date("2026-10-05T16:16:00Z"));
    expect((await database.select().from(schema.alarmRings))[0]?.status).toBe("missed");
    await service.remove(id);
    await make();
    expect(await service.claimDue(new Date("2026-10-05T16:14:00Z"))).toBe(1);
    await service.claimDue(new Date("2026-10-05T16:44:00Z"));
    expect((await service.snapshot(new Date("2026-10-05T16:44:00Z"))).active).toHaveLength(0);
  });
  it("retries light failures without creating another ring, and serializes deliveries", async () => {
    await make();
    await service.claimDue(due);
    const delivery = vi
      .fn()
      .mockRejectedValueOnce(new Error("HA offline"))
      .mockResolvedValue(undefined);
    const log = vi.fn();
    await service.deliverLights(delivery, log, due);
    expect(log).toHaveBeenCalledOnce();
    await service.deliverLights(delivery, log, due);
    expect(delivery).toHaveBeenCalledTimes(1);
    const retry = new Date(due.getTime() + 1000);
    await Promise.all([
      service.deliverLights(delivery, log, retry),
      service.deliverLights(delivery, log, retry),
    ]);
    expect(delivery).toHaveBeenCalledTimes(2);
    expect((await service.snapshot(retry)).active).toHaveLength(1);
    expect((await service.snapshot(retry)).active[0]?.lightsPending).toBe(false);
  });
  it("stop prevents retries; deleting cascades to ringing and snoozed occurrences", async () => {
    const { id } = await make();
    await service.claimDue(due);
    const [ring] = (await service.snapshot(due)).active;
    await service.act(ring.id, ring.version, "stop", due);
    const deliver = vi.fn();
    await service.deliverLights(deliver, vi.fn(), due);
    expect(deliver).not.toHaveBeenCalled();
    await service.remove(id);
    expect(await database.select().from(schema.alarmRings)).toEqual([]);
  });
  it("disabling and editing stop live occurrences", async () => {
    const { id } = await make({ repeatDays: [1] });
    await service.claimDue(due);
    await service.setEnabled(id, false, due);
    expect((await service.snapshot(due)).active).toEqual([]);
    await service.setEnabled(id, true, due);
    await database.update(schema.alarms).set({ nextFireAt: due }).where(eq(schema.alarms.id, id));
    // Unique occurrence key prevents a manually repeated scheduled instant.
    expect(await service.claimDue(due)).toBe(0);
    await service.update(id, definition({ time: "11:00" }), due);
    expect((await service.snapshot(due)).next?.at).toBe("2026-10-05T18:00:00.000Z");
  });
  it("rejects past dates and returns typed missing-resource errors", async () => {
    await expect(make({ at: "2025-01-01T00:00:00Z" })).rejects.toMatchObject({ status: 400 });
    await expect(service.remove("alm_missing")).rejects.toMatchObject({ status: 404 });
    await expect(service.update("alm_missing", definition(), due)).rejects.toMatchObject({
      status: 404,
    });
  });
});
