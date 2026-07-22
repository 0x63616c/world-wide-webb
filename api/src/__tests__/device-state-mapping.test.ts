import { describe, expect, it } from "vitest";

import { LIGHTS } from "../config/lights";
import {
  DeviceOwner,
  mapHaToReported,
  ownerOf,
  stateEquals,
} from "../services/device-state-mapping";

describe("mapHaToReported", () => {
  it("returns { reported: null, available: false } when entity is undefined", () => {
    const result = mapHaToReported("light", undefined);
    expect(result).toEqual({ reported: null, available: false });
  });

  it("returns { on: true } for light entity with state='on'", () => {
    const result = mapHaToReported("light", {
      entity_id: "light.lamp",
      state: "on",
      attributes: {},
      last_updated: new Date().toISOString(),
    });
    expect(result.available).toBe(true);
    expect(result.reported).toEqual({ on: true });
  });

  it("returns { on: false } for light entity with state='off'", () => {
    const result = mapHaToReported("light", {
      entity_id: "light.lamp",
      state: "off",
      attributes: {},
      last_updated: new Date().toISOString(),
    });
    expect(result.available).toBe(true);
    expect(result.reported).toEqual({ on: false });
  });

  it("includes brightness when present on a light entity", () => {
    const result = mapHaToReported("light", {
      entity_id: "light.lamp",
      state: "on",
      attributes: { brightness: 128 },
      last_updated: new Date().toISOString(),
    });
    expect(result.reported).toEqual({ on: true, brightness: 128 });
  });

  it("includes rgb color when rgb_color is present", () => {
    const result = mapHaToReported("light", {
      entity_id: "light.lamp",
      state: "on",
      attributes: { brightness: 200, rgb_color: [255, 0, 0] },
      last_updated: new Date().toISOString(),
    });
    expect(result.reported).toEqual({ on: true, brightness: 200, color: { rgb: [255, 0, 0] } });
  });

  it("includes kelvin color when color_temp_kelvin is present and no rgb", () => {
    const result = mapHaToReported("light", {
      entity_id: "light.lamp",
      state: "on",
      attributes: { color_temp_kelvin: 4000 },
      last_updated: new Date().toISOString(),
    });
    expect(result.reported).toEqual({ on: true, color: { kelvin: 4000 } });
  });

  it("prefers rgb over kelvin when both are present", () => {
    const result = mapHaToReported("light", {
      entity_id: "light.lamp",
      state: "on",
      attributes: { rgb_color: [10, 20, 30], color_temp_kelvin: 4000 },
      last_updated: new Date().toISOString(),
    });
    expect(result.reported).toEqual({ on: true, color: { rgb: [10, 20, 30] } });
  });

  it("omits color when rgb_color is malformed", () => {
    const result = mapHaToReported("light", {
      entity_id: "light.lamp",
      state: "on",
      attributes: { rgb_color: [255, 0] },
      last_updated: new Date().toISOString(),
    });
    expect(result.reported).toEqual({ on: true });
  });

  it("returns { reported: null, available: false } for unavailable entity", () => {
    const result = mapHaToReported("light", {
      entity_id: "light.lamp",
      state: "unavailable",
      attributes: {},
      last_updated: new Date().toISOString(),
    });
    expect(result).toEqual({ reported: null, available: false });
  });

  it("returns { reported: null, available: false } for unknown entity", () => {
    const result = mapHaToReported("light", {
      entity_id: "light.lamp",
      state: "unknown",
      attributes: {},
      last_updated: new Date().toISOString(),
    });
    expect(result).toEqual({ reported: null, available: false });
  });

  it("returns available but null reported for an unknown kind", () => {
    const result = mapHaToReported("sensor", {
      entity_id: "sensor.temp",
      state: "72",
      attributes: {},
      last_updated: new Date().toISOString(),
    });
    expect(result.available).toBe(true);
    expect(result.reported).toBeNull();
  });

  it("maps a climate entity to reported climate state (ambient/action reported-only) , www-unxz.2", () => {
    const result = mapHaToReported("climate", {
      entity_id: "climate.home",
      state: "cool",
      attributes: {
        hvac_mode: "cool",
        temperature: 70,
        fan_mode: "on",
        current_temperature: 73,
        hvac_action: "cooling",
      },
      last_updated: new Date().toISOString(),
    });
    expect(result.available).toBe(true);
    expect(result.reported).toMatchObject({
      mode: "cool",
      target: 70,
      fanMode: "on",
      ambient: 73,
      action: "cooling",
    });
  });
});

