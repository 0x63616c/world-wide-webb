import { beforeEach, describe, expect, it, vi } from "vitest";
import { ha } from "../integrations/homeassistant";
import type { HaEntity } from "../integrations/homeassistant/types";
import {
  getClimate,
  isValidRange,
  resolveClimateEntityId,
  selectClimateEntity,
  setClimateMode,
  setClimateRange,
  setClimateTarget,
} from "../services/climate-service";

vi.mock("../integrations/homeassistant", () => ({
  ha: {
    isConfigured: vi.fn(),
    getEntities: vi.fn(),
    callService: vi.fn(),
  },
}));

const mockIsConfigured = vi.mocked(ha.isConfigured);
const mockGetEntities = vi.mocked(ha.getEntities);
const mockCallService = vi.mocked(ha.callService);

function entity(partial: Partial<HaEntity> & { entity_id: string }): HaEntity {
  return { state: "off", attributes: {}, last_updated: "", ...partial };
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

describe("getClimate()", () => {
  it("parses a cool entity to a single-target state", async () => {
    mockGetEntities.mockResolvedValueOnce([
      entity({
        entity_id: "climate.home",
        state: "cool",
        attributes: { current_temperature: 72, temperature: 68, hvac_action: "cooling" },
      }),
    ]);
    expect(await getClimate()).toEqual({
      mode: "cool",
      target: 68,
      ambient: 72,
      action: "Cooling",
    });
  });

  it("parses a heat_cool entity to a low/high range state", async () => {
    mockGetEntities.mockResolvedValueOnce([
      entity({
        entity_id: "climate.home",
        state: "heat_cool",
        attributes: {
          current_temperature: 73,
          target_temp_low: 68,
          target_temp_high: 76,
          hvac_action: "idle",
        },
      }),
    ]);
    expect(await getClimate()).toEqual({
      mode: "heat_cool",
      targetLow: 68,
      targetHigh: 76,
      ambient: 73,
      action: "Idle",
    });
  });

  it("parses an off entity to a no-setpoint state", async () => {
    mockGetEntities.mockResolvedValueOnce([
      entity({ entity_id: "climate.home", state: "off", attributes: { current_temperature: 71 } }),
    ]);
    expect(await getClimate()).toEqual({ mode: "off", ambient: 71, action: "Idle" });
  });

  it("ignores the Tesla and reads the house thermostat", async () => {
    mockGetEntities.mockResolvedValueOnce([
      entity({
        entity_id: "climate.evee_climate",
        state: "heat_cool",
        attributes: { current_temperature: 60, target_temp_low: 59, target_temp_high: 82 },
      }),
      entity({
        entity_id: "climate.home",
        state: "cool",
        attributes: { current_temperature: 72, temperature: 70, hvac_action: "cooling" },
      }),
    ]);
    const result = await getClimate();
    expect(result.mode).toBe("cool");
    expect(result.ambient).toBe(72);
  });

  it("treats an unknown hvac mode as off", async () => {
    mockGetEntities.mockResolvedValueOnce([
      entity({ entity_id: "climate.home", state: "dry", attributes: { current_temperature: 70 } }),
    ]);
    expect((await getClimate()).mode).toBe("off");
  });

  it("throws when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    await expect(getClimate()).rejects.toThrow("Home Assistant is not configured");
    expect(mockGetEntities).not.toHaveBeenCalled();
  });

  it("throws when no climate entities found", async () => {
    mockGetEntities.mockResolvedValueOnce([]);
    await expect(getClimate()).rejects.toThrow("no climate entities");
  });

  it("uses 0 for a missing setpoint (honest sensor gap, not invented)", async () => {
    mockGetEntities.mockResolvedValueOnce([
      entity({ entity_id: "climate.home", state: "cool", attributes: { current_temperature: 72 } }),
    ]);
    const result = await getClimate();
    expect(result).toMatchObject({ mode: "cool", target: 0 });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// write paths
// ────────────────────────────────────────────────────────────────────────────

function homeEntity(over: Partial<HaEntity["attributes"]> = {}, state = "cool") {
  return entity({
    entity_id: "climate.home",
    state,
    attributes: { current_temperature: 72, temperature: 70, hvac_action: "cooling", ...over },
  });
}

describe("setClimateTarget()", () => {
  it("calls climate.set_temperature with a single temperature", async () => {
    mockCallService.mockResolvedValueOnce(undefined);
    mockGetEntities.mockResolvedValueOnce([homeEntity({ temperature: 72 })]);

    await setClimateTarget("climate.home", 72);

    expect(mockCallService).toHaveBeenCalledWith("climate", "set_temperature", {
      entity_id: "climate.home",
      temperature: 72,
    });
  });
});

describe("setClimateRange()", () => {
  it("calls climate.set_temperature with target_temp_low/high", async () => {
    mockCallService.mockResolvedValueOnce(undefined);
    mockGetEntities.mockResolvedValueOnce([
      homeEntity({ target_temp_low: 68, target_temp_high: 76 }, "heat_cool"),
    ]);

    await setClimateRange("climate.home", 68, 76);

    expect(mockCallService).toHaveBeenCalledWith("climate", "set_temperature", {
      entity_id: "climate.home",
      target_temp_low: 68,
      target_temp_high: 76,
    });
  });
});

describe("setClimateMode()", () => {
  it("calls climate.set_hvac_mode with the real hvac string", async () => {
    mockCallService.mockResolvedValueOnce(undefined);
    mockGetEntities.mockResolvedValueOnce([
      homeEntity({ target_temp_low: 68, target_temp_high: 76 }, "heat_cool"),
    ]);

    await setClimateMode("climate.home", "heat_cool");

    expect(mockCallService).toHaveBeenCalledWith("climate", "set_hvac_mode", {
      entity_id: "climate.home",
      hvac_mode: "heat_cool",
    });
  });

  it("can turn the system off", async () => {
    mockCallService.mockResolvedValueOnce(undefined);
    mockGetEntities.mockResolvedValueOnce([homeEntity({}, "off")]);

    const result = await setClimateMode("climate.home", "off");

    expect(mockCallService).toHaveBeenCalledWith("climate", "set_hvac_mode", {
      entity_id: "climate.home",
      hvac_mode: "off",
    });
    expect(result.mode).toBe("off");
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

  it("rejects non-integers", () => {
    expect(isValidRange(70.5, 73)).toBe(false);
  });
});
