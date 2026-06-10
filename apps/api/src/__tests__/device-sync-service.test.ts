/**
 * Tests for device-sync-service.
 * Mocks DB and HA; tests reconcile logic and sweep behaviour.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── mock DB ──────────────────────────────────────────────────────────────────

const { mockDbSelect, mockDbUpdate, mockDbInsert } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbInsert: vi.fn(),
}));

vi.mock("../db/index", () => ({
  db: {
    select: mockDbSelect,
    update: mockDbUpdate,
    insert: mockDbInsert,
  },
}));

// ─── mock HA ─────────────────────────────────────────────────────────────────

const { mockGetEntities } = vi.hoisted(() => ({
  mockGetEntities: vi.fn(),
}));

vi.mock("../integrations/homeassistant", () => ({
  ha: {
    getEntities: mockGetEntities,
  },
}));

// ─── import after mocks ──────────────────────────────────────────────────────

import { mergeDeviceState } from "../services/device-state-mapping";
import {
  reconcile,
  runDeviceSyncCycle,
  sweepExpiredWindows,
} from "../services/device-sync-service";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeDevice(
  overrides: Partial<{
    id: string;
    kind: string;
    entityId: string;
    domain: string;
    label: string;
    reportedState: unknown;
    desiredState: unknown;
    desiredUntilUtc: Date | null;
    available: boolean;
  }> = {},
) {
  return {
    id: "dev-1",
    kind: "light",
    entityId: "light.lamp",
    domain: "light",
    label: "Lamp",
    reportedState: null,
    desiredState: null,
    desiredUntilUtc: null,
    reportedAtUtc: null,
    reportedChangedAtUtc: null,
    desiredAtUtc: null,
    available: false,
    createdAtUtc: new Date(),
    updatedAtUtc: new Date(),
    ...overrides,
  };
}

// Build a chainable query mock. Every builder method returns a chain
// that ultimately resolves to `rows` when awaited. The chain uses a
// lazy-Promise wrapper to defer resolution — avoids object-literal `then`
// which Biome's noThenProperty rule flags.
class SelectChain {
  private readonly rows: unknown[];
  constructor(rows: unknown[]) {
    this.rows = rows;
  }
  from(): this {
    return this;
  }
  where(): this {
    return this;
  }
  orderBy(): this {
    return this;
  }
  limit(): Promise<unknown[]> {
    return Promise.resolve(this.rows);
  }
  // Allows `await chain` to resolve without a literal `then` property.
  [Symbol.toStringTag] = "SelectChain";
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable for drizzle mock
  then<R>(
    onFulfilled: (v: unknown[]) => R | PromiseLike<R>,
    onRejected?: (e: unknown) => R | PromiseLike<R>,
  ): Promise<R> {
    return Promise.resolve(this.rows).then(onFulfilled, onRejected);
  }
  catch<R>(onRejected: (e: unknown) => R | PromiseLike<R>): Promise<unknown[] | R> {
    return Promise.resolve(this.rows).catch(onRejected);
  }
  finally(onFinally?: (() => void) | null): Promise<unknown[]> {
    return Promise.resolve(this.rows).finally(onFinally ?? undefined);
  }
}

function makeSelectChain(rows: unknown[]): SelectChain {
  return new SelectChain(rows);
}

// ─── mergeDeviceState tests ──────────────────────────────────────────────────

// Desired-authoritative (CC-7d5b.2.4): desired is the effective state when
// present; pending means HA has not yet converged with it. The old 5s
// desiredUntilUtc window is retired.
describe("mergeDeviceState", () => {
  it("returns desiredState with pending=true while reported has not converged", () => {
    const device = makeDevice({
      reportedState: { on: false },
      desiredState: { on: true },
      available: true,
    });

    const result = mergeDeviceState(device as Parameters<typeof mergeDeviceState>[0]);
    // on differs (reported off, desired on) → not converged → pending.
    expect(result).toEqual({ state: { on: true }, pending: true, available: true });
  });

  it("returns desiredState with pending=false once reported converges (within tolerance)", () => {
    const device = makeDevice({
      reportedState: { on: true, brightness: 200, color: { rgb: [0, 2, 254] } },
      desiredState: { on: true, brightness: 200, color: { rgb: [0, 0, 255] } },
      available: true,
    });

    const result = mergeDeviceState(device as Parameters<typeof mergeDeviceState>[0]);
    expect(result.state).toEqual({ on: true, brightness: 200, color: { rgb: [0, 0, 255] } });
    expect(result.pending).toBe(false);
  });

  it("returns reportedState with pending=false when desired is null", () => {
    const device = makeDevice({
      reportedState: { on: false },
      desiredState: null,
      available: true,
    });

    const result = mergeDeviceState(device as Parameters<typeof mergeDeviceState>[0]);
    expect(result).toEqual({ state: { on: false }, pending: false, available: true });
  });

  // CC-7d5b.2.4 regression: desired is a PARTIAL overlay. A bare on/off toggle
  // writes only { on } — it must NOT zero out the brightness/colour the panel
  // shows, nor sit perpetually pending. Unspecified fields fall back to reported.
  it("overlays a bare {on} desired onto reported brightness/colour (no zeroing, not pending)", () => {
    const device = makeDevice({
      reportedState: { on: true, brightness: 200, color: { rgb: [255, 0, 0] } },
      desiredState: { on: true },
      available: true,
    });

    const result = mergeDeviceState(device as Parameters<typeof mergeDeviceState>[0]);
    // brightness + colour come from reported (desired didn't specify them).
    expect(result.state).toEqual({ on: true, brightness: 200, color: { rgb: [255, 0, 0] } });
    // Only `on` is specified and it matches → converged → not pending.
    expect(result.pending).toBe(false);
  });

  it("a SPECIFIED desired field still overrides reported and drives pending", () => {
    const device = makeDevice({
      reportedState: { on: true, brightness: 200, color: { rgb: [255, 0, 0] } },
      desiredState: { on: true, color: { rgb: [0, 0, 255] } },
      available: true,
    });

    const result = mergeDeviceState(device as Parameters<typeof mergeDeviceState>[0]);
    // Specified colour wins; unspecified brightness falls back to reported.
    expect(result.state).toEqual({ on: true, brightness: 200, color: { rgb: [0, 0, 255] } });
    // Specified colour diverges from reported → pending until the enforcer converges.
    expect(result.pending).toBe(true);
  });
});

// ─── reconcile tests ─────────────────────────────────────────────────────────

describe("reconcile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("updates reportedState when HA state changes", async () => {
    const device = makeDevice({
      reportedState: { on: false },
      available: true,
    });

    // All selects resolve to appropriate values
    mockDbSelect
      .mockReturnValueOnce(makeSelectChain([device])) // devices
      .mockReturnValue(makeSelectChain([])); // confirmLatestSentCommand / sweepExpiredWindows

    const updateSet = vi.fn().mockReturnThis();
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    mockDbUpdate.mockReturnValue({ set: updateSet, where: updateWhere });

    mockDbInsert.mockReturnValue({
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    });

    const snapshot = new Map([
      ["light.lamp", { entity_id: "light.lamp", state: "on", attributes: {}, last_updated: "" }],
    ]);

    await reconcile(snapshot);

    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ reportedState: { on: true }, available: true }),
    );
  });

  it("skips enforcer-managed lights — they are owned by the light enforcer (CC-7d5b.2.6)", async () => {
    // A real LIGHTS entry (light.living_room_globe) must be left entirely to the
    // enforcer; device-sync must not touch its reported/available state or it
    // would double-drive the lights. Fan stays device-sync's job.
    const managedLamp = makeDevice({
      id: "living-globe",
      entityId: "light.living_room_globe",
      reportedState: { on: false },
      available: true,
    });

    mockDbSelect
      .mockReturnValueOnce(makeSelectChain([managedLamp]))
      .mockReturnValue(makeSelectChain([]));

    const updateSet = vi.fn().mockReturnThis();
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    mockDbUpdate.mockReturnValue({ set: updateSet, where: updateWhere });
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    });

    // HA reports the lamp ON (would normally trigger a reportedState update).
    const snapshot = new Map([
      [
        "light.living_room_globe",
        { entity_id: "light.living_room_globe", state: "on", attributes: {}, last_updated: "" },
      ],
    ]);

    await reconcile(snapshot);

    // No write for the managed lamp.
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("skips speaker rows — they are owned by the sonos-volume-enforcer (CC-5mek)", async () => {
    // A speaker row's entityId is a LAN IP that never exists in the HA snapshot;
    // without the skip, device-sync would mark it unavailable every cycle and
    // fight the sonos-volume-enforcer.
    const speakerRow = makeDevice({
      id: "spk_192-168-0-193",
      kind: "speaker",
      entityId: "192.168.0.193",
      reportedState: { volume: 30 },
      desiredState: { volume: 30 },
      available: true,
    });

    mockDbSelect
      .mockReturnValueOnce(makeSelectChain([speakerRow]))
      .mockReturnValue(makeSelectChain([]));

    const updateSet = vi.fn().mockReturnThis();
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    mockDbUpdate.mockReturnValue({ set: updateSet, where: updateWhere });
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    });

    await reconcile(new Map());

    expect(updateSet).not.toHaveBeenCalled();
  });

  it("clears desiredUntilUtc early when HA state matches desiredState", async () => {
    const now = new Date();
    const future = new Date(now.getTime() + 3_000);
    const device = makeDevice({
      reportedState: null,
      desiredState: { on: true },
      desiredUntilUtc: future,
      available: true,
    });

    mockDbSelect
      .mockReturnValueOnce(makeSelectChain([device])) // devices
      .mockReturnValue(makeSelectChain([])); // confirmLatestSentCommand / sweepExpiredWindows

    const updateSet = vi.fn().mockReturnThis();
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    mockDbUpdate.mockReturnValue({ set: updateSet, where: updateWhere });

    mockDbInsert.mockReturnValue({
      values: vi.fn().mockReturnThis(),
      onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    });

    const snapshot = new Map([
      ["light.lamp", { entity_id: "light.lamp", state: "on", attributes: {}, last_updated: "" }],
    ]);

    await reconcile(snapshot);

    const setCalls = updateSet.mock.calls;
    const clearCall = setCalls.find(
      (c: unknown[]) =>
        typeof c[0] === "object" &&
        c[0] !== null &&
        "desiredUntilUtc" in (c[0] as Record<string, unknown>) &&
        (c[0] as Record<string, unknown>).desiredUntilUtc === null,
    );
    expect(clearCall).toBeDefined();
  });
});

// ─── sweepExpiredWindows tests ────────────────────────────────────────────────

describe("sweepExpiredWindows", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("never clears a speaker row's sticky desired — owned by the sonos-volume-enforcer (CC-5mek)", async () => {
    const now = new Date();
    const expiredSpeaker = makeDevice({
      id: "spk_192-168-0-193",
      kind: "speaker",
      entityId: "192.168.0.193",
      reportedState: { volume: 30 },
      desiredState: { volume: 55 },
      desiredUntilUtc: new Date(now.getTime() - 1_000),
      available: true,
    });

    mockDbSelect.mockReturnValue(makeSelectChain([expiredSpeaker]));

    const updateSet = vi.fn().mockReturnThis();
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    mockDbUpdate.mockReturnValue({ set: updateSet, where: updateWhere });

    await sweepExpiredWindows(now);

    expect(updateSet).not.toHaveBeenCalled();
  });

  it("marks command as timeout and clears overlay when window expires without confirmation", async () => {
    const now = new Date();
    const expired = makeDevice({
      reportedState: { on: false },
      desiredState: { on: true },
      desiredUntilUtc: new Date(now.getTime() - 1_000),
      available: true,
    });

    const sentCommand = { id: 42, status: "sent", action: "setOn", deviceId: "dev-1" };

    mockDbSelect
      .mockReturnValueOnce(makeSelectChain([expired])) // expired devices
      .mockReturnValueOnce(makeSelectChain([sentCommand])); // sent command lookup

    const updateSet = vi.fn().mockReturnThis();
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    mockDbUpdate.mockReturnValue({ set: updateSet, where: updateWhere });

    await sweepExpiredWindows(now);

    const clearCall = updateSet.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === "object" &&
        c[0] !== null &&
        "desiredUntilUtc" in (c[0] as Record<string, unknown>) &&
        (c[0] as Record<string, unknown>).desiredUntilUtc === null,
    );
    expect(clearCall).toBeDefined();

    const timeoutCall = updateSet.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === "object" &&
        c[0] !== null &&
        "status" in (c[0] as Record<string, unknown>) &&
        (c[0] as Record<string, unknown>).status === "timeout",
    );
    expect(timeoutCall).toBeDefined();
  });
});

// ─── heartbeat / consecutiveFailures transitions (CC-355t.9) ──────────────────

describe("runDeviceSyncCycle heartbeat", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("resets consecutiveFailures to 0 on a successful cycle", async () => {
    mockGetEntities.mockResolvedValue([]); // empty snapshot, reconcile no-ops
    mockDbSelect.mockReturnValue(makeSelectChain([])); // devices [], sweep []

    const insertValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) });
    mockDbInsert.mockReturnValue({ values: insertValues });

    await runDeviceSyncCycle();

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ lastError: null, consecutiveFailures: 0 }),
    );
  });

  it("increments consecutiveFailures from the prior streak on a failed cycle", async () => {
    mockGetEntities.mockRejectedValue(new Error("HA down")); // fetchSnapshot throws
    // currentFailureStreak() reads the prior row: 2 consecutive failures so far.
    mockDbSelect.mockReturnValue(makeSelectChain([{ n: 2 }]));

    const insertValues = vi
      .fn()
      .mockReturnValue({ onConflictDoUpdate: vi.fn().mockResolvedValue(undefined) });
    mockDbInsert.mockReturnValue({ values: insertValues });

    await runDeviceSyncCycle();

    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({ lastError: "HA down", consecutiveFailures: 3 }),
    );
  });
});
