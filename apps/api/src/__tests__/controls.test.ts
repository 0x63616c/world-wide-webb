/**
 * Unit tests for the controls service + router.
 *
 * All network/HA calls are mocked via vi.mock — no Postgres or real HA needed.
 * The DB is also mocked since controls-service now queries deviceState.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── mock the HA singleton ────────────────────────────────────────────────────

const { mockIsConfigured, mockGetEntities, mockCallService } = vi.hoisted(() => ({
  mockIsConfigured: vi.fn<() => boolean>(),
  mockGetEntities: vi.fn<(domain: string) => Promise<unknown>>(),
  mockCallService: vi.fn<() => Promise<void>>(),
}));

vi.mock("../integrations/homeassistant", () => ({
  ha: {
    isConfigured: mockIsConfigured,
    getEntities: mockGetEntities,
    callService: mockCallService,
  },
}));

// ─── mock the DB ──────────────────────────────────────────────────────────────

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

// ─── mock device-command-service ─────────────────────────────────────────────

const { mockCommandDevice } = vi.hoisted(() => ({
  mockCommandDevice:
    vi.fn<(input: { id: string; action: string; args: { on?: boolean } }) => Promise<unknown>>(),
}));

vi.mock("../services/device-command-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/device-command-service")>();
  return {
    ...actual,
    commandDevice: mockCommandDevice,
  };
});

// ─── import after mock ────────────────────────────────────────────────────────

import { LAMP_ENTITY_IDS } from "../config/lights";
import {
  ControlKey,
  FanMode,
  getControlsState,
  HaService,
  toggleControl,
} from "../services/controls-service";
import { DeviceAction } from "../services/device-command-service";
import { router } from "../trpc/init";
import { controlsRouter } from "../trpc/routers/controls";

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Create a lamp entity with an entity_id that matches the LIGHTS config.
 * All lamps are Hue bulbs on the light.* domain.
 */
function makeLamp(entityId: string, state: "on" | "off", kelvin = 2700) {
  return {
    entity_id: entityId,
    state,
    attributes: { friendly_name: entityId, color_temp_kelvin: kelvin },
    last_updated: new Date().toISOString(),
  };
}

/**
 * Create a switch-domain fixture entity matching the LIGHTS config.
 */
function makeFixture(entityId: string, state: "on" | "off") {
  return {
    entity_id: entityId,
    state,
    attributes: { friendly_name: entityId },
    last_updated: new Date().toISOString(),
  };
}

/** Legacy alias — used in tests that only care about fan entities. */
function makeLight(id: string, state: "on" | "off") {
  return {
    entity_id: `light.${id}_ceiling`,
    state,
    attributes: { friendly_name: `${id} Ceiling` },
    last_updated: new Date().toISOString(),
  };
}

function makeFan(id: string, state: "on" | "off", percentage?: number) {
  return {
    entity_id: `fan.${id}`,
    state,
    attributes: { friendly_name: id, ...(percentage !== undefined ? { percentage } : {}) },
    last_updated: new Date().toISOString(),
  };
}

// evee parity: the "fan" is a climate entity's fan_mode, not a fan.* device.
function makeClimateFan(id: string, fanMode: "on" | "auto") {
  return {
    entity_id: `climate.${id}`,
    state: "cool",
    attributes: { friendly_name: id, fan_modes: ["auto", "on"], fan_mode: fanMode },
    last_updated: new Date().toISOString(),
  };
}

// Build a chainable query mock. Every builder method returns a chain
// that ultimately resolves to `rows` when awaited.
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

// Chainable insert mock for db.insert().values().onConflictDoUpdate()
class InsertChain {
  values(): this {
    return this;
  }
  returning(): Promise<unknown[]> {
    return Promise.resolve([]);
  }
  onConflictDoUpdate(): Promise<void> {
    return Promise.resolve();
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable for drizzle mock
  then<R>(
    onFulfilled: (v: undefined) => R | PromiseLike<R>,
    onRejected?: (e: unknown) => R | PromiseLike<R>,
  ): Promise<R> {
    return Promise.resolve(undefined).then(onFulfilled, onRejected);
  }
}

function makeInsertChain(): InsertChain {
  return new InsertChain();
}

// Make a deviceState row with typical fields
function makeDeviceRow(
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
    id: overrides.id ?? "dev-1",
    kind: overrides.kind ?? "light",
    entityId: overrides.entityId ?? "light.lamp",
    domain: overrides.domain ?? "light",
    label: overrides.label ?? "Lamp",
    reportedState: overrides.reportedState ?? { on: false },
    desiredState: overrides.desiredState ?? null,
    desiredUntilUtc: overrides.desiredUntilUtc ?? null,
    desiredAtUtc: null,
    reportedAtUtc: null,
    reportedChangedAtUtc: null,
    available: overrides.available ?? true,
    createdAtUtc: new Date(),
    updatedAtUtc: new Date(),
  };
}

