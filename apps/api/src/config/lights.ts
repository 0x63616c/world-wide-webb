/**
 * Explicit light entity config — mirrors evee's apps/api/src/config/lights.ts.
 *
 * Lamps  = Hue bulbs on the "light." domain, full color/brightness capabilities.
 * Fixtures = overhead + cabinet fixtures on the "switch." domain, on/off only.
 *
 * Classification is DECLARED here, not inferred from entity-id substrings.
 */

export type LightDomain = "light" | "switch";
export type LightKind = "lamp" | "fixture";
export type LightCapability = "onOff" | "brightness" | "colorTemp" | "rgb";

export interface LightEntry {
  id: string;
  entityId: string;
  domain: LightDomain;
  label: string;
  room: string;
  kind: LightKind;
  capabilities: LightCapability[];
}

const HUE_CAPABILITIES: LightCapability[] = ["onOff", "brightness", "colorTemp", "rgb"];
const SWITCH_CAPABILITIES: LightCapability[] = ["onOff"];

export const LIGHTS: readonly LightEntry[] = [
  {
    id: "living-globe",
    entityId: "light.living_room_globe",
    domain: "light",
    label: "Globe",
    room: "Living Room",
    kind: "lamp",
    capabilities: HUE_CAPABILITIES,
  },
  {
    id: "living-corner",
    entityId: "light.living_room_corner_lamp",
    domain: "light",
    label: "Corner Lamp",
    room: "Living Room",
    kind: "lamp",
    capabilities: HUE_CAPABILITIES,
  },
  {
    id: "living-floor",
    entityId: "light.living_room_floor_lamp",
    domain: "light",
    label: "Floor Lamp",
    room: "Living Room",
    kind: "lamp",
    capabilities: HUE_CAPABILITIES,
  },
  {
    id: "kitchen-lamp",
    entityId: "light.kitchen_lamp",
    domain: "light",
    label: "Lamp",
    room: "Kitchen",
    kind: "lamp",
    capabilities: HUE_CAPABILITIES,
  },
  {
    id: "bed-left",
    entityId: "light.bed_lamp_left",
    domain: "light",
    label: "Bed Left",
    room: "Bedroom",
    kind: "lamp",
    capabilities: HUE_CAPABILITIES,
  },
  {
    id: "bed-right",
    entityId: "light.bed_lamp_right",
    domain: "light",
    label: "Bed Right",
    room: "Bedroom",
    kind: "lamp",
    capabilities: HUE_CAPABILITIES,
  },
  {
    id: "overhead",
    entityId: "switch.overhead_lights",
    domain: "switch",
    label: "Overhead",
    room: "Living Room",
    kind: "fixture",
    capabilities: SWITCH_CAPABILITIES,
  },
  {
    id: "under-cabinet",
    entityId: "switch.under_cabinet",
    domain: "switch",
    label: "Cabinet",
    room: "Kitchen",
    kind: "fixture",
    capabilities: SWITCH_CAPABILITIES,
  },
] as const;

/** Entity IDs for all lamp-kind entries (Hue, light domain). */
export const LAMP_ENTITY_IDS: readonly string[] = LIGHTS.filter((l) => l.kind === "lamp").map(
  (l) => l.entityId,
);

/** Entity IDs for all fixture-kind entries (switch domain). */
export const FIXTURE_ENTITY_IDS: readonly string[] = LIGHTS.filter((l) => l.kind === "fixture").map(
  (l) => l.entityId,
);

export function findLight(entityId: string): LightEntry | undefined {
  return LIGHTS.find((l) => l.entityId === entityId);
}
