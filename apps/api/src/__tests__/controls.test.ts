/**
 * Unit tests for the controls service + router.
 *
 * All network/HA calls are mocked via vi.mock — no Postgres or real HA needed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── mock the HA singleton ────────────────────────────────────────────────────
// vi.mock factories are hoisted, so mocks must be created inside vi.hoisted().

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

// Build a minimal caller context for the tRPC router (no DB needed for controls).
function buildCaller() {
  const appRouter = router({ controls: controlsRouter });
  // @ts-expect-error — db not needed by controls procedures
  return appRouter.createCaller({ db: null });
}

// ─── service tests ────────────────────────────────────────────────────────────

describe("getControlsState", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns fallback when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);

    const state = await getControlsState();

    expect(state.lamps.on).toBe(true);
    expect(state.lamps.count).toBe(2);
    expect(state.lamps.sub).toBe("2 on · warm");
    expect(state.lights.on).toBe(false);
    expect(state.fan.on).toBe(false);
  });

  it("returns fallback on HA network error", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockRejectedValue(new Error("Network error"));

    const state = await getControlsState();

    expect(state.lamps.on).toBe(true); // fallback
    expect(state.lights.on).toBe(false);
    expect(state.fan.on).toBe(false);
  });

  it("computes lamp state from HA light entities", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockImplementation(async (domain: string) => {
      if (domain === "light") {
        return [
          makeLamp("living_room", "on", 2700),
          makeLamp("bedroom", "on", 3000),
          makeLight("kitchen", "off"),
        ];
      }
      return []; // no fans
    });

    const state = await getControlsState();

    expect(state.lamps.on).toBe(true);
    expect(state.lamps.count).toBe(2);
    expect(state.lamps.sub).toBe("2 on · warm");
    expect(state.lights.on).toBe(false);
    expect(state.fan.on).toBe(false);
  });

  it("reports lights on when a ceiling entity is on", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockImplementation(async (domain: string) => {
      if (domain === "light") {
        return [makeLamp("corner", "off"), makeLight("living_room", "on")];
      }
      return [];
    });

    const state = await getControlsState();

    expect(state.lights.on).toBe(true);
    expect(state.lamps.on).toBe(false);
    expect(state.lamps.count).toBe(0);
  });

  it("reports fan on with speed label", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockImplementation(async (domain: string) => {
      if (domain === "fan") return [makeFan("living_room", "on", 50)];
      return [];
    });

    const state = await getControlsState();

    expect(state.fan.on).toBe(true);
    expect(state.fan.sub).toBe("Medium");
  });

  it("reports fan Low when percentage <= 33", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockImplementation(async (domain: string) => {
      if (domain === "fan") return [makeFan("living_room", "on", 20)];
      return [];
    });

    const state = await getControlsState();

    expect(state.fan.sub).toBe("Low");
  });

  it("reports fan High when percentage > 66", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockImplementation(async (domain: string) => {
      if (domain === "fan") return [makeFan("living_room", "on", 90)];
      return [];
    });

    const state = await getControlsState();

    expect(state.fan.sub).toBe("High");
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

    const state = await getControlsState();

    expect(state.lamps.on).toBe(false);
    expect(state.lamps.count).toBe(0);
    expect(state.lamps.sub).toBe("all off");
    expect(state.lights.on).toBe(false);
    expect(state.fan.on).toBe(false);
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

    await expect(toggleControl("lamps", true)).rejects.toThrow("Home Assistant is not configured");
  });

  it("calls light.turn_on with lamp entity ids", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([
      makeLamp("living", "off"),
      makeLamp("corner", "off"),
      makeLight("ceiling", "off"),
    ]);

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

    await toggleControl("lights", false);

    expect(mockCallService).toHaveBeenCalledWith("light", "turn_off", {
      entity_id: ["light.kitchen_ceiling", "light.living_ceiling"],
    });
  });

  it("calls fan.turn_on with first fan entity", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([makeFan("living_room", "off")]);

    await toggleControl("fan", true);

    expect(mockCallService).toHaveBeenCalledWith("fan", "turn_on", {
      entity_id: "fan.living_room",
    });
  });

  it("calls fan.turn_off with first fan entity", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([makeFan("bedroom", "on", 50)]);

    await toggleControl("fan", false);

    expect(mockCallService).toHaveBeenCalledWith("fan", "turn_off", {
      entity_id: "fan.bedroom",
    });
  });

  it("no-ops gracefully when no fan entities exist", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([]);

    await expect(toggleControl("fan", true)).resolves.toBeUndefined();
    expect(mockCallService).not.toHaveBeenCalled();
  });
});

// ─── router (tRPC caller) tests ───────────────────────────────────────────────

describe("controlsRouter.list", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns controls state via tRPC caller", async () => {
    mockIsConfigured.mockReturnValue(false); // triggers fallback

    const caller = buildCaller();
    const result = await caller.controls.list({});

    expect(result).toMatchObject({
      lamps: { on: true, count: 2 },
      lights: { on: false },
      fan: { on: false },
    });
  });
});

describe("controlsRouter.toggle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCallService.mockResolvedValue(undefined);
  });

  it("returns success when HA responds", async () => {
    mockIsConfigured.mockReturnValue(true);
    mockGetEntities.mockResolvedValue([makeFan("ceiling", "off")]);

    const caller = buildCaller();
    const result = await caller.controls.toggle({ key: "fan", on: true });

    expect(result).toEqual({ success: true });
  });

  it("throws SERVICE_UNAVAILABLE when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);

    const caller = buildCaller();
    await expect(caller.controls.toggle({ key: "lamps", on: true })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
  });
});
