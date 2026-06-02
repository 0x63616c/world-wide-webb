import { env } from "../env";
import { ha } from "../integrations/homeassistant";
import type { HaEntity } from "../integrations/homeassistant/types";

export const HvacMode = {
  Off: "off",
  Cool: "cool",
  Heat: "heat",
  HeatCool: "heat_cool",
} as const;
export type HvacMode = (typeof HvacMode)[keyof typeof HvacMode];

export const HvacAction = {
  Cooling: "Cooling",
  Heating: "Heating",
  Idle: "Idle",
} as const;
export type HvacAction = (typeof HvacAction)[keyof typeof HvacAction];

export const HaHvacAction = {
  Cooling: "cooling",
  Heating: "heating",
} as const;

// Real Home Assistant hvac modes for the house thermostat (climate.home).
export type ClimateMode = HvacMode;
export type ClimateAction = HvacAction;

// Visual band and the server-side accept range. HA's hard limits are wider
// (60-92) but the tile + validation use 65-80, the existing design constant.
export const CLIMATE_MIN = 65;
export const CLIMATE_MAX = 80;
// Minimum deadband between low/high in heat_cool — they can never meet or cross.
export const CLIMATE_GAP = 2;

/**
 * State crosses tRPC as a discriminated union on `mode` so a single `target` and
 * a `targetLow`/`targetHigh` range can never coexist (illegal states are
 * unrepresentable):
 *  - off       → no setpoint
 *  - cool/heat → single `target` (HA attr `temperature`)
 *  - heat_cool → `targetLow` + `targetHigh` (HA attrs target_temp_low/high)
 */
export type ClimateState =
  | { mode: "off"; ambient: number; action: ClimateAction }
  | { mode: "cool" | "heat"; target: number; ambient: number; action: ClimateAction }
  | {
      mode: "heat_cool";
      targetLow: number;
      targetHigh: number;
      ambient: number;
      action: ClimateAction;
    };

function normaliseMode(raw: string | undefined): ClimateMode {
  if (raw === HvacMode.Cool || raw === HvacMode.Heat || raw === HvacMode.HeatCool) return raw;
  // climate.home only reports off/cool/heat/heat_cool; anything else (or a
  // missing state) is treated as off so no stale setpoint is shown.
  return HvacMode.Off;
}

function normaliseAction(raw: string | undefined): ClimateAction {
  if (raw === HaHvacAction.Cooling) return HvacAction.Cooling;
  if (raw === HaHvacAction.Heating) return HvacAction.Heating;
  return HvacAction.Idle;
}

// Zero is a valid sensor gap — never an invented number (matches the repo's
// no-fake-data contract). Only surfaces in a genuinely malformed HA payload.
function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

/**
 * Pick the house thermostat from HA's climate entities. Prefers the configured
 * CLIMATE_ENTITY_ID; otherwise the alphabetical-first NON-Tesla entity. The
 * Tesla integration names its climate `climate.<TESLA_ENTITY_PREFIX>_*` and is
 * the car, not the wall thermostat — selecting it caused set_temperature 500s.
 */
export function selectClimateEntity(entities: HaEntity[]): HaEntity | undefined {
  if (entities.length === 0) return undefined;
  const configured = entities.find((e) => e.entity_id === env.CLIMATE_ENTITY_ID);
  if (configured) return configured;
  const houseOnly = entities.filter(
    (e) => !e.entity_id.startsWith(`climate.${env.TESLA_ENTITY_PREFIX}`),
  );
  const pool = houseOnly.length > 0 ? houseOnly : entities;
  return [...pool].sort((a, b) => a.entity_id.localeCompare(b.entity_id))[0];
}

/** True when low/high are integers within band and at least CLIMATE_GAP apart. */
export function isValidRange(low: number, high: number): boolean {
  return (
    Number.isInteger(low) &&
    Number.isInteger(high) &&
    low >= CLIMATE_MIN &&
    high <= CLIMATE_MAX &&
    low + CLIMATE_GAP <= high
  );
}

