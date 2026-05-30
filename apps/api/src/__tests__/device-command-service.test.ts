/**
 * Tests for device-command-service.
 * Mocks DB and HA; verifies DB writes and HA dispatch behaviour.
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

const { mockCallService } = vi.hoisted(() => ({
  mockCallService: vi.fn(),
}));

vi.mock("../integrations/homeassistant", () => ({
  ha: {
    callService: mockCallService,
  },
}));

// ─── import after mocks ──────────────────────────────────────────────────────

import { commandDevice } from "../services/device-command-service";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeDevice(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "dev-1",
    kind: "light",
    entityId: "light.lamp",
    domain: "light",
    label: "Lamp",
    reportedState: { on: false },
    desiredState: null,
    desiredUntilUtc: null,
    desiredAtUtc: null,
    reportedAtUtc: null,
    reportedChangedAtUtc: null,
    available: true,
    createdAtUtc: new Date(),
    updatedAtUtc: new Date(),
    ...overrides,
  };
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe("commandDevice", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCallService.mockResolvedValue(undefined);
  });

  it("writes desiredState to DB and inserts pending command row", async () => {
    const device = makeDevice();

    // select().from().where().limit() — load device
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([device]),
    };
    mockDbSelect.mockReturnValue(selectChain);

    // update().set().where() — write desired state
    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    mockDbUpdate.mockReturnValue(updateChain);

    // insert().values().returning() — insert command row
    const insertChain = {
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 99 }]),
    };
    mockDbInsert.mockReturnValue(insertChain);

    const result = await commandDevice({ id: "dev-1", action: "setOn", args: { on: true } });

    expect(result.status).toBe("pending");
    expect(result.commandId).toBe(99);

    // desiredState written
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ desiredState: { on: true } }),
    );

    // command row inserted as pending
    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({ status: "pending", action: "setOn" }),
    );
  });

  it("throws when device not found in DB", async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    mockDbSelect.mockReturnValue(selectChain);

    await expect(
      commandDevice({ id: "missing", action: "setOn", args: { on: true } }),
    ).rejects.toThrow("Device missing not found");
  });

  it("calls ha.callService asynchronously via enqueueDispatch", async () => {
    const device = makeDevice();

    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([device]),
    };
    mockDbSelect.mockReturnValue(selectChain);

    const updateChain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    };
    mockDbUpdate.mockReturnValue(updateChain);

    const insertChain = {
      values: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 7 }]),
    };
    mockDbInsert.mockReturnValue(insertChain);

    await commandDevice({ id: "dev-1", action: "setOn", args: { on: false } });

    // Give microtask queue a chance to run the dispatch
    await new Promise((r) => setTimeout(r, 10));

    expect(mockCallService).toHaveBeenCalledWith("light", "turn_off", { entity_id: "light.lamp" });
  });
});
