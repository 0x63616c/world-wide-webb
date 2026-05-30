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

// ─── import after mock ────────────────────────────────────────────────────────

import { getControlsState, toggleControl } from "../services/controls-service";
import { router } from "../trpc/init";
import { controlsRouter } from "../trpc/routers/controls";

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeLamp(id: string, state: "on" | "off", kelvin = 2700) {
  return {
    entity_id: `light.${id}_lamp`,
    state,
    attributes: { friendly_name: `${id} Lamp`, color_temp_kelvin: kelvin },
    last_updated: new Date().toISOString(),
  };
}

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
        return [
          makeLamp("living_room", "on", 2700),
          makeLamp("bedroom", "on", 3000),
          makeLight("kitchen", "off"),
        ];
      }
      return [];
    });

    const lampRows = [
      makeDeviceRow({
        id: "lamp-1",
        entityId: "light.living_room_lamp",
        kind: "light",
        label: "Living Room Lamp",
        reportedState: { on: true },
        available: true,
      }),
      makeDeviceRow({
        id: "lamp-2",
        entityId: "light.bedroom_lamp",
        kind: "light",
        label: "Bedroom Lamp",
        reportedState: { on: true },
        available: true,
      }),
    ];
    const lightRows = [
      makeDeviceRow({
        id: "ceil-1",
        entityId: "light.kitchen_ceiling",
        kind: "light",
        label: "Kitchen Ceiling",
        reportedState: { on: false },
        available: true,
      }),
    ];
    mockDbSelect.mockReturnValue(makeSelectChain([...lampRows, ...lightRows]));

    const state = await getControlsState();

    expect(state).not.toBeNull();
    expect(state?.lamps.on).toBe(true);
    expect(state?.lamps.count).toBe(2);
    expect(state?.lights.on).toBe(false);
    expect(state?.lamps.pending).toBe(false);
  });

  it("returns pending:true on a control when desiredUntilUtc is in the future", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockImplementation(async () => [makeFan("living_room", "off")]);

    const future = new Date(Date.now() + 3_000);
    const fanRow = makeDeviceRow({
      id: "fan-1",
      entityId: "fan.living_room",
      kind: "light",
      domain: "fan",
      label: "Fan",
      reportedState: { on: false },
      desiredState: { on: true },
      desiredUntilUtc: future,
      available: true,
    });
    mockDbSelect.mockReturnValue(makeSelectChain([fanRow]));

    const state = await getControlsState();

    expect(state?.fan.pending).toBe(true);
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

  it("reports fan on with speed label", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockImplementation(async (domain: string) => {
      if (domain === "fan") return [makeFan("living_room", "on", 50)];
      return [];
    });
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const state = await getControlsState();

    expect(state?.fan.on).toBe(true);
    expect(state?.fan.sub).toBe("Medium");
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
    expect(state?.lamps.sub).toBe("all off");
    expect(state?.lights.on).toBe(false);
    expect(state?.fan.on).toBe(false);
  });
});

// ─── toggleControl tests ──────────────────────────────────────────────────────

describe("toggleControl", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCallService.mockResolvedValue(undefined);
  });

  it("throws when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    await expect(toggleControl("lamps", true)).rejects.toThrow("Home Assistant is not configured");
  });

  it("calls light.turn_on with lamp entity ids", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([
      makeLamp("living", "off"),
      makeLamp("corner", "off"),
      makeLight("ceiling", "off"),
    ]);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    await toggleControl("lamps", true);

    expect(mockCallService).toHaveBeenCalledWith("light", "turn_on", {
      entity_id: ["light.living_lamp", "light.corner_lamp"],
    });
  });

  it("calls light.turn_off for lights key", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([
      makeLamp("corner", "on"),
      makeLight("kitchen", "on"),
      makeLight("living", "on"),
    ]);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    await toggleControl("lights", false);

    expect(mockCallService).toHaveBeenCalledWith("light", "turn_off", {
      entity_id: ["light.kitchen_ceiling", "light.living_ceiling"],
    });
  });

  it("calls fan.turn_on with first fan entity", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([makeFan("living_room", "off")]);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    await toggleControl("fan", true);

    expect(mockCallService).toHaveBeenCalledWith("fan", "turn_on", {
      entity_id: "fan.living_room",
    });
  });

  it("calls fan.turn_off with first fan entity", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([makeFan("bedroom", "on", 50)]);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    await toggleControl("fan", false);

    expect(mockCallService).toHaveBeenCalledWith("fan", "turn_off", {
      entity_id: "fan.bedroom",
    });
  });

  it("no-ops gracefully when no fan entities exist", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([]);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    // Should resolve without throwing; callService must NOT be called.
    await expect(toggleControl("fan", true)).resolves.toBeDefined();
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
      if (domain === "light") return [makeLamp("lr", "on", 2700)];
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
    mockGetEntities.mockImplementation(async () => [makeFan("ceiling", "off")]);

    const future = new Date(Date.now() + 3_000);
    const fanRow = makeDeviceRow({
      id: "fan-1",
      entityId: "fan.ceiling",
      kind: "light",
      domain: "fan",
      label: "Fan",
      reportedState: { on: false },
      desiredState: { on: true },
      desiredUntilUtc: future,
      available: true,
    });
    mockDbSelect.mockReturnValue(makeSelectChain([fanRow]));

    const caller = buildCaller();
    const result = await caller.controls.list({});

    expect(result?.fan.pending).toBe(true);
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
    const result = await caller.controls.toggle({ key: "fan", on: true });

    // Result should be the merged controls state shape, not { success: true }
    expect(result).toHaveProperty("fan");
    expect(result?.fan).toHaveProperty("pending");
    expect(result?.fan).toHaveProperty("on");
  });

  it("throws SERVICE_UNAVAILABLE when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const caller = buildCaller();
    await expect(caller.controls.toggle({ key: "lamps", on: true })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});
