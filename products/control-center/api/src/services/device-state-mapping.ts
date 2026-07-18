import { findLight } from "../config/lights";
import type {
  DeviceClimateState,
  DeviceLightState,
  DeviceSpeakerState,
  DeviceStateValue,
  LightColor,
} from "../db/schema";
import type { HaEntity } from "../integrations/homeassistant/types";

export const DeviceKind = {
  Light: "light",
  Switch: "switch",
  Climate: "climate",
  // Sonos players (www-5mek) , owned by the sonos-volume-enforcer, never HA-mapped.
  Speaker: "speaker",
} as const;
export type DeviceKind = (typeof DeviceKind)[keyof typeof DeviceKind];

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
 * it. The schedule-runner writes desired onto light rows the light-enforcer owns:
 * that is a writer/owner distinction, by design, and not a violation of single
 * ownership (the light-enforcer still reconciles the row).
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

/**
 * Narrow a DeviceStateValue to a light state. The union now also holds
 * DeviceClimateState (www-unxz.2); a light state has the boolean `on` field, which
 * a climate state never does , so this is the discriminant.
 */
export function isLightState(v: DeviceStateValue | null | undefined): v is DeviceLightState {
  return v != null && typeof (v as DeviceLightState).on === "boolean";
}

/** Narrow a DeviceStateValue to a climate state (has `mode`, never `on`). */
export function isClimateState(v: DeviceStateValue | null | undefined): v is DeviceClimateState {
  return (
    v != null &&
    typeof (v as DeviceClimateState).mode === "string" &&
    typeof (v as DeviceLightState).on !== "boolean"
  );
}

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
 * Drift convergence for climate desired-vs-reported (www-unxz.2). Only the
 * COMMANDABLE fields count: mode must match exactly; a SPECIFIED desired setpoint
 * (target / targetLow / targetHigh) must match exactly; fanMode must match when
 * desired specifies it. Reported-only ambient/action are ignored (they can never
 * "drift" from a desired we don't carry). A desired field left unset means "no
 * intent for it", so it can't diverge , same partial-overlay rule as lights.
 */
export function climateStateConverged(
  desired: DeviceClimateState,
  reported: DeviceClimateState,
  opts: { ignoreFan?: boolean } = {},
): boolean {
  if (desired.mode !== reported.mode) return false;
  if (desired.target != null && desired.target !== reported.target) return false;
  if (desired.targetLow != null && desired.targetLow !== reported.targetLow) return false;
  if (desired.targetHigh != null && desired.targetHigh !== reported.targetHigh) return false;
  // While the AC is actively conditioning it owns the blower (ignoreFan); a fan
  // mismatch then is the AC asserting the fan, not drift to fight (www-pu4m).
  if (!opts.ignoreFan && desired.fanMode != null && desired.fanMode !== reported.fanMode) {
    return false;
  }
  return true;
}

/**
 * Strip a climate desired down to the COMMANDABLE fields (mode/setpoints/fan).
 * Desired must never carry the reported-only ambient/action: the merge overlay
 * is desired-over-reported, so a desired holding a seed-time ambient shadows the
 * live reported room temp forever (www-dnpj , the panel froze at the seed-time
 * temperature). Used at enforcer seed, on every desired write, and as the merge
 * overlay so pre-fix rows render correctly even before they self-heal.
 */
export function sanitizeClimateDesired(state: DeviceClimateState): DeviceClimateState {
  const clean: DeviceClimateState = { mode: state.mode };
  if (state.target != null) clean.target = state.target;
  if (state.targetLow != null) clean.targetLow = state.targetLow;
  if (state.targetHigh != null) clean.targetHigh = state.targetHigh;
  if (state.fanMode != null) clean.fanMode = state.fanMode;
  return clean;
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

export interface MergedDeviceState {
  state: DeviceStateValue | null;
  pending: boolean;
  available: boolean;
}

// Tolerances for desired-vs-reported convergence (pending detection). HA does not
// round-trip color/brightness exactly, so a per-channel/absolute slack stops a
// freshly-actuated light from reading as perpetually "pending". Mirrors the
// enforcer's drift tolerances (kept local to avoid a circular import , the
// enforcer imports from this module).
const RGB_CHANNEL_TOLERANCE = 12;
const KELVIN_TOLERANCE = 250;
const BRIGHTNESS_TOLERANCE = 3;

/** True when two colors are within HA round-trip tolerance (or both absent). */
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
 * so a desired that omits brightness/color (e.g. a bare on/off toggle) must NOT
 * count as diverged just because reported has a color. `on` is always specified;
 * brightness/color are compared only when desired specifies them.
 */
function converged(desired: DeviceStateValue, reported: DeviceStateValue): boolean {
  // Climate uses its own commandable-field convergence (www-unxz.2).
  if (isClimateState(desired) || isClimateState(reported)) {
    if (!isClimateState(desired) || !isClimateState(reported)) return false;
    return climateStateConverged(desired, reported);
  }
  if (!isLightState(desired) || !isLightState(reported)) return false;
  if (desired.on !== reported.on) return false;
  if (!desired.on) return true;
  if (
    desired.brightness != null &&
    reported.brightness != null &&
    Math.abs(desired.brightness - reported.brightness) > BRIGHTNESS_TOLERANCE
  ) {
    return false;
  }
  // Only a SPECIFIED desired color can diverge; an absent desired color means
  // "no color intent" → reflect reported, never perpetually pending.
  if (desired.color != null && !colorConverged(desired.color, reported.color)) {
    return false;
  }
  return true;
}

/**
 * Merge reported and desired into the effective state. Desired is the source of
 * truth, but it is a PARTIAL OVERLAY: each field desired specifies wins (the
 * enforcer drives HA to it); fields desired omits fall back to reported. So a
 * bare on/off toggle (`{on}`) still shows the real brightness/color from HA
 * instead of zeros, and `activeScene` derives from the effective color. This
 * matches the enforcer, which only actuates the fields desired specifies
 * (www-7d5b.2.4). `pending` is true only while a SPECIFIED desired field has not
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
    // Climate desired is sanitized first so a stale pre-fix desired carrying the
    // reported-only ambient/action can never shadow the live values (www-dnpj).
    const overlay = isClimateState(desired) ? sanitizeClimateDesired(desired) : desired;
    const state = reported != null ? { ...reported, ...overlay } : desired;
    const pending = reported == null ? true : !converged(desired, reported);
    return { state, pending, available: device.available };
  }
  return { state: reported, pending: false, available: device.available };
}