// Build a minimal caller context for the tRPC router.
function buildCaller() {
  const appRouter = router({ controls: controlsRouter });
  // @ts-expect-error — db not needed by controls procedures (they use global db)
  return appRouter.createCaller({ db: null });
}

// ─── service tests ────────────────────────────────────────────────────────────

describe("getControlsState", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null (shimmer-compatible) when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const state = await getControlsState();

    expect(state).toBeNull();
  });

  it("returns null on HA network error", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockRejectedValue(new Error("Network error"));
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const state = await getControlsState();

    expect(state).toBeNull();
  });

  it("computes lamp state from device rows with pending:false when no desired window", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockImplementation(async (domain: string) => {
      if (domain === "light") {
        // Use real entity IDs from the config so resolveEntities() finds them.
        return [
          makeLamp("light.living_room_globe", "on", 2700),
          makeLamp("light.bed_lamp_left", "on", 3000),
        ];
      }
      if (domain === "switch") {
        return [makeFixture("switch.overhead_lights", "off")];
      }
      return [];
    });

    const lampRows = [
      makeDeviceRow({
        id: "lamp-1",
        entityId: "light.living_room_globe",
        kind: "light",
        label: "Globe",
        reportedState: { on: true },
        available: true,
      }),
      makeDeviceRow({
        id: "lamp-2",
        entityId: "light.bed_lamp_left",
        kind: "light",
        label: "Bed Left",
        reportedState: { on: true },
        available: true,
      }),
    ];
    const fixtureRows = [
      makeDeviceRow({
        id: "fix-1",
        entityId: "switch.overhead_lights",
        kind: "switch",
        domain: "switch",
        label: "Overhead",
        reportedState: { on: false },
        available: true,
      }),
    ];
    mockDbSelect.mockReturnValue(makeSelectChain([...lampRows, ...fixtureRows]));

    const state = await getControlsState();

    expect(state).not.toBeNull();
    expect(state?.lamps.on).toBe(true);
    expect(state?.lamps.count).toBe(2);
    expect(state?.lights.on).toBe(false);
    expect(state?.lamps.pending).toBe(false);
  });

  it("returns pending:true on a control when desiredUntilUtc is in the future", async () => {
    mockIsConfigured.mockReturnValue(true);
    // Lamps carry the optimistic overlay (fan is climate fan_mode, no overlay).
    mockGetEntities.mockImplementation(async (domain: string) =>
      domain === "light"
        ? [
            {
              entity_id: "light.living_room_globe",
              state: "off",
              attributes: { friendly_name: "Globe" },
              last_updated: new Date().toISOString(),
            },
          ]
        : [],
    );

    const future = new Date(Date.now() + 3_000);
    const lampRow = makeDeviceRow({
      id: "lamp-1",
      entityId: "light.living_room_globe",
      kind: "light",
      domain: "light",
      label: "Globe",
      reportedState: { on: false },
      desiredState: { on: true },
      desiredUntilUtc: future,
      available: true,
    });
    mockDbSelect.mockReturnValue(makeSelectChain([lampRow]));

    const state = await getControlsState();

    expect(state?.lamps.pending).toBe(true);
  });

  it("returns pending:false and reportedState after desiredUntilUtc expires", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockImplementation(async () => [makeFan("living_room", "off")]);

    const past = new Date(Date.now() - 1_000);
    const fanRow = makeDeviceRow({
      id: "fan-1",
      entityId: "fan.living_room",
      kind: "light",
      domain: "fan",
      label: "Fan",
      reportedState: { on: false },
      desiredState: { on: true },
      desiredUntilUtc: past,
      available: true,
    });
    mockDbSelect.mockReturnValue(makeSelectChain([fanRow]));

    const state = await getControlsState();

    expect(state?.fan.on).toBe(false);
    expect(state?.fan.pending).toBe(false);
  });

  it("reports fan on from climate fan_mode", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockImplementation(async (domain: string) =>
      domain === "climate" ? [makeClimateFan("living_room", "on")] : [],
    );
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const state = await getControlsState();

    expect(state?.fan.on).toBe(true);
    expect(state?.fan.sub).toBe("On");
  });

  it("CC-azw: switch-domain fixtures are visible as 'lights' (not invisible)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockImplementation(async (domain: string) => {
      if (domain === "switch") {
        // overhead_lights is in the LIGHTS config as a fixture.
        return [makeFixture("switch.overhead_lights", "on")];
      }
      return [];
    });
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const state = await getControlsState();

    // The fixture must be visible — lights.on should be true.
    expect(state?.lights.on).toBe(true);
  });

  it("CC-azw: Hue lamps on light.* domain classified as lamps (not fixtures)", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockImplementation(async (domain: string) => {
      if (domain === "light") {
        return [makeLamp("light.living_room_globe", "on", 2700)];
      }
      return [];
    });
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const state = await getControlsState();

    expect(state?.lamps.on).toBe(true);
    expect(state?.lamps.count).toBe(1);
    // Fixtures should not accidentally be counted as lamps.
    expect(state?.lights.on).toBe(false);
  });

  it("reports all off when no entities are on", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockImplementation(async (domain: string) => {
      if (domain === "light") {
        return [makeLamp("living", "off"), makeLight("kitchen", "off")];
      }
      if (domain === "fan") return [makeFan("ceiling", "off")];
      return [];
    });
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const state = await getControlsState();

    expect(state?.lamps.on).toBe(false);
    expect(state?.lamps.count).toBe(0);
    expect(state?.lamps.sub).toBe("Off");
    expect(state?.lights.on).toBe(false);
    expect(state?.fan.on).toBe(false);
  });
});

