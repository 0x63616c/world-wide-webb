import { beforeEach, describe, expect, it, vi } from "vitest";
import { ha } from "../integrations/homeassistant";
import {
  getClimate,
  resolveClimateEntityId,
  setClimateMode,
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

beforeEach(() => {
  vi.clearAllMocks();
  mockIsConfigured.mockReturnValue(true);
});

// ────────────────────────────────────────────────────────────────────────────
// getClimate()
// ────────────────────────────────────────────────────────────────────────────

describe("getClimate()", () => {
  it("returns correct data from HA climate entity", async () => {
    mockGetEntities.mockResolvedValueOnce([
      {
        entity_id: "climate.living_room",
        state: "cool",
        attributes: {
          current_temperature: 72,
          temperature: 68,
          hvac_mode: "cool",
          hvac_action: "cooling",
        },
        last_updated: "",
      },
    ]);

    const result = await getClimate();
    expect(result).toEqual({
      target: 68,
      ambient: 72,
      mode: "cool",
      action: "Cooling",
    });
  });

  it("returns fallback when HA is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);

    const result = await getClimate();
    expect(result).toEqual({
      target: 70,
      ambient: 72,
      mode: "auto",
      action: "Idle",
    });
    expect(mockGetEntities).not.toHaveBeenCalled();
  });

  it("returns fallback when no climate entities found", async () => {
    mockGetEntities.mockResolvedValueOnce([]);

    const result = await getClimate();
    expect(result).toEqual({
      target: 70,
      ambient: 72,
      mode: "auto",
      action: "Idle",
    });
  });

  it("returns fallback on HA network error", async () => {
    mockGetEntities.mockRejectedValueOnce(new Error("timeout"));

    const result = await getClimate();
    expect(result).toEqual({
      target: 70,
      ambient: 72,
      mode: "auto",
      action: "Idle",
    });
  });

  it("picks first entity alphabetically when multiple exist", async () => {
    mockGetEntities.mockResolvedValueOnce([
      {
        entity_id: "climate.z_bedroom",
        state: "cool",
        attributes: { current_temperature: 68, temperature: 70, hvac_action: "cooling" },
        last_updated: "",
      },
      {
        entity_id: "climate.a_living_room",
        state: "heat",
        attributes: { current_temperature: 72, temperature: 75, hvac_action: "heating" },
        last_updated: "",
      },
    ]);

    const result = await getClimate();
    expect(result.ambient).toBe(72);
    expect(result.target).toBe(75);
    expect(result.mode).toBe("heat");
    expect(result.action).toBe("Heating");
  });

  it("uses entity state as mode fallback when hvac_mode attribute missing", async () => {
    mockGetEntities.mockResolvedValueOnce([
      {
        entity_id: "climate.living_room",
        state: "cool",
        attributes: { current_temperature: 72, temperature: 68, hvac_action: "cooling" },
        last_updated: "",
      },
    ]);

    const result = await getClimate();
    expect(result.mode).toBe("cool");
  });

  it("falls back to default target when temperature attribute missing", async () => {
    mockGetEntities.mockResolvedValueOnce([
      {
        entity_id: "climate.living_room",
        state: "auto",
        attributes: { current_temperature: 72, hvac_action: "idle" },
        last_updated: "",
      },
    ]);

    const result = await getClimate();
    expect(result.target).toBe(70);
  });

  it("falls back to default ambient when current_temperature missing", async () => {
    mockGetEntities.mockResolvedValueOnce([
      {
        entity_id: "climate.living_room",
        state: "auto",
        attributes: { temperature: 70, hvac_action: "idle" },
        last_updated: "",
      },
    ]);

    const result = await getClimate();
    expect(result.ambient).toBe(72);
  });

  it("maps hvac_action idle to Idle action", async () => {
    mockGetEntities.mockResolvedValueOnce([
      {
        entity_id: "climate.living_room",
        state: "auto",
        attributes: { current_temperature: 73, temperature: 72, hvac_action: "idle" },
        last_updated: "",
      },
    ]);

    const result = await getClimate();
    expect(result.action).toBe("Idle");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// setClimateTarget()
// ────────────────────────────────────────────────────────────────────────────

describe("setClimateTarget()", () => {
  it("calls climate.set_temperature with correct params", async () => {
    mockCallService.mockResolvedValueOnce(undefined);
    // Second getEntities call for the optimistic getClimate() inside setClimateTarget.
    mockGetEntities.mockResolvedValueOnce([
      {
        entity_id: "climate.living_room",
        state: "cool",
        attributes: { current_temperature: 72, temperature: 68, hvac_action: "cooling" },
        last_updated: "",
      },
    ]);

    const result = await setClimateTarget("climate.living_room", 72);

    expect(mockCallService).toHaveBeenCalledWith("climate", "set_temperature", {
      entity_id: "climate.living_room",
      temperature: 72,
    });
    expect(result.target).toBe(72);
  });

  it("returns optimistic state with new target", async () => {
    mockCallService.mockResolvedValueOnce(undefined);
    mockGetEntities.mockResolvedValueOnce([
      {
        entity_id: "climate.living_room",
        state: "cool",
        attributes: { current_temperature: 74, temperature: 68, hvac_action: "cooling" },
        last_updated: "",
      },
    ]);

    const result = await setClimateTarget("climate.living_room", 75);
    expect(result.target).toBe(75);
    expect(result.ambient).toBe(74);
    expect(result.mode).toBe("cool");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// setClimateMode()
// ────────────────────────────────────────────────────────────────────────────

describe("setClimateMode()", () => {
  it("calls climate.set_hvac_mode with correct params", async () => {
    mockCallService.mockResolvedValueOnce(undefined);
    mockGetEntities.mockResolvedValueOnce([
      {
        entity_id: "climate.living_room",
        state: "heat",
        attributes: { current_temperature: 70, temperature: 72, hvac_action: "heating" },
        last_updated: "",
      },
    ]);

    await setClimateMode("climate.living_room", "heat");

    expect(mockCallService).toHaveBeenCalledWith("climate", "set_hvac_mode", {
      entity_id: "climate.living_room",
      hvac_mode: "heat",
    });
  });

  it("returns optimistic state with new mode", async () => {
    mockCallService.mockResolvedValueOnce(undefined);
    mockGetEntities.mockResolvedValueOnce([
      {
        entity_id: "climate.living_room",
        state: "cool",
        attributes: { current_temperature: 72, temperature: 70, hvac_action: "cooling" },
        last_updated: "",
      },
    ]);

    const result = await setClimateMode("climate.living_room", "auto");
    expect(result.mode).toBe("auto");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// resolveClimateEntityId()
// ────────────────────────────────────────────────────────────────────────────

describe("resolveClimateEntityId()", () => {
  it("returns first entity id alphabetically", async () => {
    mockGetEntities.mockResolvedValueOnce([
      {
        entity_id: "climate.z_unit",
        state: "cool",
        attributes: {},
        last_updated: "",
      },
      {
        entity_id: "climate.a_unit",
        state: "cool",
        attributes: {},
        last_updated: "",
      },
    ]);

    const id = await resolveClimateEntityId();
    expect(id).toBe("climate.a_unit");
  });

  it("returns undefined when HA not configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    const id = await resolveClimateEntityId();
    expect(id).toBeUndefined();
  });

  it("returns undefined when no entities", async () => {
    mockGetEntities.mockResolvedValueOnce([]);
    const id = await resolveClimateEntityId();
    expect(id).toBeUndefined();
  });

  it("returns undefined on network error", async () => {
    mockGetEntities.mockRejectedValueOnce(new Error("network error"));
    const id = await resolveClimateEntityId();
    expect(id).toBeUndefined();
  });
});
