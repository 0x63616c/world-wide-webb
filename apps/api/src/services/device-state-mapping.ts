import type { DeviceLightState, DeviceStateValue, LightColor } from "../db/schema";
import type { HaEntity } from "../integrations/homeassistant/types";

export const DeviceKind = {
  Light: "light",
  Switch: "switch",
} as const;
export type DeviceKind = (typeof DeviceKind)[keyof typeof DeviceKind];

export const HaState = {
  On: "on",
  Unavailable: "unavailable",
  Unknown: "unknown",
} as const;

export interface MappedHaState {
  reported: DeviceStateValue | null;
  available: boolean;
}

export function mapHaToReported(kind: string, entity: HaEntity | undefined): MappedHaState {
  if (!entity) return { reported: null, available: false };
  const available = entity.state !== HaState.Unavailable && entity.state !== HaState.Unknown;
  if (!available) return { reported: null, available: false };

  switch (kind) {
    case DeviceKind.Light:
    case DeviceKind.Switch: {
      const light: DeviceLightState = { on: entity.state === HaState.On };
      const brightness = entity.attributes.brightness;
      if (typeof brightness === "number") light.brightness = brightness;
      const color = mapHaColor(entity);
      if (color) light.color = color;
      return { reported: light, available };
    }
    default:
      return { reported: null, available };
  }
}

/**
 * Extract a light's colour from HA attributes: an `rgb_color` triple or a white
 * `color_temp_kelvin`. Returns undefined when neither is present (e.g. a plain
 * on/off switch, or a light HA hasn't reported colour for yet) so we never
 * fabricate a colour. Whichever colour mode HA reports is the one we record.
 */
function mapHaColor(entity: HaEntity): LightColor | undefined {
  const rgb = entity.attributes.rgb_color;
  if (Array.isArray(rgb) && rgb.length === 3 && rgb.every((c) => typeof c === "number")) {
    return { rgb: [rgb[0], rgb[1], rgb[2]] as [number, number, number] };
  }
  const kelvin = entity.attributes.color_temp_kelvin;
  if (typeof kelvin === "number") return { kelvin };
  return undefined;
}

export function stateEquals(a: DeviceStateValue | null, b: DeviceStateValue | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.on !== b.on) return false;
  if ((a.brightness ?? null) !== (b.brightness ?? null)) return false;
  return colorEquals(a.color, b.color);
}

/**
 * Exact colour equality (used for reported-vs-reported change detection). The
 * enforcer applies its own tolerances for desired-vs-reported drift; here we
 * want a precise compare so a genuine colour change registers.
 */
function colorEquals(a: LightColor | undefined, b: LightColor | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if ((a.kelvin ?? null) !== (b.kelvin ?? null)) return false;
  const ar = a.rgb;
  const br = b.rgb;
  if (!ar && !br) return true;
  if (!ar || !br) return false;
  return ar[0] === br[0] && ar[1] === br[1] && ar[2] === br[2];
}

export interface MergedDeviceState {
  state: DeviceStateValue | null;
  pending: boolean;
  available: boolean;
}

// Tolerances for desired-vs-reported convergence (pending detection). HA does not
// round-trip colour/brightness exactly, so a per-channel/absolute slack stops a
// freshly-actuated light from reading as perpetually "pending". Mirrors the
// enforcer's drift tolerances (kept local to avoid a circular import — the
// enforcer imports from this module).
const RGB_CHANNEL_TOLERANCE = 12;
const KELVIN_TOLERANCE = 250;
const BRIGHTNESS_TOLERANCE = 3;

/** True when two colours are within HA round-trip tolerance (or both absent). */
function colorConverged(a: LightColor | undefined, b: LightColor | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const aKelvin = a.kelvin != null;
  const bKelvin = b.kelvin != null;
  if (aKelvin !== bKelvin) return false;
  if (aKelvin && bKelvin) return Math.abs((a.kelvin ?? 0) - (b.kelvin ?? 0)) <= KELVIN_TOLERANCE;
  const ar = a.rgb;
  const br = b.rgb;
  if (!ar || !br) return !ar && !br;
  return ar.every((c, i) => Math.abs(c - br[i]) <= RGB_CHANNEL_TOLERANCE);
}

/**
 * Tolerant convergence of the desired fields that are SPECIFIED vs reported.
 * Desired is a PARTIAL overlay: only the fields it actually carries are intent,
 * so a desired that omits brightness/colour (e.g. a bare on/off toggle) must NOT
 * count as diverged just because reported has a colour. `on` is always specified;
 * brightness/colour are compared only when desired specifies them.
 */
function converged(desired: DeviceStateValue, reported: DeviceStateValue): boolean {
  if (desired.on !== reported.on) return false;
  if (!desired.on) return true;
  if (
    desired.brightness != null &&
    reported.brightness != null &&
    Math.abs(desired.brightness - reported.brightness) > BRIGHTNESS_TOLERANCE
  ) {
    return false;
  }
  // Only a SPECIFIED desired colour can diverge; an absent desired colour means
  // "no colour intent" → reflect reported, never perpetually pending.
  if (desired.color != null && !colorConverged(desired.color, reported.color)) {
    return false;
  }
  return true;
}

/**
 * Merge reported and desired into the effective state. Desired is the source of
 * truth, but it is a PARTIAL OVERLAY: each field desired specifies wins (the
 * enforcer drives HA to it); fields desired omits fall back to reported. So a
 * bare on/off toggle (`{on}`) still shows the real brightness/colour from HA
 * instead of zeros, and `activeScene` derives from the effective colour. This
 * matches the enforcer, which only actuates the fields desired specifies
 * (CC-7d5b.2.4). `pending` is true only while a SPECIFIED desired field has not
 * yet converged with reported. The old 5s desiredUntilUtc window is retired.
 */
export function mergeDeviceState(
  device: {
    reportedState?: DeviceStateValue | null;
    desiredState?: DeviceStateValue | null;
    available: boolean;
  },
  _now?: Date,
): MergedDeviceState {
  const desired = device.desiredState ?? null;
  const reported = device.reportedState ?? null;
  if (desired != null) {
    // Per-field overlay: reported as base, desired's specified fields override.
    const state = reported != null ? { ...reported, ...desired } : desired;
    const pending = reported == null ? true : !converged(desired, reported);
    return { state, pending, available: device.available };
  }
  return { state: reported, pending: false, available: device.available };
}
