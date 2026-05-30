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

import { mergeDeviceState, reconcile, sweepExpiredWindows } from "../services/device-sync-service";

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

describe("mergeDeviceState", () => {
  it("returns desiredState with pending=true when window is active", () => {
    const now = new Date();
    const future = new Date(now.getTime() + 3_000);
    const device = makeDevice({
      reportedState: { on: false },
      desiredState: { on: true },
      desiredUntilUtc: future,
      available: true,
    });

    const result = mergeDeviceState(device as Parameters<typeof mergeDeviceState>[0], now);
    expect(result).toEqual({ state: { on: true }, pending: true, available: true });
  });

  it("returns reportedState with pending=false when no desired window", () => {
    const now = new Date();
    const device = makeDevice({
      reportedState: { on: false },
      desiredState: null,
      desiredUntilUtc: null,
      available: true,
    });

    const result = mergeDeviceState(device as Parameters<typeof mergeDeviceState>[0], now);
    expect(result).toEqual({ state: { on: false }, pending: false, available: true });
  });

  it("returns reportedState with pending=false when desired window has expired", () => {
    const now = new Date();
    const past = new Date(now.getTime() - 1_000);
    const device = makeDevice({
      reportedState: { on: true },
      desiredState: { on: false },
      desiredUntilUtc: past,
      available: true,
    });

    const result = mergeDeviceState(device as Parameters<typeof mergeDeviceState>[0], now);
    expect(result).toEqual({ state: { on: true }, pending: false, available: true });
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
