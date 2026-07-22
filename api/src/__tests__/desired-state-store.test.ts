/**
 * Direct tests for the desired-state store (the single write path onto
 * device_state's desired columns, www-unxz). Proves the three invariants every
 * caller now inherits: the command-window stamp, `desiredAtUtc`, and the
 * throw-on-failure policy (a swallowed write would be fabricated success).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── mock the DB ──────────────────────────────────────────────────────────────

const { mockDbInsert, mockDbUpdate } = vi.hoisted(() => ({
  mockDbInsert: vi.fn(),
  mockDbUpdate: vi.fn(),
}));

vi.mock("../db/index", () => ({
  db: { insert: mockDbInsert, update: mockDbUpdate },
}));

// ─── import after mock ────────────────────────────────────────────────────────

import { deviceState } from "../db/schema";
import { COMMAND_WINDOW_MS } from "../services/command-window";
import { updateDesired, upsertDesired } from "../services/desired-state-store";
import { DeviceKind } from "../services/device-state-mapping";

// Capture the insert().values(v).onConflictDoUpdate(c) calls.
function insertBuilder() {
  const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
  mockDbInsert.mockReturnValue({ values });
  return { values, onConflictDoUpdate };
}

// Capture the update().set(v).where() call.
function updateBuilder() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  mockDbUpdate.mockReturnValue({ set });
  return { set, where };
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

describe("upsertDesired", () => {
  it("inserts a full row (available:true) stamping desiredAtUtc + a command window", async () => {
    const { values } = insertBuilder();
    const before = Date.now();

    await upsertDesired({ ...lampInput });

    expect(values).toHaveBeenCalledTimes(1);
    const row = values.mock.calls[0][0] as Record<string, unknown>;
    expect(row).toMatchObject({
      id: "lgt_globe",
      kind: "light",
      entityId: "light.living_room_globe",
      domain: "light",
      label: "Globe",
      desiredState: { on: true, brightness: 200 },
      available: true,
    });
    // desiredAtUtc is "now"; desiredUntilUtc is now + the command window.
    const at = (row.desiredAtUtc as Date).getTime();
    const until = (row.desiredUntilUtc as Date).getTime();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(until).toBe(at + COMMAND_WINDOW_MS);
  });

  it("resolves the conflict on entityId, updating only the desired columns", async () => {
    const { onConflictDoUpdate } = insertBuilder();

    await upsertDesired({ ...lampInput });

    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    const conflict = onConflictDoUpdate.mock.calls[0][0] as {
      target: unknown;
      set: Record<string, unknown>;
    };
    // Keyed on entityId (the stable natural key the enforcer also seeds against).
    expect(conflict.target).toBe(deviceState.entityId);
    // The conflict set touches ONLY desired + stamps , never reported/availability.
    expect(Object.keys(conflict.set).sort()).toEqual([
      "desiredAtUtc",
      "desiredState",
      "desiredUntilUtc",
    ]);
    expect(conflict.set.desiredState).toEqual({ on: true, brightness: 200 });
  });

  it("honors a custom windowMs override", async () => {
    const { values } = insertBuilder();

    await upsertDesired({ ...lampInput, windowMs: 60_000 });

    const row = values.mock.calls[0][0] as Record<string, unknown>;
    const at = (row.desiredAtUtc as Date).getTime();
    const until = (row.desiredUntilUtc as Date).getTime();
    expect(until).toBe(at + 60_000);
  });

  it("propagates a DB failure (a swallowed write would be fabricated success)", async () => {
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockRejectedValue(new Error("DB unreachable")),
      }),
    });

    await expect(upsertDesired({ ...lampInput })).rejects.toThrow("DB unreachable");
  });
});

describe("updateDesired", () => {
  it("updates the desired columns (+ command window) keyed on id", async () => {
    const { set } = updateBuilder();
    const before = Date.now();

    await updateDesired({ id: "climate-thermostat", desired: { mode: "cool", target: 70 } });

    expect(set).toHaveBeenCalledTimes(1);
    const payload = set.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.desiredState).toEqual({ mode: "cool", target: 70 });
    const at = (payload.desiredAtUtc as Date).getTime();
    const until = (payload.desiredUntilUtc as Date).getTime();
    expect(at).toBeGreaterThanOrEqual(before);
    expect(until).toBe(at + COMMAND_WINDOW_MS);
  });

  it("is a no-op (no throw) when the row does not exist , existence is the caller's job", async () => {
    // drizzle's update-where affects zero rows and does not reject; the store does
    // NOT probe existence (the caller reads the row to derive the merged desired).
    updateBuilder();

    await expect(
      updateDesired({ id: "missing", desired: { mode: "off" } }),
    ).resolves.toBeUndefined();
  });

  it("propagates a DB failure", async () => {
    mockDbUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error("DB unreachable")),
      }),
    });

    await expect(
      updateDesired({ id: "climate-thermostat", desired: { mode: "cool" } }),
    ).rejects.toThrow("DB unreachable");
  });
});
