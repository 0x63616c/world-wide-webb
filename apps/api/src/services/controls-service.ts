import { LIGHTS } from "../config/lights";
import { db } from "../db/index";
import { deviceState } from "../db/schema";
import { ha } from "../integrations/homeassistant";
import type { HaEntity } from "../integrations/homeassistant/types";
import { mergeDeviceState } from "./device-sync-service";

// ─── types ───────────────────────────────────────────────────────────────────

export interface LampState {
  on: boolean;
  /** Number of lamp entities currently on. */
  count: number;
  /** Sub-label, e.g. "2 on · warm". */
  sub: string;
  pending: boolean;
}

export interface LightState {
  on: boolean;
  pending: boolean;
}

export interface FanState {
  on: boolean;
  /** Sub-label, e.g. "Medium". */
  sub: string;
  pending: boolean;
}

export interface ControlsState {
  lamps: LampState;
  lights: LightState;
  fan: FanState;
}

export type ControlKey = "lamps" | "lights" | "fan";

// ─── helpers ─────────────────────────────────────────────────────────────────

/** True when an HA entity state string represents "on". */
function isOn(entity: HaEntity): boolean {
  return entity.state === "on";
}

/**
 * Colour-temperature attribute → human label.
 * HA reports color_temp_kelvin (or color_temp in mireds); we produce a simple
 * warm / neutral / cool label.
 */
function warmthLabel(entity: HaEntity): string {
  const kelvin = entity.attributes.color_temp_kelvin as number | undefined;
  if (kelvin === undefined) return "";
  if (kelvin <= 3000) return "warm";
  if (kelvin <= 4500) return "neutral";
  return "cool";
}

function lampSub(entities: HaEntity[]): string {
  const onEntities = entities.filter(isOn);
  const n = onEntities.length;
  if (n === 0) return "all off";
  const warmth = onEntities.map(warmthLabel).find(Boolean) ?? "";
  return warmth ? `${n} on · ${warmth}` : `${n} on`;
}

function fanSub(entity: HaEntity | undefined): string {
  if (!entity || !isOn(entity)) return "";
  const speed = entity.attributes.percentage as number | undefined;
  if (speed === undefined) {
    return (entity.attributes.speed as string | undefined) ?? "on";
  }
  if (speed <= 33) return "Low";
  if (speed <= 66) return "Medium";
  return "High";
}

// ─── config-driven entity resolution ─────────────────────────────────────────

/**
 * Resolve lamp and fixture entities from fetched HA entities using the explicit
 * LIGHTS config. Lamps = Hue light.* kind; fixtures = switch.* kind.
 *
 * Only entities listed in config are included — no substring guessing.
 */
