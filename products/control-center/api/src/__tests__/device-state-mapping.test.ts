import { describe, expect, it } from "vitest";

import {
  mapHaToReported,
  mergeDeviceState,
  sanitizeClimateDesired,
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

// www-dnpj: desired must only ever carry the commandable climate fields. A desired
// that includes the reported-only ambient/action shadows the live reported values
// in the merge overlay and freezes the panel's room temp at seed time.
describe("sanitizeClimateDesired", () => {
  it("strips reported-only ambient/action, keeping the commandable fields", () => {
    expect(
      sanitizeClimateDesired({
        mode: "cool",
        target: 72,
        fanMode: "on",
        ambient: 71,
        action: "cooling",
      }),
    ).toEqual({ mode: "cool", target: 72, fanMode: "on" });
  });

  it("preserves a heat_cool range and omits absent optionals", () => {
    expect(
      sanitizeClimateDesired({ mode: "heat_cool", targetLow: 68, targetHigh: 76, ambient: 70 }),
    ).toEqual({ mode: "heat_cool", targetLow: 68, targetHigh: 76 });
  });
});

// ─── mergeDeviceState (light) ────────────────────────────────────────────────
// Desired-authoritative (www-7d5b.2.4): desired is the effective state when
// present; pending means HA has not yet converged with it.
describe("mergeDeviceState (light)", () => {
  it("returns desiredState with pending=true while reported has not converged", () => {
    const result = mergeDeviceState({
      reportedState: { on: false },
      desiredState: { on: true },
      available: true,
    });
    expect(result).toEqual({ state: { on: true }, pending: true, available: true });
  });

  it("returns desiredState with pending=false once reported converges (within tolerance)", () => {
    const result = mergeDeviceState({
      reportedState: { on: true, brightness: 200, color: { rgb: [0, 2, 254] } },
      desiredState: { on: true, brightness: 200, color: { rgb: [0, 0, 255] } },
      available: true,
    });
    expect(result.state).toEqual({ on: true, brightness: 200, color: { rgb: [0, 0, 255] } });
    expect(result.pending).toBe(false);
  });

  it("returns reportedState with pending=false when desired is null", () => {
    const result = mergeDeviceState({
      reportedState: { on: false },
      desiredState: null,
      available: true,
    });
    expect(result).toEqual({ state: { on: false }, pending: false, available: true });
  });

  it("overlays a bare {on} desired onto reported brightness/colour (no zeroing, not pending)", () => {
    // www-7d5b.2.4 regression: a bare on/off toggle writes only { on } and must
    // NOT zero out brightness/colour, nor sit perpetually pending.
    const result = mergeDeviceState({
      reportedState: { on: true, brightness: 200, color: { rgb: [255, 0, 0] } },
      desiredState: { on: true },
      available: true,
    });
    expect(result.state).toEqual({ on: true, brightness: 200, color: { rgb: [255, 0, 0] } });
    expect(result.pending).toBe(false);
  });

  it("a specified desired field overrides reported and drives pending", () => {
    const result = mergeDeviceState({
      reportedState: { on: true, brightness: 200, color: { rgb: [255, 0, 0] } },
      desiredState: { on: true, color: { rgb: [0, 0, 255] } },
      available: true,
    });
    expect(result.state).toEqual({ on: true, brightness: 200, color: { rgb: [0, 0, 255] } });
    expect(result.pending).toBe(true);
  });
});

describe("mergeDeviceState (climate)", () => {
  it("surfaces LIVE reported ambient/action even when a stale desired carries them (www-dnpj)", () => {
    const merged = mergeDeviceState({
      desiredState: { mode: "cool", target: 72, ambient: 71, action: "idle" },
      reportedState: { mode: "cool", target: 72, ambient: 73, action: "cooling" },
      available: true,
    });
    expect(merged.state).toMatchObject({
      mode: "cool",
      target: 72,
      ambient: 73,
      action: "cooling",
    });
  });
});