// ─── toggleControl tests ──────────────────────────────────────────────────────

describe("toggleControl", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCallService.mockResolvedValue(undefined);
    mockCommandDevice.mockResolvedValue({ id: "dev-x", commandId: 1, status: "pending" });
    mockDbInsert.mockReturnValue(makeInsertChain());
  });

  it("throws when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    await expect(toggleControl(ControlKey.Lamps, true)).rejects.toThrow(
      "Home Assistant is not configured",
    );
  });

  it("calls commandDevice for each lamp entity when toggling lamps on", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([]);

    const lampDeviceRows = [
      makeDeviceRow({ id: "lamp-1", entityId: "light.living_room_globe" }),
      makeDeviceRow({ id: "lamp-2", entityId: "light.living_room_corner_lamp" }),
      makeDeviceRow({ id: "lamp-3", entityId: "light.living_room_floor_lamp" }),
      makeDeviceRow({ id: "lamp-4", entityId: "light.kitchen_lamp" }),
      makeDeviceRow({ id: "lamp-5", entityId: "light.bed_lamp_left" }),
      makeDeviceRow({ id: "lamp-6", entityId: "light.bed_lamp_right" }),
    ];
    mockDbSelect.mockReturnValue(makeSelectChain(lampDeviceRows));

    await toggleControl(ControlKey.Lamps, true);

    expect(mockCommandDevice).toHaveBeenCalledTimes(6);
    expect(mockCommandDevice).toHaveBeenCalledWith({
      id: "lamp-1",
      action: DeviceAction.SetOn,
      args: { on: true },
    });
    expect(mockCommandDevice).toHaveBeenCalledWith({
      id: "lamp-6",
      action: DeviceAction.SetOn,
      args: { on: true },
    });
  });

  it("calls commandDevice for each fixture entity when toggling lights off", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([]);

    const fixtureRows = [
      makeDeviceRow({ id: "fix-1", entityId: "switch.overhead_lights", domain: "switch" }),
      makeDeviceRow({ id: "fix-2", entityId: "switch.under_cabinet", domain: "switch" }),
    ];
    mockDbSelect.mockReturnValue(makeSelectChain(fixtureRows));

    await toggleControl(ControlKey.Lights, false);

    expect(mockCommandDevice).toHaveBeenCalledTimes(2);
    expect(mockCommandDevice).toHaveBeenCalledWith({
      id: "fix-1",
      action: DeviceAction.SetOn,
      args: { on: false },
    });
    expect(mockCommandDevice).toHaveBeenCalledWith({
      id: "fix-2",
      action: DeviceAction.SetOn,
      args: { on: false },
    });
  });

  it("calls climate.set_fan_mode when toggling the fan on", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockImplementation(async (domain: string) =>
      domain === "climate" ? [makeClimateFan("living_room", "auto")] : [],
    );
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    await toggleControl(ControlKey.Fan, true);

    expect(mockCallService).toHaveBeenCalledWith("climate", HaService.SetFanMode, {
      entity_id: "climate.living_room",
      fan_mode: FanMode.On,
    });
  });

  it("dispatches a direct HA call for unregistered devices so toggles are never silent no-ops", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([]);
    // No device rows in DB — overlay is auto-upserted, command still reaches HA.
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    await expect(toggleControl(ControlKey.Lamps, true)).resolves.toBeDefined();
    expect(mockCommandDevice).not.toHaveBeenCalled();
    // Every lamp falls back to a direct, config-correct light.turn_on (regression: CC-5yh no-op).
    expect(mockCallService).toHaveBeenCalledTimes(LAMP_ENTITY_IDS.length);
    expect(mockCallService).toHaveBeenCalledWith("light", HaService.TurnOn, {
      entity_id: LAMP_ENTITY_IDS[0],
    });
  });

  it("CC-86l: auto-upserts desired-window overlay for unregistered lamp entities on toggle", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([]);
    // No rows — devices are not pre-seeded in device_state.
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    await toggleControl(ControlKey.Lamps, false);

    // db.insert must be called once per lamp entity to write the desired-window overlay.
    // This ensures getControlsState() holds the desired value during the 5 s window
    // and does NOT snap back to stale HA state.
    expect(mockDbInsert).toHaveBeenCalledTimes(LAMP_ENTITY_IDS.length);
  });

  it("no-ops gracefully when no fan entities exist", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([]);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    // Should resolve without throwing; commandDevice must NOT be called.
    await expect(toggleControl(ControlKey.Fan, true)).resolves.toBeDefined();
    expect(mockCommandDevice).not.toHaveBeenCalled();
  });

  it("CC-azw: switch-domain fixture toggle calls commandDevice, not direct callService", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([]);

    const fixtureRows = [
      makeDeviceRow({ id: "fix-1", entityId: "switch.overhead_lights", domain: "switch" }),
      makeDeviceRow({ id: "fix-2", entityId: "switch.under_cabinet", domain: "switch" }),
    ];
    mockDbSelect.mockReturnValue(makeSelectChain(fixtureRows));

    await toggleControl(ControlKey.Lights, true);

    expect(mockCommandDevice).toHaveBeenCalledTimes(2);
    // commandDevice handles HA dispatch internally — no direct callService from toggleControl.
    expect(mockCallService).not.toHaveBeenCalled();
  });

  it("CC-azw: registered lamp toggle uses commandDevice overlay, not direct callService", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([]);

    // Register ALL lamp entities so each takes the overlay path.
    const lampRows = LAMP_ENTITY_IDS.map((entityId, i) =>
      makeDeviceRow({ id: `lamp-${i}`, entityId }),
    );
    mockDbSelect.mockReturnValue(makeSelectChain(lampRows));

    await toggleControl(ControlKey.Lamps, false);

    expect(mockCommandDevice).toHaveBeenCalledTimes(LAMP_ENTITY_IDS.length);
    expect(mockCallService).not.toHaveBeenCalled();
  });
});

