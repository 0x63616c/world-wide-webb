import {
  climateSetpointsObservable,
  climateStateConverged,
  type DeviceClimateState,
  DeviceKind,
  type DeviceLightState,
  type DeviceSpeakerState,
  type DeviceStateValue,
  isClimateState,
  isLightState,
  type LightColor,
  mergeDeviceState,
  sanitizeClimateDesired,
} from "@www/core";
import { findLight } from "../config/lights";
import type { HaEntity } from "../integrations/homeassistant/types";

export { DeviceKind } from "@www/core";

// ─── Moved to @www/core (Task 4): mergeDeviceState + its pure dependency
// closure now live in packages/core/src/device-state/merge.ts. Re-exported
// here so no call site in api/ has to change import paths.
export {
  climateSetpointsObservable,
  climateStateConverged,
  isClimateState,
  isLightState,
  mergeDeviceState,
  sanitizeClimateDesired,
};

/**
 * The four reconcile loops that write the `device_state` table. Exactly one of
 * them OWNS any given row (see `ownerOf`).
 */
export const DeviceOwner = {
  LightEnforcer: "light-enforcer",
  ClimateEnforcer: "climate-enforcer",
  SonosVolumeEnforcer: "sonos-volume-enforcer",
  DeviceSync: "device-sync",
} as const;
export type DeviceOwner = (typeof DeviceOwner)[keyof typeof DeviceOwner];

/**
 * Which reconcile loop OWNS a `device_state` row , the single authority on who
 * writes its reported/available state and sweeps its expired command window.
 * This is row ownership expressed as DATA: device-sync used to carry the same
 * classification twice, as hand-maintained negative guards duplicated in
 * reconcile() and sweepExpiredWindows(), and every new enforcer had to remember
 * to extend both or silently reintroduce a double-drive. This function is the one
 * place that decision lives now.
 *
 * The fight-loop rationale, stated ONCE here: four loops write device_state. If
 * two claimed the same row they would double-drive it , e.g. device-sync would
 * snap a lamp to HA every cycle while the light enforcer pushed desired back onto
 * HA (or mark a speaker unavailable while the sonos enforcer holds its sticky
 * desired). So every row shape has EXACTLY ONE owner:
 *   - light-enforcer       : a configured LIGHTS entry (lamps + switch fixtures)
 *   - climate-enforcer      : the thermostat singleton (kind = climate)
 *   - sonos-volume-enforcer : a speaker row (kind = speaker; its entityId is a LAN
 *                             IP that never appears in the HA snapshot)
 *   - device-sync           : everything else (fans + plain HA devices)
 *
 * "Owner" means WHO RECONCILES/SWEEPS the row , NOT who may write desired onto
 * it. Any caller (a tRPC mutation, party mode) may write desired onto a row the
 * light-enforcer owns: that is a writer/owner distinction, by design, and not a
 * violation of single ownership (the light-enforcer still reconciles the row).
 */
export function ownerOf(row: { kind: string; entityId: string }): DeviceOwner {
  if (findLight(row.entityId)) return DeviceOwner.LightEnforcer;
  if (row.kind === DeviceKind.Climate) return DeviceOwner.ClimateEnforcer;
  if (row.kind === DeviceKind.Speaker) return DeviceOwner.SonosVolumeEnforcer;
  return DeviceOwner.DeviceSync;
}

export const HaLightService = {
  TurnOn: "turn_on",
  TurnOff: "turn_off",
} as const;

/** Narrow a DeviceStateValue to a speaker state (has numeric `volume`, never `on`/`mode`). */
export function isSpeakerState(v: DeviceStateValue | null | undefined): v is DeviceSpeakerState {
  return (
    v != null &&
    typeof (v as DeviceSpeakerState).volume === "number" &&
    typeof (v as DeviceLightState).on !== "boolean" &&
    typeof (v as DeviceClimateState).mode !== "string"
  );
}

const HaState = {
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
    case DeviceKind.Climate:
      return { reported: mapHaClimate(entity), available };
    default:
      return { reported: null, available };
  }
}

/**
 * Map an HA climate entity to reported state. `mode`/setpoints/fan are the
 * commandable fields the enforcer drives; ambient + action are reported-only and
 * come straight from HA (current_temperature / hvac_action) , never fabricated.
 * Whichever setpoint shape HA reports (single `temperature` vs the heat_cool
 * `target_temp_low`/`high`) is the one we record.
 */