describe("stateEquals", () => {
  it("returns true for two identical { on: true, brightness: 128 } values", () => {
    expect(stateEquals({ on: true, brightness: 128 }, { on: true, brightness: 128 })).toBe(true);
  });

  it("returns false when on differs", () => {
    expect(stateEquals({ on: true }, { on: false })).toBe(false);
  });

  it("returns false when brightness differs", () => {
    expect(stateEquals({ on: true, brightness: 100 }, { on: true, brightness: 200 })).toBe(false);
  });

  it("returns true when both are null", () => {
    expect(stateEquals(null, null)).toBe(true);
  });

  it("returns false when one is null", () => {
    expect(stateEquals({ on: true }, null)).toBe(false);
    expect(stateEquals(null, { on: false })).toBe(false);
  });

  it("returns true when brightness is absent on both", () => {
    expect(stateEquals({ on: true }, { on: true })).toBe(true);
  });

  it("returns false when rgb color differs", () => {
    expect(
      stateEquals(
        { on: true, color: { rgb: [255, 0, 0] } },
        { on: true, color: { rgb: [0, 0, 255] } },
      ),
    ).toBe(false);
  });

  it("returns true when rgb color matches", () => {
    expect(
      stateEquals({ on: true, color: { rgb: [1, 2, 3] } }, { on: true, color: { rgb: [1, 2, 3] } }),
    ).toBe(true);
  });

  it("returns false when kelvin differs", () => {
    expect(
      stateEquals({ on: true, color: { kelvin: 4000 } }, { on: true, color: { kelvin: 2700 } }),
    ).toBe(false);
  });

  it("returns false when one has color and the other does not", () => {
    expect(stateEquals({ on: true, color: { rgb: [1, 2, 3] } }, { on: true })).toBe(false);
  });
});

// ─── ownerOf: row ownership as data (www row-ownership) ───────────────────────

// A configured light row (lamps carry kind "light", switch fixtures "switch").
const lampRow = { id: "living-globe", entityId: "light.living_room_globe", kind: "light" };
const fixtureRow = { id: "overhead", entityId: "switch.overhead_lights", kind: "switch" };
// The thermostat singleton the climate enforcer owns.
const climateRow = { id: "climate-thermostat", entityId: "climate.house", kind: "climate" };
// A speaker row: entityId is a LAN IP that never appears in the HA snapshot.
const speakerRow = { id: "spk_192-168-0-193", entityId: "192.168.0.193", kind: "speaker" };
// Plain HA devices device-sync owns.
const fanRow = { id: "fan-1", entityId: "fan.bedroom", kind: "fan" };
const sensorRow = { id: "misc-1", entityId: "sensor.hallway_motion", kind: "sensor" };

describe("ownerOf", () => {
  it("assigns a configured lamp to the light enforcer", () => {
    expect(ownerOf(lampRow)).toBe(DeviceOwner.LightEnforcer);
  });

  it("assigns a configured switch fixture to the light enforcer", () => {
    expect(ownerOf(fixtureRow)).toBe(DeviceOwner.LightEnforcer);
  });

  it("assigns the thermostat singleton to the climate enforcer", () => {
    expect(ownerOf(climateRow)).toBe(DeviceOwner.ClimateEnforcer);
  });

  it("assigns a speaker row to the sonos volume enforcer", () => {
    expect(ownerOf(speakerRow)).toBe(DeviceOwner.SonosVolumeEnforcer);
  });

  it("assigns a fan to device-sync", () => {
    expect(ownerOf(fanRow)).toBe(DeviceOwner.DeviceSync);
  });

  it("assigns a plain HA device to device-sync", () => {
    expect(ownerOf(sensorRow)).toBe(DeviceOwner.DeviceSync);
  });
});

// The cross-service fight-loop invariant: exactly one loop reconciles any given
// row shape. Each enforcer's claim below is transcribed INDEPENDENTLY from that
// loop's own DB row-selection (not via ownerOf), so this genuinely cross-checks
// that ownerOf and the four cycles partition the row space the same way. If two
// claims overlapped, that row would be double-driven (the fight loop); if a shape
// were claimed by none, no loop would reconcile it.
describe("device_state ownership invariant", () => {
  // light-enforcer selects `inArray(entityId, MANAGED_ENTITY_IDS)` where
  // MANAGED_ENTITY_IDS = LIGHTS.map(entityId) (light-enforcer-service.ts).
  const lightEnforcerClaims = (row: { entityId: string }) =>
    LIGHTS.some((l) => l.entityId === row.entityId);
  // climate-enforcer selects the singleton thermostat row; the only climate-kind
  // row that ever exists (climate-enforcer-service.ts, kind "climate").
  const climateEnforcerClaims = (row: { kind: string }) => row.kind === "climate";
  // sonos-volume-enforcer selects `eq(kind, Speaker)` (sonos-volume-enforcer-service.ts).
  const sonosEnforcerClaims = (row: { kind: string }) => row.kind === "speaker";

  const enforcerClaims: Array<[DeviceOwner, (row: { entityId: string; kind: string }) => boolean]> =
    [
      [DeviceOwner.LightEnforcer, lightEnforcerClaims],
      [DeviceOwner.ClimateEnforcer, climateEnforcerClaims],
      [DeviceOwner.SonosVolumeEnforcer, sonosEnforcerClaims],
    ];

  const representativeRows = [lampRow, fixtureRow, climateRow, speakerRow, fanRow, sensorRow];

  for (const row of representativeRows) {
    it(`row ${row.id} has exactly one owner, and ownerOf agrees`, () => {
      const claimingEnforcers = enforcerClaims.filter(([, claims]) => claims(row));

      // No row shape is claimed by two loops (would be a double-drive fight loop).
      expect(claimingEnforcers.length).toBeLessThanOrEqual(1);

      // Every row shape has exactly one owner: the claiming enforcer, else
      // device-sync catches everything no enforcer claims.
      const expectedOwner = claimingEnforcers[0]?.[0] ?? DeviceOwner.DeviceSync;
      expect(ownerOf(row)).toBe(expectedOwner);
    });
  }
});