// ─── router (tRPC caller) tests ───────────────────────────────────────────────

describe("controlsRouter.list", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns null (shimmer-compatible) via tRPC caller when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const caller = buildCaller();
    const result = await caller.controls.list({});

    expect(result).toBeNull();
  });

  it("returns controls state via tRPC caller when HA is configured", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockImplementation(async (domain: string) => {
      // Use a real config entity ID so resolveEntities() recognises it as a lamp.
      if (domain === "light") return [makeLamp("light.living_room_globe", "on", 2700)];
      return [];
    });
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const caller = buildCaller();
    const result = await caller.controls.list({});

    expect(result?.lamps.on).toBe(true);
    expect(result?.lamps.pending).toBe(false);
  });

  it("returns controls state including pending:true when a device has active desired window", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockImplementation(async (domain: string) =>
      domain === "light"
        ? [
            {
              entity_id: "light.living_room_globe",
              state: "off",
              attributes: { friendly_name: "Globe" },
              last_updated: new Date().toISOString(),
            },
          ]
        : [],
    );

    const future = new Date(Date.now() + 3_000);
    const lampRow = makeDeviceRow({
      id: "lamp-1",
      entityId: "light.living_room_globe",
      kind: "light",
      domain: "light",
      label: "Globe",
      reportedState: { on: false },
      desiredState: { on: true },
      desiredUntilUtc: future,
      available: true,
    });
    mockDbSelect.mockReturnValue(makeSelectChain([lampRow]));

    const caller = buildCaller();
    const result = await caller.controls.list({});

    expect(result?.lamps.pending).toBe(true);
  });
});

describe("controlsRouter.toggle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCallService.mockResolvedValue(undefined);
  });

  it("returns merged state (not just { success: true }) including pending:true", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([makeFan("ceiling", "off")]);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const caller = buildCaller();
    const result = await caller.controls.toggle({ key: ControlKey.Fan, on: true });

    // Result should be the merged controls state shape, not { success: true }
    expect(result).toHaveProperty("fan");
    expect(result?.fan).toHaveProperty("pending");
    expect(result?.fan).toHaveProperty("on");
  });

  it("throws SERVICE_UNAVAILABLE when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const caller = buildCaller();
    await expect(caller.controls.toggle({ key: ControlKey.Lamps, on: true })).rejects.toMatchObject(
      {
        code: "SERVICE_UNAVAILABLE",
      },
    );
  });
});
