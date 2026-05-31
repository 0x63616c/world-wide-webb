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