function mapHaClimate(entity: HaEntity): DeviceClimateState {
  const attrs = entity.attributes;
  const mode = typeof attrs.hvac_mode === "string" ? attrs.hvac_mode : entity.state;
  const climate: DeviceClimateState = { mode };
  if (typeof attrs.temperature === "number") climate.target = attrs.temperature;
  if (typeof attrs.target_temp_low === "number") climate.targetLow = attrs.target_temp_low;
  if (typeof attrs.target_temp_high === "number") climate.targetHigh = attrs.target_temp_high;
  if (typeof attrs.fan_mode === "string") climate.fanMode = attrs.fan_mode;
  if (typeof attrs.current_temperature === "number") climate.ambient = attrs.current_temperature;
  if (typeof attrs.hvac_action === "string") climate.action = attrs.hvac_action;
  return climate;
}

/**
 * Extract a light's color from HA attributes: an `rgb_color` triple or a white
 * `color_temp_kelvin`. Returns undefined when neither is present (e.g. a plain
 * on/off switch, or a light HA hasn't reported color for yet) so we never
 * fabricate a color. Whichever color mode HA reports is the one we record.
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
  if (isLightState(a) && isLightState(b)) {
    if (a.on !== b.on) return false;
    if ((a.brightness ?? null) !== (b.brightness ?? null)) return false;
    return colorEquals(a.color, b.color);
  }
  if (isClimateState(a) && isClimateState(b)) return climateEquals(a, b);
  // Different shapes (light vs climate) are never equal.
  return false;
}

/**
 * Exact climate equality across ALL fields incl. reported-only ambient/action
 * (used for reported-vs-reported change detection , has anything HA reports
 * changed this cycle?). The enforcer's drift check (climateStateConverged) ignores
 * the reported-only fields; this one is precise so a real ambient change registers.
 */
function climateEquals(a: DeviceClimateState, b: DeviceClimateState): boolean {
  return (
    a.mode === b.mode &&
    (a.target ?? null) === (b.target ?? null) &&
    (a.targetLow ?? null) === (b.targetLow ?? null) &&
    (a.targetHigh ?? null) === (b.targetHigh ?? null) &&
    (a.fanMode ?? null) === (b.fanMode ?? null) &&
    (a.ambient ?? null) === (b.ambient ?? null) &&
    (a.action ?? null) === (b.action ?? null)
  );
}

/**
 * The desired to persist when adopting external reality (www-qktc), keeping the
 * last real setpoint alive across an OFF period.
 *
 * Adopting reported verbatim while the thermostat is off FORGETS the setpoint
 * (HA reports none when off). The next off→cool switch then had no number to
 * command or show, and the tile rendered 0°F until HA re-reported a setpoint
 * seconds later. The remembered value is the last one HA actually reported ,
 * carried forward, never invented.
 */
export function rememberedClimateDesired(
  reported: DeviceClimateState,
  ...memory: (DeviceClimateState | null | undefined)[]
): DeviceClimateState {
  const adopted = sanitizeClimateDesired(reported);
  if (climateSetpointsObservable(reported)) return adopted;
  // First memory that actually holds a setpoint wins: the standing desired, then
  // whatever HA last reported before it went off.
  const prior = memory.find((m) => m != null && hasClimateSetpoint(m));
  if (prior == null) return adopted;
  if (prior.target != null) adopted.target = prior.target;
  if (prior.targetLow != null) adopted.targetLow = prior.targetLow;
  if (prior.targetHigh != null) adopted.targetHigh = prior.targetHigh;
  return adopted;
}

/** True when a climate state carries any setpoint (single or heat_cool range). */
function hasClimateSetpoint(state: DeviceClimateState): boolean {
  return state.target != null || state.targetLow != null || state.targetHigh != null;
}

// HA hvac_action values meaning the AC is actively driving its own blower, so
// fan_mode is not freely commandable. Reported raw, lowercase (mapHaClimate
// stores attrs.hvac_action verbatim).
const CONDITIONING_ACTIONS = new Set(["cooling", "heating"]);

/**
 * True when the thermostat is actively heating/cooling (www-pu4m). In this window
 * the AC controls its blower regardless of the dashboard's desired fan_mode, so
 * the climate enforcer yields the fan dimension rather than fight it every cycle.
 */
export function isActivelyConditioning(reported: DeviceClimateState): boolean {
  return reported.action != null && CONDITIONING_ACTIONS.has(reported.action);
}

/**
 * Exact color equality (used for reported-vs-reported change detection). The
 * enforcer applies its own tolerances for desired-vs-reported drift; here we
 * want a precise compare so a genuine color change registers.
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