function resolveEntities(
  lightEntities: HaEntity[],
  switchEntities: HaEntity[],
): { lamps: HaEntity[]; lights: HaEntity[] } {
  const lampEntityIds = new Set(LIGHTS.filter((l) => l.kind === "lamp").map((l) => l.entityId));
  const fixtureEntityIds = new Set(
    LIGHTS.filter((l) => l.kind === "fixture").map((l) => l.entityId),
  );

  const lamps = lightEntities.filter((e) => lampEntityIds.has(e.entity_id));
  const lights = switchEntities.filter((e) => fixtureEntityIds.has(e.entity_id));

  return { lamps, lights };
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Fetch current merged state of all controllable entities: lamps, lights, fan.
 *
 * Returns null when HA is unconfigured or unreachable so the tile renders
 * shimmer (www-nra rule: no fake data).
 *
 * For any device that has an active desired window, the merged state reflects
 * the desired value with pending=true.
 */
export async function getControlsState(): Promise<ControlsState | null> {
  if (!ha.isConfigured()) {
    return null;
  }

  let lightEntities: HaEntity[] = [];
  let switchEntities: HaEntity[] = [];
  let fanEntities: HaEntity[] = [];

  try {
    [lightEntities, switchEntities, fanEntities] = await Promise.all([
      ha.getEntities("light"),
      ha.getEntities("switch"),
      ha.getEntities("fan"),
    ]);
  } catch {
    return null;
  }

  const { lamps, lights } = resolveEntities(lightEntities, switchEntities);
  const fanEntity = fanEntities[0];

  // Fetch device rows and build a lookup by entityId for overlay merge.
  let deviceRows: (typeof deviceState.$inferSelect)[] = [];
  try {
    deviceRows = await db.select().from(deviceState);
  } catch {
    // DB unreachable — fall through with empty rows (no overlay applied).
  }

  const now = new Date();
  const deviceByEntityId = new Map(deviceRows.map((r) => [r.entityId, r]));

  // Compute per-group pending: if ANY device in the group has an active overlay, the group is pending.
  function isPending(entities: HaEntity[]): boolean {
    return entities.some((e) => {
      const row = deviceByEntityId.get(e.entity_id);
      if (!row) return false;
      return mergeDeviceState(row, now).pending;
    });
  }

  function mergedOn(entity: HaEntity | undefined): boolean {
    if (!entity) return false;
    const row = deviceByEntityId.get(entity.entity_id);
    if (!row) return isOn(entity);
    const merged = mergeDeviceState(row, now);
    return merged.state?.on ?? isOn(entity);
  }

  const lampsOn = lamps.filter((e) => mergedOn(e));
  const anyLightOn = lights.some((e) => mergedOn(e));

  const fanRow = fanEntity ? deviceByEntityId.get(fanEntity.entity_id) : undefined;
  const fanMerged = fanRow ? mergeDeviceState(fanRow, now) : null;
  const fanOn = fanMerged
    ? (fanMerged.state?.on ?? isOn(fanEntity))
    : fanEntity
      ? isOn(fanEntity)
      : false;
  const fanPending = fanMerged?.pending ?? false;

  return {
    lamps: {
      on: lampsOn.length > 0,
      count: lampsOn.length,
      sub: lampSub(lamps),
      pending: isPending(lamps),
    },
    lights: {
      on: anyLightOn,
      pending: isPending(lights),
    },
    fan: {
      on: fanOn,
      sub: fanSub(fanEntity),
      pending: fanPending,
    },
  };
}

/**
 * Toggle lamps, lights, or fan on or off.
 *
 * Uses the explicit LIGHTS config to identify entity ids and domains.
 * Lamps toggle the light domain; fixtures toggle the switch domain.
 * Throws when HA is unconfigured (caller should surface a tRPC error).
 * Returns merged state after dispatching the command.
 */
export async function toggleControl(key: ControlKey, on: boolean): Promise<ControlsState | null> {
  if (!ha.isConfigured()) {
    throw new Error("Home Assistant is not configured");
  }

  const service = on ? "turn_on" : "turn_off";

  switch (key) {
    case "lamps": {
      const lampEntries = LIGHTS.filter((l) => l.kind === "lamp");
      if (lampEntries.length > 0) {
        await ha.callService("light", service, {
          entity_id: lampEntries.map((l) => l.entityId),
        });
      }
      break;
    }

    case "lights": {
      const fixtureEntries = LIGHTS.filter((l) => l.kind === "fixture");
      if (fixtureEntries.length > 0) {
        // Each fixture lives on its own domain (switch). Group by domain and call once per domain.
        const byDomain = new Map<string, string[]>();
        for (const f of fixtureEntries) {
          const ids = byDomain.get(f.domain) ?? [];
          ids.push(f.entityId);
          byDomain.set(f.domain, ids);
        }
        for (const [domain, entityIds] of byDomain) {
          await ha.callService(domain, service, { entity_id: entityIds });
        }
      }
      break;
    }

    case "fan": {
      const entities = await ha.getEntities("fan");
      if (entities.length > 0) {
        await ha.callService("fan", service, {
          entity_id: entities[0].entity_id,
        });
      }
      break;
    }
  }

  return getControlsState();
}
