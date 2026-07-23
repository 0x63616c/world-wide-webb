import { describe, expect, it } from "vitest";

import { LIGHTS } from "../config/lights";
import { DeviceOwner, ownerOf } from "../services/device-ownership";

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
