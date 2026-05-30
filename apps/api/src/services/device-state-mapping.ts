import type { DeviceLightState, DeviceStateValue } from "../db/schema";
import type { HaEntity } from "../integrations/homeassistant/types";

export interface MappedHaState {
  reported: DeviceStateValue | null;
  available: boolean;
}

export function mapHaToReported(kind: string, entity: HaEntity | undefined): MappedHaState {
  if (!entity) return { reported: null, available: false };
  const available = entity.state !== "unavailable" && entity.state !== "unknown";
  if (!available) return { reported: null, available: false };

  switch (kind) {
    case "light":
    case "switch": {
      const light: DeviceLightState = { on: entity.state === "on" };
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
