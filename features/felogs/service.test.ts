/**
 * Tests for frontend log ingest. Devices ship batches of on-device log entries;
 * ingest validates them, drops pathologically large ones (counted, never fatal),
 * and persists the rest idempotently via `on conflict do nothing` so resends and
 * cursor resets can never double-insert or error. The router (logs.ingest) is a
 * thin wrapper, so the behaviour lives here plus a registration assertion.
 */
import { router } from "@app-kit/server";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { describe, expect, it, vi } from "vitest";
import { logsRouter } from "./api";
import type * as schema from "./schema";
import {
  frontendLogEntrySchema,
  frontendLogIngestSchema,
  ingestFrontendLogs,
  MAX_BATCH_SIZE,
  MAX_DATA_BYTES,
} from "./service";

type Db = NodePgDatabase<typeof schema>;

/** A mock db that records the rows handed to insert().values().onConflictDoNothing(). */
function makeInsertDb() {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });
  const db = { insert } as unknown as Db;
  return { db, insert, values, onConflictDoNothing };
}

/** A well-formed shipped entry with sensible defaults; override per test. */
function entry(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "0001700000000000-0000000001",
    ts: 1_700_000_000_000,
    level: "info" as const,
    source: "boot",
    msg: "hello",
    sha: "abc1234",
    build: "80",
    deviceName: "Wall Panel",
    ...over,
  };
}

// ─── input validation ────────────────────────────────────────────────────────

describe("frontendLogIngestSchema", () => {
  it("accepts a batch at the max size", () => {
    const entries = Array.from({ length: MAX_BATCH_SIZE }, (_, i) => entry({ id: `b-${i}` }));
    expect(() =>
      frontendLogIngestSchema.parse({ deviceId: "web-abcd1234", entries }),
    ).not.toThrow();
  });

  it("rejects a batch over the max size", () => {
    const entries = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => entry({ id: `b-${i}` }));
    expect(() => frontendLogIngestSchema.parse({ deviceId: "web-abcd1234", entries })).toThrow();
  });

  it("rejects an unknown level", () => {
    expect(() => frontendLogEntrySchema.parse(entry({ level: "trace" }))).toThrow();
  });

  it("rejects an empty deviceId", () => {
    expect(() => frontendLogIngestSchema.parse({ deviceId: "", entries: [] })).toThrow();
  });

  it("defaults a missing build to 'web' (optional on the wire, notNull in db)", () => {
    const { build, ...noBuild } = entry();
    const parsed = frontendLogEntrySchema.parse(noBuild);
    expect(parsed.build).toBe("web");
  });
});

// ─── ingest behaviour ────────────────────────────────────────────────────────

describe("ingestFrontendLogs", () => {
  it("inserts the mapped rows idempotently and reports the accepted count", async () => {
    const { db, insert, values, onConflictDoNothing } = makeInsertDb();
    const input = frontendLogIngestSchema.parse({
      deviceId: "ipad13-1-3f9a2c1b",
      entries: [entry(), entry({ id: "e2", data: { k: 1 } })],
    });

    const result = await ingestFrontendLogs(db, input);

    expect(result).toEqual({ accepted: 2, rejected: 0 });
    expect(insert).toHaveBeenCalledTimes(1);
    // on conflict do nothing is what makes resends idempotent.
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
    const rows = values.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      deviceId: "ipad13-1-3f9a2c1b",
      entryId: "0001700000000000-0000000001",
      ts: new Date(1_700_000_000_000),
      level: "info",
      source: "boot",
      msg: "hello",
      data: null, // absent payload persists as null
      sha: "abc1234",
      build: "80",
      deviceName: "Wall Panel",
    });
    expect(rows[1]).toMatchObject({ entryId: "e2", data: { k: 1 } });
  });

  it("drops an entry whose serialized data exceeds MAX_DATA_BYTES, keeps the rest", async () => {
    const { db, values } = makeInsertDb();
    const huge = { blob: "x".repeat(MAX_DATA_BYTES + 1) };
    const input = frontendLogIngestSchema.parse({
      deviceId: "web-abcd1234",
      entries: [entry({ id: "ok" }), entry({ id: "big", data: huge })],
    });

    const result = await ingestFrontendLogs(db, input);

    expect(result).toEqual({ accepted: 1, rejected: 1 });
    const rows = values.mock.calls[0][0] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].entryId).toBe("ok");
  });

  it("does not insert at all when every entry is oversized", async () => {
    const { db, insert } = makeInsertDb();
    const huge = { blob: "x".repeat(MAX_DATA_BYTES + 1) };
    const input = frontendLogIngestSchema.parse({
      deviceId: "web-abcd1234",
      entries: [entry({ id: "big", data: huge })],
    });

    const result = await ingestFrontendLogs(db, input);

    expect(result).toEqual({ accepted: 0, rejected: 1 });
    expect(insert).not.toHaveBeenCalled();
  });

  it("keeps an entry whose data serializes to exactly MAX_DATA_BYTES (strict >)", async () => {
    const { db, values } = makeInsertDb();
    // JSON.stringify of a bare string is the content plus two quote chars.
    const payload = "y".repeat(MAX_DATA_BYTES - 2);
    const input = frontendLogIngestSchema.parse({
      deviceId: "web-abcd1234",
      entries: [entry({ id: "edge", data: payload })],
    });

    const result = await ingestFrontendLogs(db, input);

    expect(result).toEqual({ accepted: 1, rejected: 0 });
    expect(values.mock.calls[0][0]).toHaveLength(1);
  });

  it("no-ops (no insert) on an empty batch", async () => {
    const { db, insert } = makeInsertDb();
    const input = frontendLogIngestSchema.parse({ deviceId: "web-abcd1234", entries: [] });

    const result = await ingestFrontendLogs(db, input);

    expect(result).toEqual({ accepted: 0, rejected: 0 });
    expect(insert).not.toHaveBeenCalled();
  });

  it("is safe to resend the same batch (no throw, still on-conflict-do-nothing)", async () => {
    const { db, onConflictDoNothing } = makeInsertDb();
    const input = frontendLogIngestSchema.parse({
      deviceId: "ipad13-1-3f9a2c1b",
      entries: [entry()],
    });

    await ingestFrontendLogs(db, input);
    await expect(ingestFrontendLogs(db, input)).resolves.toEqual({ accepted: 1, rejected: 0 });
    expect(onConflictDoNothing).toHaveBeenCalledTimes(2);
  });
});

// ─── router wiring ───────────────────────────────────────────────────────────

describe("logs router wiring", () => {
  it("registers logs.ingest on a local router built from the exported logsRouter", () => {
    const appRouter = router({ logs: logsRouter });
    expect(Object.keys(appRouter._def.procedures)).toContain("logs.ingest");
  });
});
