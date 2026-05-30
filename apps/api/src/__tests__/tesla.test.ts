import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the HA module before importing the service.
vi.mock("../integrations/homeassistant", () => {
  const mockHa = {
    isConfigured: vi.fn(() => false),
    getEntity: vi.fn(async () => undefined),
  };
  return { ha: mockHa };
});

import { ha } from "../integrations/homeassistant";
import type { HaEntity } from "../integrations/homeassistant/types";
import { getTeslaData } from "../services/tesla-service";

function makeEntity(
  entity_id: string,
  state: string,
  attributes: Record<string, unknown> = {},
): HaEntity {
  return { entity_id, state, attributes, last_updated: "2024-01-01T00:00:00Z" };
}

/** Build a getEntity mock from an entity_id -> entity map (rejects unknown ids). */
function mockStates(states: Record<string, HaEntity>) {
  vi.mocked(ha.getEntity).mockImplementation(async (id: string) => {
    const e = states[id];
    if (!e) throw new Error(`404 ${id}`);
    return e;
  });
}

// Real "Evee" entity ids (Tesla Fleet integration, evee_ prefix).
const E = "sensor.evee_battery_level";
const fullCar: Record<string, HaEntity> = {
  "sensor.evee_battery_level": makeEntity(E, "61"),
  "sensor.evee_charging": makeEntity("sensor.evee_charging", "charging", {
    options: ["starting", "charging", "stopped", "complete", "disconnected", "no_power"],
  }),
  "sensor.evee_charge_rate": makeEntity("sensor.evee_charge_rate", "25"),
  "sensor.evee_battery_range": makeEntity("sensor.evee_battery_range", "169.37"),
  "sensor.evee_inside_temperature": makeEntity("sensor.evee_inside_temperature", "71.96"),
  "lock.evee_lock": makeEntity("lock.evee_lock", "locked"),
  "device_tracker.evee_location": makeEntity("device_tracker.evee_location", "home", {
    latitude: 34.061183,
    longitude: -118.284533,
    source_type: "gps",
  }),
};

describe("getTeslaData", () => {
  beforeEach(() => {
    vi.mocked(ha.isConfigured).mockReturnValue(false);
    mockStates({}); // default: every entity lookup rejects
  });

  it("throws when HA is not configured", async () => {
    vi.mocked(ha.isConfigured).mockReturnValue(false);
    await expect(getTeslaData()).rejects.toThrow("Home Assistant is not configured");
  });

  it("throws when the battery entity is missing (car asleep/all entities 404)", async () => {
    vi.mocked(ha.isConfigured).mockReturnValue(true);
    mockStates({}); // every getEntity rejects — allSettled skips them all
    await expect(getTeslaData()).rejects.toThrow("unavailable");
  });

  it("throws when the car is asleep (battery state is unavailable)", async () => {
    vi.mocked(ha.isConfigured).mockReturnValue(true);
    mockStates({ "sensor.evee_battery_level": makeEntity(E, "unavailable") });
    await expect(getTeslaData()).rejects.toThrow("unavailable");
  });

  it("maps the real Evee entities to TeslaData", async () => {
    vi.mocked(ha.isConfigured).mockReturnValue(true);
    mockStates(fullCar);
    const data = await getTeslaData();
    expect(data.name).toBe("Model Y");
    expect(data.nick).toBe("Evee");
    expect(data.pct).toBe(61);
    expect(data.charging).toBe(true);
    expect(data.rate).toBe(25);
    expect(data.range).toBe(169); // rounded
    expect(data.climate).toBe(72); // 71.96 rounded
    expect(data.locked).toBe(true);
    expect(data.lat).toBeCloseTo(34.061183);
    expect(data.lon).toBeCloseTo(-118.284533);
    expect(data.place).toBe("Home"); // home -> label
    // Odometer entity is disabled in the integration -> honest "—" absence.
    expect(data.odo).toBe("—");
  });

  it("treats only 'charging'/'starting' as charging", async () => {
    vi.mocked(ha.isConfigured).mockReturnValue(true);
    mockStates({
      ...fullCar,
      "sensor.evee_charging": makeEntity("sensor.evee_charging", "disconnected"),
    });
    expect((await getTeslaData()).charging).toBe(false);
  });

  it("maps unlocked state", async () => {
    vi.mocked(ha.isConfigured).mockReturnValue(true);
    mockStates({ ...fullCar, "lock.evee_lock": makeEntity("lock.evee_lock", "unlocked") });
    expect((await getTeslaData()).locked).toBe(false);
  });

  it("uses the real odometer when present, formatted with commas", async () => {
    vi.mocked(ha.isConfigured).mockReturnValue(true);
    mockStates({
      ...fullCar,
      "sensor.evee_odometer": makeEntity("sensor.evee_odometer", "24113.4"),
    });
    expect((await getTeslaData()).odo).toBe("24,113");
  });

  it("shows '—' (not 0) when the odometer entity reads unknown", async () => {
    // The odometer entity exists but the car is asleep, so it reports
    // "unknown" — must show honest "—" absence, never a bogus "0".
    vi.mocked(ha.isConfigured).mockReturnValue(true);
    mockStates({
      ...fullCar,
      "sensor.evee_odometer": makeEntity("sensor.evee_odometer", "unknown"),
    });
    expect((await getTeslaData()).odo).toBe("—");
  });

  it("titlecases a non-home zone as the place", async () => {
    vi.mocked(ha.isConfigured).mockReturnValue(true);
    mockStates({
      ...fullCar,
      "device_tracker.evee_location": makeEntity(
        "device_tracker.evee_location",
        "sound_nightclub",
        {
          latitude: 34.09,
          longitude: -118.33,
        },
      ),
    });
    const data = await getTeslaData();
    expect(data.place).toBe("Sound Nightclub");
    expect(data.lat).toBeCloseTo(34.09);
  });

  it("defaults to 0 range when range sensor is unavailable but battery is live", async () => {
    vi.mocked(ha.isConfigured).mockReturnValue(true);
    mockStates({
      "sensor.evee_battery_level": makeEntity(E, "55"),
      "sensor.evee_battery_range": makeEntity("sensor.evee_battery_range", "unavailable"),
    });
    const data = await getTeslaData();
    expect(data.pct).toBe(55);
    expect(data.range).toBe(0); // numeric zero — honest sensor gap, not fabricated
    expect(data.charging).toBe(false); // no charging entity -> default false
    expect(data.place).toBe("Home"); // no tracker -> env label
  });
});
