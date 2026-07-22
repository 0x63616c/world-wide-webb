/**
 * Builder-mock tests for the pg `DeviceStateStore` adapter: pins the exact
 * drizzle call (columns touched, WHERE keys, conflict target) per method,
 * mirroring `api/src/__tests__/desired-state-store.test.ts`. `drizzle-orm`'s
 * predicate builders (eq/and/inArray/isNotNull/lt) are wrapped (not replaced)
 * so we can assert which column + value each call site used while keeping
 * real SQL behavior for anything that still needs it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: vi.fn(actual.eq),
    and: vi.fn(actual.and),
    inArray: vi.fn(actual.inArray),
    isNotNull: vi.fn(actual.isNotNull),
    lt: vi.fn(actual.lt),
  };
});

import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { COMMAND_WINDOW_MS } from "../src/device-state/command-window";
import { createPgDeviceStateStore } from "../src/device-state/pg";
import { DeviceKind, deviceState } from "../src/device-state/schema";

type FakeDb = NodePgDatabase<Record<string, unknown>>;

// ─── chain builders ────────────────────────────────────────────────────────

/** A select().from().where()?.limit()? chain that resolves to `rows` at any await point. */
function selectChain(rows: unknown[]) {
  const limit = vi.fn().mockResolvedValue(rows);
  const where = vi.fn();
  // The chain node IS a real Promise (resolving to `rows`) with .where/.limit attached, so
  // it can be awaited directly (list/listExpiredWindows) or chained further (read).
  const node = Object.assign(Promise.resolve(rows), { where, limit });
  where.mockReturnValue(node);
  const from = vi.fn().mockReturnValue(node);
  return { from, where, limit };
}

function insertChain() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate, onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values, onConflictDoUpdate, onConflictDoNothing };
}

function updateChain() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  const update = vi.fn().mockReturnValue({ set });
  return { update, set, where };
}

