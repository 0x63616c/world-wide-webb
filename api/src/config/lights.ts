/**
 * Explicit light entity config , mirrors evee's api/src/config/lights.ts.
 *
 * Lamps  = Hue bulbs on the "light." domain, full color/brightness capabilities.
 * Fixtures = overhead + cabinet fixtures on the "switch." domain, on/off only.
 *
 * Classification is DECLARED here, not inferred from entity-id substrings.
 */

const LightDomain = {
  Light: "light",
  Switch: "switch",
} as const;
type LightDomain = (typeof LightDomain)[keyof typeof LightDomain];

// The house has exactly three rooms. Declared as a closed union so a typo or a
// speculative fourth room fails to compile rather than silently creating an
// orphan UI group. Sonos "rooms" are a DIFFERENT namespace (physical speaker
// names, which include Desk and Bathroom) , do not conflate the two.
export const Room = {
  LivingRoom: "Living Room",
  Kitchen: "Kitchen",
  Bedroom: "Bedroom",
} as const;
export type Room = (typeof Room)[keyof typeof Room];

export const LightKind = {
  Lamp: "lamp",
  Fixture: "fixture",
} as const;
export type LightKind = (typeof LightKind)[keyof typeof LightKind];

const LightCapability = {
  OnOff: "onOff",
  Brightness: "brightness",
  ColorTemp: "colorTemp",
  Rgb: "rgb",
} as const;
type LightCapability = (typeof LightCapability)[keyof typeof LightCapability];

// Per-device reconcile policy (www-7d5b.2.1). The enforcer treats desired state as
// truth; `control` decides what happens on UNSOLICITED external drift (the panel
// always actuates immediately for both policies , this only governs drift):
//   enforce → push desired back onto HA (we win): the Hue lamps, so scenes/party persist.
//   adopt   → set desired = reported (absorb the change as new intent, never fight):
//             the switch.* fixtures with real wall switches Calum keeps using.
// Default is adopt so a NEW device never fights its own switch unless opted in.
export const LightControl = {
  Enforce: "enforce",
  Adopt: "adopt",
} as const;
export type LightControl = (typeof LightControl)[keyof typeof LightControl];

export interface LightEntry {
  id: string;
  entityId: string;
  domain: LightDomain;
  label: string;
  room: Room;
  kind: LightKind;
  capabilities: LightCapability[];
  // Optional: omitted means adopt (resolved via lightControl()). Only the Hue
  // lamps set this to enforce.
  control?: LightControl;
}

/** Resolve a light's control policy, defaulting unspecified entries to adopt. */
export function lightControl(entry: Pick<LightEntry, "control">): LightControl {
  return entry.control ?? LightControl.Adopt;
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
    // Hue: we win on drift so scenes/party persist (www-7d5b.2.1).
    control: "enforce",
  },
  {
    id: "living-corner",
    entityId: "light.living_room_corner_lamp",
    domain: "light",
    label: "Corner Lamp",
    room: "Living Room",
    kind: "lamp",
    capabilities: HUE_CAPABILITIES,
    // Hue: we win on drift so scenes/party persist (www-7d5b.2.1).
    control: "enforce",
  },
  {
    id: "living-floor",
    entityId: "light.living_room_floor_lamp",
    domain: "light",
    label: "Floor Lamp",
    room: "Living Room",
    kind: "lamp",
    capabilities: HUE_CAPABILITIES,
    // Hue: we win on drift so scenes/party persist (www-7d5b.2.1).
    control: "enforce",
  },
  {
    id: "kitchen-lamp",
    entityId: "light.kitchen_lamp",
    domain: "light",
    label: "Lamp",
    room: "Kitchen",
    kind: "lamp",
    capabilities: HUE_CAPABILITIES,
    // Hue: we win on drift so scenes/party persist (www-7d5b.2.1).
    control: "enforce",
  },
  {
    id: "desk",
    entityId: "light.desk",
    domain: "light",
    label: "Desk",
    room: "Living Room",
    kind: "lamp",
    capabilities: HUE_CAPABILITIES,
    // Hue: we win on drift so scenes/party persist (www-7d5b.2.1).
    control: "enforce",
  },
  {
    id: "bed-left",
    entityId: "light.bed_lamp_left",
    domain: "light",
    label: "Bed Left",
    room: "Bedroom",
    kind: "lamp",
    capabilities: HUE_CAPABILITIES,
    // Hue: we win on drift so scenes/party persist (www-7d5b.2.1).
    control: "enforce",
  },
  {
    id: "bed-right",
    entityId: "light.bed_lamp_right",
    domain: "light",
    label: "Bed Right",
    room: "Bedroom",
    kind: "lamp",
    capabilities: HUE_CAPABILITIES,
    // Hue: we win on drift so scenes/party persist (www-7d5b.2.1).
    control: "enforce",
  },
  {
    id: "mirror",
    entityId: "light.mirror",
    domain: "light",
    label: "Mirror",
    room: "Bedroom",
    kind: "lamp",
    capabilities: HUE_CAPABILITIES,
    // Hue: we win on drift so scenes/party persist (www-7d5b.2.1).
    control: "enforce",
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
export const LAMP_ENTITY_IDS: readonly string[] = LIGHTS.filter(
  (l) => l.kind === LightKind.Lamp,
).map((l) => l.entityId);

/** Entity IDs for all fixture-kind entries (switch domain). */
export const FIXTURE_ENTITY_IDS: readonly string[] = LIGHTS.filter(
  (l) => l.kind === LightKind.Fixture,
).map((l) => l.entityId);

export function findLight(entityId: string): LightEntry | undefined {
  return LIGHTS.find((l) => l.entityId === entityId);
}
