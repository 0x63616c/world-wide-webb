import { type DeviceStateStore, type HaEntity, isLightState } from "@www/core";
import { BEDROOM_LAMPS, writeLightGroup } from "./light-command";

export interface SwitchConfig {
  BEDROOM_SWITCH_INPUT_ENABLED?: string;
  BEDROOM_SWITCH_INPUT_VERIFIED?: string;
  BEDROOM_SWITCH_INPUT_ENTITY_ID?: string;
}

export function verifiedInput(config: SwitchConfig): string | null {
  const id = config.BEDROOM_SWITCH_INPUT_ENTITY_ID?.trim();
  return config.BEDROOM_SWITCH_INPUT_ENABLED === "true" &&
    config.BEDROOM_SWITCH_INPUT_VERIFIED === "true" &&
    id &&
    /^binary_sensor\.[a-z0-9_]+$/.test(id)
    ? id
    : null;
}

export interface InputSample {
  state: "on" | "off";
  changed: string;
}

export function parseInput(entity: HaEntity | null | undefined): InputSample | null {
  if (
    !entity ||
    (entity.state !== "on" && entity.state !== "off") ||
    entity.attributes.restored === true ||
    !entity.last_changed ||
    !Number.isFinite(Date.parse(entity.last_changed))
  )
    return null;
  // Normalize UTC precision without discarding HA's microsecond ordering.
  const match = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(
    entity.last_changed,
  );
  if (!match) return null;
  return { state: entity.state, changed: `${match[1]}.${(match[2] ?? "").padEnd(6, "0")}Z` };
}

/** One trusted websocket session. Invalid samples break continuity. No timers or inferred edges.
 * First sample is baseline; monotonic HA last_changed is the durable replay watermark.
 * Edges within 150ms of an accepted edge are contact bounce. The level still advances,
 * so the next real flip works; flips >=150ms apart are never coalesced. */
export function createBedroomSwitch(config: SwitchConfig, store: DeviceStateStore) {
  const entityId = verifiedInput(config);
  let previous: InputSample | null = null;
  return {
    async sample(
      entity: HaEntity | null | undefined,
      snapshot = false,
      oldEntity?: HaEntity | null,
    ): Promise<void> {
      if (!entityId) return;
      const next = entity?.entity_id === entityId ? parseInput(entity) : null;
      if (!next) {
        previous = null;
        return;
      }
      const before = previous;
      await store.lightTransaction(async (locked) => {
        const saved = await locked.readInput(entityId);
        if (saved && next.changed <= saved.changed) return;
        const changedMs = Date.parse(next.changed);
        const old = parseInput(oldEntity);
        const edge =
          !snapshot &&
          before &&
          oldEntity?.entity_id === entityId &&
          old?.changed === before.changed &&
          old.state === before.state &&
          before.state !== next.state &&
          before.changed < next.changed;
        const accept = edge && (saved?.actedAt == null || changedMs - saved.actedAt >= 150);
        if (accept) {
          const rows = await locked.list({ entityIds: BEDROOM_LAMPS.map((e) => e.entityId) });
          // No guessed initial lamp intent. Baseline input but don't act until all lamps seeded.
          if (
            BEDROOM_LAMPS.every((e) =>
              rows.some((r) => r.entityId === e.entityId && isLightState(r.desiredState)),
            )
          ) {
            const on = !rows.some((r) => isLightState(r.desiredState) && r.desiredState.on);
            await writeLightGroup(BEDROOM_LAMPS, (_e, prev) => ({ ...prev, on }), locked);
            await locked.writeInput(entityId, { ...next, actedAt: changedMs });
            return;
          }
        }
        await locked.writeInput(entityId, { ...next, actedAt: saved?.actedAt ?? null });
      });
      // Commit local continuity only after DB success, allowing safe retry after rollback.
      if (!previous || next.changed > previous.changed) previous = next;
    },
  };
}
