import type { DeviceLightState, DeviceStateValue } from "../db/schema";
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
      return { reported: light, available };
    }
    default:
      return { reported: null, available };
  }
}

export function stateEquals(a: DeviceStateValue | null, b: DeviceStateValue | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.on !== b.on) return false;
  if ((a.brightness ?? null) !== (b.brightness ?? null)) return false;
  return true;
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
