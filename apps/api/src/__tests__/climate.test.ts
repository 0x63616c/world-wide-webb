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

// ─── mock the DB (climate is now desired-authoritative — read/write device_state) ─

const { mockDbSelect, mockDbUpdate } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
}));

vi.mock("../db/index", () => ({
  db: { select: mockDbSelect, update: mockDbUpdate },
}));

import type { HaEntity } from "../integrations/homeassistant/types";
import {
  getClimate,
  getClimateZones,
  HaHvacAction,
  HvacAction,
  HvacMode,
  isValidRange,
  resolveClimateEntityId,
  selectClimateEntity,
  setClimateFan,
  setClimateMode,
  setClimatePreset,
  setClimateRange,
  setClimateTarget,
  setZoneMode,
  setZoneRange,
  setZoneTarget,
} from "../services/climate-service";

function entity(partial: Partial<HaEntity> & { entity_id: string }): HaEntity {
  return { state: "off", attributes: {}, last_updated: "", ...partial };
}

// A thenable select chain that resolves to `rows` when awaited (drizzle mock).
class SelectChain {
  constructor(private readonly rows: unknown[]) {}
  from(): this {
    return this;
  }
  where(): this {
    return this;
  }
  limit(): Promise<unknown[]> {
    return Promise.resolve(this.rows);
  }
  // biome-ignore lint/suspicious/noThenProperty: intentional thenable for drizzle mock
  then<R>(onFulfilled: (v: unknown[]) => R | PromiseLike<R>): Promise<R> {
    return Promise.resolve(this.rows).then(onFulfilled);
  }
}

// An update chain that records the `.set()` payload so a test can assert the
// desired written (climate mutations no longer call HA — the write is the only
// observable side-effect).
function makeUpdateChain(setSpy: (payload: unknown) => void) {
  const chain = {
    set(payload: unknown) {
      setSpy(payload);
      return chain;
    },
    where() {
      return Promise.resolve();
    },
  };
  return chain;
}