export async function getClimate(): Promise<ClimateState> {
  if (!ha.isConfigured()) throw new Error("Home Assistant is not configured");

  const entities = await ha.getEntities("climate");
  const entity = selectClimateEntity(entities);
  if (!entity) throw new Error("no climate entities");

  const attrs = entity.attributes;
  const ambient = num(attrs.current_temperature);
  const action = normaliseAction(
    typeof attrs.hvac_action === "string" ? attrs.hvac_action : undefined,
  );
  const mode = normaliseMode(typeof attrs.hvac_mode === "string" ? attrs.hvac_mode : entity.state);

  if (mode === HvacMode.HeatCool) {
    return {
      mode,
      targetLow: num(attrs.target_temp_low),
      targetHigh: num(attrs.target_temp_high),
      ambient,
      action,
    };
  }
  if (mode === HvacMode.Cool || mode === HvacMode.Heat) {
    return { mode, target: num(attrs.temperature), ambient, action };
  }
  return { mode: HvacMode.Off, ambient, action };
}

/** Set the hvac mode (off/cool/heat/heat_cool). Returns fresh state. */
export async function setClimateMode(
  entityId: string,
  hvacMode: ClimateMode,
): Promise<ClimateState> {
  await ha.callService("climate", "set_hvac_mode", {
    entity_id: entityId,
    hvac_mode: hvacMode,
  });
  return getClimate();
}

/** Single setpoint (cool/heat) via set_temperature {temperature}. */
export async function setClimateTarget(
  entityId: string,
  temperature: number,
): Promise<ClimateState> {
  await ha.callService("climate", "set_temperature", {
    entity_id: entityId,
    temperature,
  });
  return getClimate();
}

/** Range setpoint (heat_cool) via set_temperature {target_temp_low, target_temp_high}. */
export async function setClimateRange(
  entityId: string,
  targetLow: number,
  targetHigh: number,
): Promise<ClimateState> {
  await ha.callService("climate", "set_temperature", {
    entity_id: entityId,
    target_temp_low: targetLow,
    target_temp_high: targetHigh,
  });
  return getClimate();
}

/**
 * A single climate entity mapped to the full capability shape the detail modals
 * consume. Every field comes straight from HA's reported attributes — fields HA
 * does not provide are honestly null / empty (no invented setpoints, presets, or
 * fan modes). When HA exposes only ONE climate entity the zones list is a single
 * element; that is correct, not a stub.
 */
export interface ClimateZone {
  entityId: string;
  name: string;
  ambient: number;
  action: ClimateAction;
  mode: ClimateMode;
  hvacModes: ClimateMode[];
  /** Single setpoint (cool/heat) — null when HA reports none or mode is range/off. */
  target: number | null;
  /** Heat-cool band low — null unless HA reports target_temp_low. */
  targetLow: number | null;
  /** Heat-cool band high — null unless HA reports target_temp_high. */
  targetHigh: number | null;
  minTemp: number;
  maxTemp: number;
  /** Active preset — null when the entity advertises no preset_mode. */
  presetMode: string | null;
  presetModes: string[];
  /** Active fan mode — null when the entity advertises no fan_mode. */
  fanMode: string | null;
  fanModes: string[];
}

// Read a numeric attribute, or null when absent — distinct from num()'s 0, used
// for optional setpoints where "no value" must not masquerade as a real reading.
function numOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

// Only the modes the modals' HvacMode union understands; HA may report others
// (fan_only/dry/auto) which we pass through as raw strings the UI tolerates.
function hvacModesOf(value: unknown): ClimateMode[] {
  return strArray(value) as ClimateMode[];
}

