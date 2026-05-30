import { ha } from "../integrations/homeassistant";
import type { HaEntity } from "../integrations/homeassistant/types";

// ─── types ───────────────────────────────────────────────────────────────────

export interface LampState {
  on: boolean;
  /** Number of lamp entities currently on. */
  count: number;
  /** Sub-label, e.g. "2 on · warm". */
  sub: string;
}

export interface LightState {
  on: boolean;
}

export interface FanState {
  on: boolean;
  /** Sub-label, e.g. "Medium". */
  sub: string;
}

export interface ControlsState {
  lamps: LampState;
  lights: LightState;
  fan: FanState;
}

export type ControlKey = "lamps" | "lights" | "fan";

// ─── fallback / placeholder ──────────────────────────────────────────────────

const FALLBACK: ControlsState = {
  lamps: { on: true, count: 2, sub: "2 on · warm" },
  lights: { on: false },
  fan: { on: false, sub: "" },
};

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

// ─── entity resolution ───────────────────────────────────────────────────────

/**
 * Classify light entities into "lamps" (floor/table/accent) vs "lights"
 * (ceiling/overhead/main). Heuristics based on entity id / friendly name.
 */
function classifyLights(entities: HaEntity[]): {
  lamps: HaEntity[];
  lights: HaEntity[];
} {
  const lampKeywords = ["lamp", "floor", "table", "accent", "corner", "side"];
  const lamps: HaEntity[] = [];
  const lights: HaEntity[] = [];

  for (const e of entities) {
    const id = e.entity_id.toLowerCase();
    const name = String(e.attributes.friendly_name ?? "").toLowerCase();
    const isLamp = lampKeywords.some((k) => id.includes(k) || name.includes(k));
    if (isLamp) {
      lamps.push(e);
    } else {
      lights.push(e);
    }
  }

  return { lamps, lights };
}

// ─── public API ──────────────────────────────────────────────────────────────

/**
 * Fetch current state of all controllable entities: lamps, lights, fan.
 *
 * Degrades gracefully: when HA is unconfigured or unreachable returns
 * `FALLBACK` so the tile never renders blank.
 */
export async function getControlsState(): Promise<ControlsState> {
  if (!ha.isConfigured()) {
    return FALLBACK;
  }

  let lightEntities: HaEntity[] = [];
  let fanEntities: HaEntity[] = [];

  try {
    [lightEntities, fanEntities] = await Promise.all([
      ha.getEntities("light"),
      ha.getEntities("fan"),
    ]);
  } catch {
    return FALLBACK;
  }

  const { lamps, lights } = classifyLights(lightEntities);
  const fanEntity = fanEntities[0];

  const lampsOn = lamps.filter(isOn);
  const anyLightOn = lights.some(isOn);
  const fanOn = fanEntity ? isOn(fanEntity) : false;

  return {
    lamps: {
      on: lampsOn.length > 0,
      count: lampsOn.length,
      sub: lampSub(lamps),
    },
    lights: {
      on: anyLightOn,
    },
    fan: {
      on: fanOn,
      sub: fanSub(fanEntity),
    },
  };
}

/**
 * Toggle lamps, lights, or fan.
 *
 * Resolves the entity list at toggle-time so we always act on current state.
 * Throws when HA is unconfigured (caller should surface a tRPC error).
 */
export async function toggleControl(key: ControlKey, on: boolean): Promise<void> {
  if (!ha.isConfigured()) {
    throw new Error("Home Assistant is not configured");
  }

  switch (key) {
    case "lamps": {
      const entities = await ha.getEntities("light");
      const { lamps } = classifyLights(entities);
      const service = on ? "turn_on" : "turn_off";
      if (lamps.length === 0) {
        // No classified lamp entities — fall back to all lights.
        const all = entities.map((e) => e.entity_id);
        if (all.length > 0) {
          await ha.callService("light", service, { entity_id: all });
        }
        return;
      }
      await ha.callService("light", service, {
        entity_id: lamps.map((e) => e.entity_id),
      });
      return;
    }

    case "lights": {
      const entities = await ha.getEntities("light");
      const { lights } = classifyLights(entities);
      const service = on ? "turn_on" : "turn_off";
      if (lights.length === 0) {
        // No classified ceiling lights — act on all.
        const all = entities.map((e) => e.entity_id);
        if (all.length > 0) {
          await ha.callService("light", service, { entity_id: all });
        }
        return;
      }
      await ha.callService("light", service, {
        entity_id: lights.map((e) => e.entity_id),
      });
      return;
    }

    case "fan": {
      const entities = await ha.getEntities("fan");
      const service = on ? "turn_on" : "turn_off";
      if (entities.length === 0) return;
      await ha.callService("fan", service, {
        entity_id: entities[0].entity_id,
      });
      return;
    }
  }
}