const lampInput = {
  id: "lgt_globe",
  kind: DeviceKind.Light,
  entityId: "light.living_room_globe",
  domain: "light",
  label: "Globe",
  desired: { on: true, brightness: 200 },
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── read ──────────────────────────────────────────────────────────────────

describe("read", () => {
  it("selects by id with limit(1), returning the first row or null", async () => {
    const rows = [{ id: "lgt_globe" }];
    const { from, where, limit } = selectChain(rows);
    const db = { select: vi.fn().mockReturnValue({ from }) } as unknown as FakeDb;

    const result = await createPgDeviceStateStore(db).read("lgt_globe");

    expect(eq).toHaveBeenCalledWith(deviceState.id, "lgt_globe");
    expect(where).toHaveBeenCalledTimes(1);
    expect(limit).toHaveBeenCalledWith(1);
    expect(result).toEqual(rows[0]);
  });

  it("returns null when no row matches", async () => {
    const { from } = selectChain([]);
    const db = { select: vi.fn().mockReturnValue({ from }) } as unknown as FakeDb;

    expect(await createPgDeviceStateStore(db).read("missing")).toBeNull();
  });
});

// ─── list ──────────────────────────────────────────────────────────────────

describe("list", () => {
  it("with no filter, selects with no WHERE clause", async () => {
    const rows = [{ id: "a" }];
    const { from, where } = selectChain(rows);
    const db = { select: vi.fn().mockReturnValue({ from }) } as unknown as FakeDb;

    const result = await createPgDeviceStateStore(db).list();

    expect(where).not.toHaveBeenCalled();
    expect(result).toEqual(rows);
  });

  it("filters by kind via eq(deviceState.kind, kind)", async () => {
    const { from, where } = selectChain([]);
    const db = { select: vi.fn().mockReturnValue({ from }) } as unknown as FakeDb;

    await createPgDeviceStateStore(db).list({ kind: DeviceKind.Light });

    expect(eq).toHaveBeenCalledWith(deviceState.kind, DeviceKind.Light);
    expect(and).not.toHaveBeenCalled();
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("filters by entityIds via inArray(deviceState.entityId, [...ids])", async () => {
    const { from, where } = selectChain([]);
    const db = { select: vi.fn().mockReturnValue({ from }) } as unknown as FakeDb;

    await createPgDeviceStateStore(db).list({ entityIds: ["light.a", "light.b"] });

    expect(inArray).toHaveBeenCalledWith(deviceState.entityId, ["light.a", "light.b"]);
    expect(and).not.toHaveBeenCalled();
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("combines kind + entityIds with and(...)", async () => {
    const { from } = selectChain([]);
    const db = { select: vi.fn().mockReturnValue({ from }) } as unknown as FakeDb;

    await createPgDeviceStateStore(db).list({ kind: DeviceKind.Light, entityIds: ["light.a"] });

    expect(eq).toHaveBeenCalledWith(deviceState.kind, DeviceKind.Light);
    expect(inArray).toHaveBeenCalledWith(deviceState.entityId, ["light.a"]);
    expect(and).toHaveBeenCalledTimes(1);
  });
});

// ─── listExpiredWindows ────────────────────────────────────────────────────

describe("listExpiredWindows", () => {
  it("selects where desiredUntilUtc is not null and < now", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const { from } = selectChain([]);
    const db = { select: vi.fn().mockReturnValue({ from }) } as unknown as FakeDb;

    await createPgDeviceStateStore(db).listExpiredWindows(now);

    expect(isNotNull).toHaveBeenCalledWith(deviceState.desiredUntilUtc);
    expect(lt).toHaveBeenCalledWith(deviceState.desiredUntilUtc, now);
    expect(and).toHaveBeenCalledTimes(1);
  });
});

// ─── readEffective ─────────────────────────────────────────────────────────

describe("readEffective", () => {
  it("returns null when the row is missing", async () => {
    const { from } = selectChain([]);
    const db = { select: vi.fn().mockReturnValue({ from }) } as unknown as FakeDb;

    expect(await createPgDeviceStateStore(db).readEffective("missing")).toBeNull();
  });

  it("merges desired over reported for an existing row", async () => {
    const row = {
      id: "lgt_globe",
      reportedState: { on: false, brightness: 128 },
      desiredState: { on: true },
      available: true,
    };
    const { from } = selectChain([row]);
    const db = { select: vi.fn().mockReturnValue({ from }) } as unknown as FakeDb;

    const effective = await createPgDeviceStateStore(db).readEffective("lgt_globe");

    expect(effective).toEqual({
      state: { on: true, brightness: 128 },
      pending: true,
      available: true,
    });
  });
});

// ─── seed ──────────────────────────────────────────────────────────────────

describe("seed", () => {
  it("inserts the row with desiredState/reportedState defaulted from desired/reported, conflict on entityId is a no-op", async () => {
    const { insert, values, onConflictDoNothing } = insertChain();
    const db = { insert } as unknown as FakeDb;

    await createPgDeviceStateStore(db).seed({
      id: "lgt_seeded",
      kind: DeviceKind.Light,
      entityId: "light.seeded",
      domain: "light",
      label: "Seeded",
      available: false,
    });

    expect(values).toHaveBeenCalledTimes(1);
    const row = values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      id: "lgt_seeded",
      kind: "light",
      entityId: "light.seeded",
      domain: "light",
      label: "Seeded",
      available: false,
      desiredState: null,
      reportedState: null,
    });
    expect(onConflictDoNothing).toHaveBeenCalledWith({ target: deviceState.entityId });
  });

  it("carries desired/reported through when provided", async () => {
    const { values } = insertChain();
    const db = { insert: vi.fn().mockReturnValue({ values }) } as unknown as FakeDb;

    await createPgDeviceStateStore(db).seed({
      id: "lgt_seeded",
      kind: DeviceKind.Light,
      entityId: "light.seeded",
      domain: "light",
      label: "Seeded",
      reported: { on: true },
      desired: { on: false },
      available: true,
    });

    const row = values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row.desiredState).toEqual({ on: false });
    expect(row.reportedState).toEqual({ on: true });
  });
});

// ─── upsertDesired ─────────────────────────────────────────────────────────

describe("upsertDesired", () => {
  it("inserts a full row (available:true) stamping desiredAtUtc + a command window", async () => {
    const { insert, values } = insertChain();
    const db = { insert } as unknown as FakeDb;
    const before = Date.now();

    await createPgDeviceStateStore(db).upsertDesired({ ...lampInput });

    expect(values).toHaveBeenCalledTimes(1);
    const row = values.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      id: "lgt_globe",
      kind: "light",
      entityId: "light.living_room_globe",
      domain: "light",
      label: "Globe",
      desiredState: { on: true, brightness: 200 },
      available: true,
    });
    const at = (row.desiredAtUtc as Date).getTime();
    const until = (row.desiredUntilUtc as Date).getTime();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(until).toBe(at + COMMAND_WINDOW_MS);
  });

  it("resolves the conflict on entityId, updating only the desired columns", async () => {
    const { insert, onConflictDoUpdate } = insertChain();
    const db = { insert } as unknown as FakeDb;

    await createPgDeviceStateStore(db).upsertDesired({ ...lampInput });

    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    const conflict = onConflictDoUpdate.mock.calls[0]?.[0] as {
      target: unknown;
      set: Record<string, unknown>;
    };
    expect(conflict.target).toBe(deviceState.entityId);
    expect(Object.keys(conflict.set).sort()).toEqual([
      "desiredAtUtc",
      "desiredState",
      "desiredUntilUtc",
    ]);
    expect(conflict.set.desiredState).toEqual({ on: true, brightness: 200 });
  });

  it("honors a custom windowMs override", async () => {
    const { insert, values } = insertChain();
    const db = { insert } as unknown as FakeDb;

    await createPgDeviceStateStore(db).upsertDesired({ ...lampInput, windowMs: 60_000 });

    const row = values.mock.calls[0]?.[0] as Record<string, unknown>;
    const at = (row.desiredAtUtc as Date).getTime();
    const until = (row.desiredUntilUtc as Date).getTime();
    expect(until).toBe(at + 60_000);
  });
});