// Build a device_state climate row (kind/domain "climate"); desired-authoritative.
function climateRow(
  desired: Record<string, unknown> | null,
  reported: Record<string, unknown> | null,
) {
  return {
    id: "climate-thermostat",
    kind: "climate",
    entityId: "climate.home",
    domain: "climate",
    label: "Thermostat",
    reportedState: reported,
    reportedAtUtc: new Date(),
    reportedChangedAtUtc: null,
    desiredState: desired,
    desiredAtUtc: new Date(),
    desiredUntilUtc: null,
    available: true,
    createdAtUtc: new Date(),
    updatedAtUtc: new Date(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsConfigured.mockReturnValue(true);
});

// ────────────────────────────────────────────────────────────────────────────
// selectClimateEntity() / resolveClimateEntityId() — house thermostat, not Tesla
// ────────────────────────────────────────────────────────────────────────────

describe("selectClimateEntity()", () => {
  it("prefers the configured CLIMATE_ENTITY_ID (climate.home) over alphabetical-first", () => {
    const picked = selectClimateEntity([
      entity({ entity_id: "climate.evee_climate" }), // Tesla, sorts first
      entity({ entity_id: "climate.home" }),
    ]);
    expect(picked?.entity_id).toBe("climate.home");
  });

  it("skips the Tesla entity when climate.home is absent", () => {
    const picked = selectClimateEntity([
      entity({ entity_id: "climate.evee_climate" }),
      entity({ entity_id: "climate.bedroom" }),
    ]);
    expect(picked?.entity_id).toBe("climate.bedroom");
  });

  it("falls back to the only entity even if it is the Tesla", () => {
    const picked = selectClimateEntity([entity({ entity_id: "climate.evee_climate" })]);
    expect(picked?.entity_id).toBe("climate.evee_climate");
  });

  it("returns undefined for an empty list", () => {
    expect(selectClimateEntity([])).toBeUndefined();
  });
});

describe("resolveClimateEntityId()", () => {
  it("returns the house thermostat, NOT the alphabetical-first Tesla", async () => {
    mockGetEntities.mockResolvedValueOnce([
      entity({ entity_id: "climate.evee_climate" }),
      entity({ entity_id: "climate.home" }),
    ]);
    expect(await resolveClimateEntityId()).toBe("climate.home");
  });

  it("returns undefined when HA not configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    expect(await resolveClimateEntityId()).toBeUndefined();
  });

  it("returns undefined when no entities", async () => {
    mockGetEntities.mockResolvedValueOnce([]);
    expect(await resolveClimateEntityId()).toBeUndefined();
  });

  it("returns undefined on network error", async () => {
    mockGetEntities.mockRejectedValueOnce(new Error("network error"));
    expect(await resolveClimateEntityId()).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getClimate() — real modes + single/range setpoints
// ────────────────────────────────────────────────────────────────────────────

describe("getClimate() (desired-authoritative, reads device_state — CC-unxz.2)", () => {
  it("builds a single-target state from the climate row, NO HA call", async () => {
    // desired carries mode+target; reported carries ambient/action (reported-only).
    mockDbSelect.mockReturnValue(
      new SelectChain([
        climateRow(
          { mode: HvacMode.Cool, target: 68 },
          { mode: HvacMode.Cool, ambient: 72, action: HaHvacAction.Cooling },
        ),
      ]),
    );
    expect(await getClimate()).toEqual({
      mode: HvacMode.Cool,
      target: 68,
      ambient: 72,
      action: HvacAction.Cooling,
    });
    expect(mockGetEntities).not.toHaveBeenCalled();
  });

  it("builds a heat_cool range state from the row", async () => {
    mockDbSelect.mockReturnValue(
      new SelectChain([
        climateRow(
          { mode: HvacMode.HeatCool, targetLow: 68, targetHigh: 76 },
          { mode: HvacMode.HeatCool, ambient: 73, action: "idle" },
        ),
      ]),
    );
    expect(await getClimate()).toEqual({
      mode: HvacMode.HeatCool,
      targetLow: 68,
      targetHigh: 76,
      ambient: 73,
      action: HvacAction.Idle,
    });
  });

  it("builds a no-setpoint off state from the row", async () => {
    mockDbSelect.mockReturnValue(
      new SelectChain([climateRow({ mode: HvacMode.Off }, { mode: HvacMode.Off, ambient: 71 })]),
    );
    expect(await getClimate()).toEqual({
      mode: HvacMode.Off,
      ambient: 71,
      action: HvacAction.Idle,
    });
  });

  it("desired mode overlays reported (the dashboard's intent wins for mode)", async () => {
    // Reported says cool (HA at wall), desired says off — the row reads off.
    mockDbSelect.mockReturnValue(
      new SelectChain([
        climateRow({ mode: HvacMode.Off }, { mode: HvacMode.Cool, ambient: 72, target: 70 }),
      ]),
    );
    expect((await getClimate()).mode).toBe(HvacMode.Off);
  });

  it("treats an unknown hvac mode as off", async () => {
    mockDbSelect.mockReturnValue(
      new SelectChain([climateRow({ mode: "dry" }, { mode: "dry", ambient: 70 })]),
    );
    expect((await getClimate()).mode).toBe(HvacMode.Off);
  });

  it("throws when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    await expect(getClimate()).rejects.toThrow("Home Assistant is not configured");
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("throws when the enforcer has not seeded the climate row yet", async () => {
    mockDbSelect.mockReturnValue(new SelectChain([]));
    await expect(getClimate()).rejects.toThrow("no climate state");
  });

  it("uses 0 for a missing setpoint (honest sensor gap, not invented)", async () => {
    mockDbSelect.mockReturnValue(
      new SelectChain([climateRow({ mode: HvacMode.Cool }, { mode: HvacMode.Cool, ambient: 72 })]),
    );
    expect(await getClimate()).toMatchObject({ mode: HvacMode.Cool, target: 0 });
  });

  it("ambient/action always come from real reported HA values (zero-fake-data)", async () => {
    mockDbSelect.mockReturnValue(
      new SelectChain([
        climateRow(
          { mode: HvacMode.Heat, target: 70 },
          { mode: HvacMode.Heat, ambient: 65, action: HaHvacAction.Heating },
        ),
      ]),
    );
    const result = await getClimate();
    expect(result.ambient).toBe(65);
    expect(result.action).toBe(HvacAction.Heating);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// write paths
// ────────────────────────────────────────────────────────────────────────────

function homeEntity(over: Partial<HaEntity["attributes"]> = {}, state: HvacMode = HvacMode.Cool) {
  return entity({
    entity_id: "climate.home",
    state,
    attributes: {
      current_temperature: 72,
      temperature: 70,
      hvac_action: HaHvacAction.Cooling,
      ...over,
    },
  });
}

// Climate mutations are desired-authoritative (CC-unxz.2): they write the
// device_state desired (+ command window) and make ZERO ha.callService — the
// climate enforcer pushes desired→HA. `setSpy` captures the written desired.

describe("setClimateTarget() (writes desired, NO HA call)", () => {
  it("writes a single target onto desired, clearing any stale range", async () => {
    let written: { desiredState?: Record<string, unknown> } = {};
    mockDbSelect.mockReturnValue(
      new SelectChain([
        climateRow({ mode: HvacMode.Cool, targetLow: 60, targetHigh: 80 }, { mode: HvacMode.Cool }),
      ]),
    );
    mockDbUpdate.mockReturnValue(makeUpdateChain((p) => (written = p as typeof written)));

    await setClimateTarget("climate.home", 72);

    expect(mockCallService).not.toHaveBeenCalled();
    expect(written.desiredState).toMatchObject({ mode: HvacMode.Cool, target: 72 });
    expect(written.desiredState?.targetLow).toBeUndefined();
    expect(written.desiredState?.targetHigh).toBeUndefined();
  });
});

describe("setClimateRange() (writes desired, NO HA call)", () => {
  it("writes target_temp_low/high onto desired, clearing any stale single target", async () => {
    let written: { desiredState?: Record<string, unknown> } = {};
    mockDbSelect.mockReturnValue(
      new SelectChain([
        climateRow({ mode: HvacMode.HeatCool, target: 70 }, { mode: HvacMode.HeatCool }),
      ]),
    );
    mockDbUpdate.mockReturnValue(makeUpdateChain((p) => (written = p as typeof written)));

    await setClimateRange("climate.home", 68, 76);

    expect(mockCallService).not.toHaveBeenCalled();
    expect(written.desiredState).toMatchObject({ targetLow: 68, targetHigh: 76 });
    expect(written.desiredState?.target).toBeUndefined();
  });
});

describe("setClimateMode() (writes desired, NO HA call)", () => {
  it("writes the hvac mode onto desired, preserving the setpoints", async () => {
    let written: { desiredState?: Record<string, unknown>; desiredUntilUtc?: Date } = {};
    mockDbSelect.mockReturnValue(
      new SelectChain([climateRow({ mode: HvacMode.Cool, target: 70 }, { mode: HvacMode.Cool })]),
    );
    mockDbUpdate.mockReturnValue(makeUpdateChain((p) => (written = p as typeof written)));

    await setClimateMode("climate.home", HvacMode.HeatCool);

    expect(mockCallService).not.toHaveBeenCalled();
    expect(written.desiredState).toMatchObject({ mode: HvacMode.HeatCool, target: 70 });
    // A command window is stamped so the enforcer pushes regardless of policy.
    expect(written.desiredUntilUtc).toBeInstanceOf(Date);
  });

  it("can turn the system off and returns the DB-derived state", async () => {
    mockDbSelect.mockReturnValue(
      new SelectChain([
        climateRow({ mode: HvacMode.Cool, target: 70 }, { mode: HvacMode.Cool, ambient: 72 }),
      ]),
    );
    mockDbUpdate.mockReturnValue(makeUpdateChain(() => {}));

    const result = await setClimateMode("climate.home", HvacMode.Off);

    expect(mockCallService).not.toHaveBeenCalled();
    expect(result.mode).toBe(HvacMode.Off);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// getClimateZones() — full-capability multi-zone shape
// ────────────────────────────────────────────────────────────────────────────

describe("getClimateZones()", () => {
  it("maps every house entity to a full-capability zone (Tesla excluded), sorted", async () => {
    mockGetEntities.mockResolvedValueOnce([
      entity({
        entity_id: "climate.living_room",
        state: HvacMode.Cool,
        attributes: {
          friendly_name: "Living Room",
          current_temperature: 72,
          temperature: 68,
          hvac_action: HaHvacAction.Cooling,
          hvac_modes: ["off", "cool", "heat", "heat_cool"],
          min_temp: 60,
          max_temp: 90,
          preset_mode: "eco",
          preset_modes: ["eco", "away", "boost"],
          fan_mode: "auto",
          fan_modes: ["auto", "low", "high"],
        },
      }),
      entity({ entity_id: "climate.evee_climate", state: HvacMode.HeatCool }), // Tesla, excluded
      entity({
        entity_id: "climate.bedroom",
        state: HvacMode.HeatCool,
        attributes: {
          friendly_name: "Bedroom",
          current_temperature: 70,
          target_temp_low: 67,
          target_temp_high: 74,
          hvac_action: "idle",
          hvac_modes: ["off", "heat_cool"],
          min_temp: 62,
          max_temp: 86,
        },
      }),
    ]);

    const zones = await getClimateZones();

    expect(zones.map((z) => z.entityId)).toEqual(["climate.bedroom", "climate.living_room"]);
    expect(zones[0]).toEqual({
      entityId: "climate.bedroom",
      name: "Bedroom",
      ambient: 70,
      action: HvacAction.Idle,
      mode: HvacMode.HeatCool,
      hvacModes: ["off", "heat_cool"],
      target: null,
      targetLow: 67,
      targetHigh: 74,
      minTemp: 62,
      maxTemp: 86,
      presetMode: null,
      presetModes: [],
      fanMode: null,
      fanModes: [],
    });
    expect(zones[1]).toMatchObject({
      entityId: "climate.living_room",
      name: "Living Room",
      target: 68,
      presetMode: "eco",
      presetModes: ["eco", "away", "boost"],
      fanMode: "auto",
      fanModes: ["auto", "low", "high"],
    });
  });

  it("returns a single-element list when HA exposes one thermostat (honest, not fake)", async () => {
    mockGetEntities.mockResolvedValueOnce([
      entity({
        entity_id: "climate.home",
        state: HvacMode.Cool,
        attributes: { current_temperature: 71, temperature: 69 },
      }),
    ]);
    const zones = await getClimateZones();
    expect(zones).toHaveLength(1);
    expect(zones[0].entityId).toBe("climate.home");
  });

  it("falls back to entity_id for name and to the visual band for missing min/max", async () => {
    mockGetEntities.mockResolvedValueOnce([
      entity({ entity_id: "climate.home", state: HvacMode.Off, attributes: {} }),
    ]);
    const [zone] = await getClimateZones();
    expect(zone.name).toBe("climate.home");
    expect(zone.minTemp).toBe(67);
    expect(zone.maxTemp).toBe(77);
    expect(zone.presetModes).toEqual([]);
    expect(zone.fanModes).toEqual([]);
  });

  it("throws when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    await expect(getClimateZones()).rejects.toThrow("Home Assistant is not configured");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// per-zone write paths (entity-parameterized, return refreshed zones)
// ────────────────────────────────────────────────────────────────────────────

describe("zone write paths", () => {
  beforeEach(() => {
    mockCallService.mockResolvedValue(undefined);
    mockGetEntities.mockResolvedValue([
      homeEntity({ preset_modes: ["eco"], fan_modes: ["auto"] }, HvacMode.Cool),
    ]);
  });

  it("setZoneMode calls set_hvac_mode and returns zones", async () => {
    const zones = await setZoneMode("climate.bedroom", HvacMode.Heat);
    expect(mockCallService).toHaveBeenCalledWith("climate", "set_hvac_mode", {
      entity_id: "climate.bedroom",
      hvac_mode: HvacMode.Heat,
    });
    expect(zones).toHaveLength(1);
  });

  it("setZoneTarget calls set_temperature with a single temperature", async () => {
    await setZoneTarget("climate.bedroom", 71);
    expect(mockCallService).toHaveBeenCalledWith("climate", "set_temperature", {
      entity_id: "climate.bedroom",
      temperature: 71,
    });
  });

  it("setZoneRange calls set_temperature with target_temp_low/high", async () => {
    await setZoneRange("climate.bedroom", 68, 74);
    expect(mockCallService).toHaveBeenCalledWith("climate", "set_temperature", {
      entity_id: "climate.bedroom",
      target_temp_low: 68,
      target_temp_high: 74,
    });
  });

  it("setClimatePreset calls set_preset_mode and returns zones", async () => {
    const zones = await setClimatePreset("climate.bedroom", "away");
    expect(mockCallService).toHaveBeenCalledWith("climate", "set_preset_mode", {
      entity_id: "climate.bedroom",
      preset_mode: "away",
    });
    expect(zones).toHaveLength(1);
  });

  it("setClimateFan calls set_fan_mode and returns zones", async () => {
    await setClimateFan("climate.bedroom", "high");
    expect(mockCallService).toHaveBeenCalledWith("climate", "set_fan_mode", {
      entity_id: "climate.bedroom",
      fan_mode: "high",
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// isValidRange() — overlap / gap / bounds (server-side guard)
// ────────────────────────────────────────────────────────────────────────────

describe("isValidRange()", () => {
  it("accepts a range exactly the gap apart", () => {
    expect(isValidRange(70, 72)).toBe(true);
  });

  it("rejects a range closer than the gap", () => {
    expect(isValidRange(70, 71)).toBe(false);
  });

  it("rejects equal low and high", () => {
    expect(isValidRange(72, 72)).toBe(false);
  });

  it("rejects low above high", () => {
    expect(isValidRange(76, 70)).toBe(false);
  });

  it("rejects out-of-band values", () => {
    expect(isValidRange(60, 75)).toBe(false);
    expect(isValidRange(70, 85)).toBe(false);
  });

  it("uses the 67-77 band edges (CC-pu4m)", () => {
    expect(isValidRange(67, 77)).toBe(true); // full band accepted
    expect(isValidRange(66, 74)).toBe(false); // 66 below MIN
    expect(isValidRange(70, 78)).toBe(false); // 78 above MAX
  });

  it("rejects non-integers", () => {
    expect(isValidRange(70.5, 73)).toBe(false);
  });
});
