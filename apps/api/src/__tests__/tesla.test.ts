import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the HA module before importing the service.
vi.mock("../integrations/homeassistant", () => {
  const mockHa = {
    isConfigured: vi.fn(() => false),
    getEntities: vi.fn(async () => []),
  };
  return { ha: mockHa };
});

import { ha } from "../integrations/homeassistant";
import type { HaEntity } from "../integrations/homeassistant/types";
import { getTeslaData, TESLA_PLACEHOLDER } from "../services/tesla-service";

function makeEntity(
  entity_id: string,
  state: string,
  attributes: Record<string, unknown> = {},
): HaEntity {
  return { entity_id, state, attributes, last_updated: "2024-01-01T00:00:00Z" };
}

describe("getTeslaData", () => {
  beforeEach(() => {
    vi.mocked(ha.isConfigured).mockReturnValue(false);
    vi.mocked(ha.getEntities).mockResolvedValue([]);
  });

  it("returns placeholder when HA is not configured", async () => {
    vi.mocked(ha.isConfigured).mockReturnValue(false);
    const data = await getTeslaData();
    expect(data).toEqual(TESLA_PLACEHOLDER);
  });

  it("returns placeholder when HA is configured but no tesla entities found", async () => {
    vi.mocked(ha.isConfigured).mockReturnValue(true);
    vi.mocked(ha.getEntities).mockResolvedValue([makeEntity("sensor.some_other_sensor", "42")]);
    const data = await getTeslaData();
    expect(data).toEqual(TESLA_PLACEHOLDER);
  });

  it("returns placeholder when HA throws a network error", async () => {
    vi.mocked(ha.isConfigured).mockReturnValue(true);
    vi.mocked(ha.getEntities).mockRejectedValue(new Error("Network error"));
    const data = await getTeslaData();
    expect(data).toEqual(TESLA_PLACEHOLDER);
  });

  it("maps real tesla entities to TeslaData", async () => {
    vi.mocked(ha.isConfigured).mockReturnValue(true);
    vi.mocked(ha.getEntities).mockImplementation(async (domain: string) => {
      if (domain === "sensor") {
        return [
          makeEntity("sensor.tesla_model_y_battery", "75", {}),
          makeEntity("sensor.tesla_model_y_range", "241", {}),
          makeEntity("sensor.tesla_model_y_odometer", "18500", {}),
          makeEntity("sensor.tesla_model_y_inside_temp", "68", {}),
          makeEntity("sensor.tesla_model_y_charge_rate", "30", {}),
        ];
      }
      if (domain === "binary_sensor") {
        return [makeEntity("binary_sensor.tesla_model_y_charging", "on", {})];
      }
      if (domain === "lock") {
        return [makeEntity("lock.tesla_model_y_lock", "locked", {})];
      }
      if (domain === "device_tracker") {
        return [
          makeEntity("device_tracker.tesla_model_y", "home", {
            latitude: 34.0537,
            longitude: -118.2428,
            location_name: "Home",
          }),
        ];
      }
      return [];
    });

    const data = await getTeslaData();

    expect(data.name).toBe("Model Y");
    expect(data.nick).toBe("Evee");
    expect(data.pct).toBe(75);
    expect(data.charging).toBe(true);
    expect(data.rate).toBe(30);
    expect(data.range).toBe(241);
    expect(data.odo).toBe("18,500");
    expect(data.climate).toBe(68);
    expect(data.locked).toBe(true);
    expect(data.lat).toBe(34.0537);
    expect(data.lon).toBe(-118.2428);
    expect(data.place).toBe("Home");
  });

  it("maps unlocked state correctly", async () => {
    vi.mocked(ha.isConfigured).mockReturnValue(true);
    vi.mocked(ha.getEntities).mockImplementation(async (domain: string) => {
      if (domain === "lock") {
        return [makeEntity("lock.tesla_model_y_lock", "unlocked", {})];
      }
      if (domain === "sensor") {
        return [makeEntity("sensor.tesla_battery", "60", {})];
      }
      return [];
    });

    const data = await getTeslaData();
    expect(data.locked).toBe(false);
  });

  it("maps not-charging binary sensor correctly", async () => {
    vi.mocked(ha.isConfigured).mockReturnValue(true);
    vi.mocked(ha.getEntities).mockImplementation(async (domain: string) => {
      if (domain === "binary_sensor") {
        return [makeEntity("binary_sensor.tesla_charging", "off", {})];
      }
      if (domain === "sensor") {
        return [makeEntity("sensor.tesla_battery", "90", {})];
      }
      return [];
    });

    const data = await getTeslaData();
    expect(data.charging).toBe(false);
  });

  it("gracefully handles partial entities (only battery present)", async () => {
    vi.mocked(ha.isConfigured).mockReturnValue(true);
    vi.mocked(ha.getEntities).mockImplementation(async (domain: string) => {
      if (domain === "sensor") {
        return [makeEntity("sensor.tesla_battery", "55", {})];
      }
      return [];
    });

    const data = await getTeslaData();
    // Battery should come from HA, rest from placeholder
    expect(data.pct).toBe(55);
    expect(data.charging).toBe(TESLA_PLACEHOLDER.charging);
    expect(data.range).toBe(TESLA_PLACEHOLDER.range);
    expect(data.odo).toBe(TESLA_PLACEHOLDER.odo);
    expect(data.place).toBe(TESLA_PLACEHOLDER.place);
  });

  it("formats odometer with commas", async () => {
    vi.mocked(ha.isConfigured).mockReturnValue(true);
    vi.mocked(ha.getEntities).mockImplementation(async (domain: string) => {
      if (domain === "sensor") {
        return [makeEntity("sensor.tesla_odometer", "24113", {})];
      }
      return [];
    });

    const data = await getTeslaData();
    expect(data.odo).toBe("24,113");
  });
});
