import { ha } from "../integrations/homeassistant";

export type ClimateMode = "cool" | "auto" | "heat";
export type ClimateAction = "Cooling" | "Heating" | "Auto" | "Idle";

export interface ClimateState {
  target: number;
  ambient: number;
  mode: ClimateMode;
  action: ClimateAction;
}

const FALLBACK: ClimateState = {
  target: 70,
  ambient: 72,
  mode: "auto",
  action: "Idle",
};

function normaliseMode(raw: string | undefined): ClimateMode {
  if (raw === "cool") return "cool";
  if (raw === "heat") return "heat";
  return "auto";
}

function normaliseAction(raw: string | undefined): ClimateAction {
  if (raw === "cooling") return "Cooling";
  if (raw === "heating") return "Heating";
  return "Idle";
}

export async function getClimate(): Promise<ClimateState> {
  if (!ha.isConfigured()) return FALLBACK;

  try {
    const entities = await ha.getEntities("climate");
    if (entities.length === 0) return FALLBACK;

    // Pick first entity alphabetically.
    const sorted = [...entities].sort((a, b) => a.entity_id.localeCompare(b.entity_id));
    const entity = sorted[0];
    const attrs = entity.attributes;

    const ambient =
      typeof attrs.current_temperature === "number" ? attrs.current_temperature : FALLBACK.ambient;

    const target = typeof attrs.temperature === "number" ? attrs.temperature : FALLBACK.target;

    const mode = normaliseMode(
      typeof attrs.hvac_mode === "string" ? attrs.hvac_mode : entity.state,
    );

    const action = normaliseAction(
      typeof attrs.hvac_action === "string" ? attrs.hvac_action : undefined,
    );

    return { target, ambient, mode, action };
  } catch {
    return FALLBACK;
  }
}

export async function setClimateTarget(
  entityId: string,
  temperature: number,
): Promise<ClimateState> {
  await ha.callService("climate", "set_temperature", {
    entity_id: entityId,
    temperature,
  });
  // Optimistic: return state with updated target. Ambient/action unchanged.
  const current = await getClimate().catch(() => FALLBACK);
  return { ...current, target: temperature };
}

export async function setClimateMode(
  entityId: string,
  hvacMode: ClimateMode,
): Promise<ClimateState> {
  await ha.callService("climate", "set_hvac_mode", {
    entity_id: entityId,
    hvac_mode: hvacMode,
  });
  const current = await getClimate().catch(() => FALLBACK);
  return { ...current, mode: hvacMode };
}

/** Resolve the first climate entity id, or undefined if HA unavailable. */
export async function resolveClimateEntityId(): Promise<string | undefined> {
  if (!ha.isConfigured()) return undefined;
  try {
    const entities = await ha.getEntities("climate");
    if (entities.length === 0) return undefined;
    return [...entities].sort((a, b) => a.entity_id.localeCompare(b.entity_id))[0].entity_id;
  } catch {
    return undefined;
  }
}