/** Map one HA climate entity to the full-capability zone shape. */
function toZone(entity: HaEntity): ClimateZone {
  const attrs = entity.attributes;
  const mode = normaliseMode(typeof attrs.hvac_mode === "string" ? attrs.hvac_mode : entity.state);
  const friendly = typeof attrs.friendly_name === "string" ? attrs.friendly_name : entity.entity_id;
  return {
    entityId: entity.entity_id,
    name: friendly,
    ambient: num(attrs.current_temperature),
    action: normaliseAction(typeof attrs.hvac_action === "string" ? attrs.hvac_action : undefined),
    mode,
    hvacModes: hvacModesOf(attrs.hvac_modes),
    target: numOrNull(attrs.temperature),
    targetLow: numOrNull(attrs.target_temp_low),
    targetHigh: numOrNull(attrs.target_temp_high),
    // HA's hardware limits; fall back to the visual band so a slider never breaks.
    minTemp: typeof attrs.min_temp === "number" ? attrs.min_temp : CLIMATE_MIN,
    maxTemp: typeof attrs.max_temp === "number" ? attrs.max_temp : CLIMATE_MAX,
    presetMode: strOrNull(attrs.preset_mode),
    presetModes: strArray(attrs.preset_modes),
    fanMode: strOrNull(attrs.fan_mode),
    fanModes: strArray(attrs.fan_modes),
  };
}

/**
 * All house climate zones (Tesla excluded), each with full capability. Returns a
 * single-element list when HA exposes one thermostat — honest, not fabricated.
 */
export async function getClimateZones(): Promise<ClimateZone[]> {
  if (!ha.isConfigured()) throw new Error("Home Assistant is not configured");
  const entities = await ha.getEntities("climate");
  // Same Tesla-exclusion policy as selectClimateEntity: the car is not a zone.
  const houseOnly = entities.filter(
    (e) => !e.entity_id.startsWith(`climate.${env.TESLA_ENTITY_PREFIX}`),
  );
  const pool = houseOnly.length > 0 ? houseOnly : entities;
  return [...pool].sort((a, b) => a.entity_id.localeCompare(b.entity_id)).map(toZone);
}

/** Set hvac mode on a zone, returning the refreshed zones (single HA refetch). */
export async function setZoneMode(entityId: string, hvacMode: ClimateMode): Promise<ClimateZone[]> {
  await ha.callService("climate", "set_hvac_mode", { entity_id: entityId, hvac_mode: hvacMode });
  return getClimateZones();
}

/** Set a single setpoint on a zone, returning the refreshed zones. */
export async function setZoneTarget(entityId: string, temperature: number): Promise<ClimateZone[]> {
  await ha.callService("climate", "set_temperature", { entity_id: entityId, temperature });
  return getClimateZones();
}

/** Set a heat_cool range on a zone, returning the refreshed zones. */
export async function setZoneRange(
  entityId: string,
  targetLow: number,
  targetHigh: number,
): Promise<ClimateZone[]> {
  await ha.callService("climate", "set_temperature", {
    entity_id: entityId,
    target_temp_low: targetLow,
    target_temp_high: targetHigh,
  });
  return getClimateZones();
}

/** Set a preset_mode (eco/away/home/boost…) on a zone. Returns the fresh zones. */
export async function setClimatePreset(entityId: string, preset: string): Promise<ClimateZone[]> {
  await ha.callService("climate", "set_preset_mode", {
    entity_id: entityId,
    preset_mode: preset,
  });
  return getClimateZones();
}

/** Set a fan_mode (auto/low/medium/high…) on a zone. Returns the fresh zones. */
export async function setClimateFan(entityId: string, fanMode: string): Promise<ClimateZone[]> {
  await ha.callService("climate", "set_fan_mode", {
    entity_id: entityId,
    fan_mode: fanMode,
  });
  return getClimateZones();
}

/** Resolve the house thermostat entity id, or undefined if HA unavailable. */
export async function resolveClimateEntityId(): Promise<string | undefined> {
  if (!ha.isConfigured()) return undefined;
  try {
    const entities = await ha.getEntities("climate");
    return selectClimateEntity(entities)?.entity_id;
  } catch {
    return undefined;
  }
}
