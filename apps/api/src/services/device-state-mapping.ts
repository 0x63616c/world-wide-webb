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
