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

/**
 * Merge reported and desired state for a device. Returns the desired value
 * (with pending=true) while an active overlay window is present; otherwise
 * falls back to the reported value from HA. Moved from device-sync-service
 * so it co-locates with the other state-mapping helpers (CC-355t.26).
 */
export function mergeDeviceState(
  device: {
    reportedState?: DeviceStateValue | null;
    desiredState?: DeviceStateValue | null;
    desiredUntilUtc?: Date | null;
    available: boolean;
  },
  now: Date,
): MergedDeviceState {
  if (device.desiredUntilUtc && device.desiredUntilUtc > now && device.desiredState != null) {
    return { state: device.desiredState, pending: true, available: device.available };
  }
  return { state: device.reportedState ?? null, pending: false, available: device.available };
}