// ─── updateDesired ─────────────────────────────────────────────────────────

describe("updateDesired", () => {
  it("updates the desired columns (+ command window) keyed on id", async () => {
    const { update, set, where } = updateChain();
    const db = { update } as unknown as FakeDb;
    const before = Date.now();

    await createPgDeviceStateStore(db).updateDesired({
      id: "climate-thermostat",
      desired: { mode: "cool", target: 70 },
    });

    expect(set).toHaveBeenCalledTimes(1);
    const payload = set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      "desiredAtUtc",
      "desiredState",
      "desiredUntilUtc",
    ]);
    expect(payload.desiredState).toEqual({ mode: "cool", target: 70 });
    const at = (payload.desiredAtUtc as Date).getTime();
    const until = (payload.desiredUntilUtc as Date).getTime();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(until).toBe(at + COMMAND_WINDOW_MS);
    expect(eq).toHaveBeenCalledWith(deviceState.id, "climate-thermostat");
    expect(where).toHaveBeenCalledTimes(1);
  });
});

// ─── clearDesired ──────────────────────────────────────────────────────────

describe("clearDesired", () => {
  it("nulls the desired triple, keyed on id", async () => {
    const { update, set, where } = updateChain();
    const db = { update } as unknown as FakeDb;

    await createPgDeviceStateStore(db).clearDesired("lgt_globe");

    expect(set).toHaveBeenCalledWith({
      desiredState: null,
      desiredAtUtc: null,
      desiredUntilUtc: null,
    });
    expect(eq).toHaveBeenCalledWith(deviceState.id, "lgt_globe");
    expect(where).toHaveBeenCalledTimes(1);
  });
});

// ─── writeReported ─────────────────────────────────────────────────────────

describe("writeReported", () => {
  it("sets reportedState/reportedAtUtc/available/updatedAtUtc, keyed on id", async () => {
    const { update, set, where } = updateChain();
    const db = { update } as unknown as FakeDb;
    const now = new Date("2026-01-01T00:00:00Z");

    await createPgDeviceStateStore(db).writeReported({
      id: "lgt_globe",
      reported: { on: true, brightness: 100 },
      available: true,
      now,
    });

    expect(set).toHaveBeenCalledWith({
      reportedState: { on: true, brightness: 100 },
      reportedAtUtc: now,
      available: true,
      updatedAtUtc: now,
    });
    expect(eq).toHaveBeenCalledWith(deviceState.id, "lgt_globe");
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("changed:true additionally sets reportedChangedAtUtc", async () => {
    const { update, set } = updateChain();
    const db = { update } as unknown as FakeDb;
    const now = new Date("2026-01-01T00:00:00Z");

    await createPgDeviceStateStore(db).writeReported({
      id: "lgt_globe",
      reported: { on: true },
      available: true,
      changed: true,
      now,
    });

    const payload = set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.reportedChangedAtUtc).toEqual(now);
  });

  it("adoptDesired additionally sets desiredState/desiredAtUtc (no desiredUntilUtc touch)", async () => {
    const { update, set } = updateChain();
    const db = { update } as unknown as FakeDb;
    const now = new Date("2026-01-01T00:00:00Z");

    await createPgDeviceStateStore(db).writeReported({
      id: "lgt_globe",
      reported: { on: false },
      available: true,
      adoptDesired: { on: false },
      now,
    });

    const payload = set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.desiredState).toEqual({ on: false });
    expect(payload.desiredAtUtc).toEqual(now);
    expect(payload).not.toHaveProperty("desiredUntilUtc");
  });

  it("changed absent/false and no adoptDesired touches neither extra column", async () => {
    const { update, set } = updateChain();
    const db = { update } as unknown as FakeDb;
    const now = new Date("2026-01-01T00:00:00Z");

    await createPgDeviceStateStore(db).writeReported({
      id: "lgt_globe",
      reported: { on: true },
      available: true,
      now,
    });

    const payload = set.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      "available",
      "reportedAtUtc",
      "reportedState",
      "updatedAtUtc",
    ]);
  });
});
