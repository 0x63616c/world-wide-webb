import { getLogger } from "@www/logger";
import { eq, inArray } from "drizzle-orm";

import { findLight, findLightById, LightKind } from "../config/lights";
import { db } from "../db/index";
import type { DeviceLightState } from "../db/schema";
import { deviceState, lightSchedules } from "../db/schema";
import { upsertDesired } from "./desired-state-store";
import { DeviceKind } from "./device-state-mapping";
import { actionEndpoints, type FadeEndpoint, interpolateLight } from "./schedule-fade";
import {
  decideScheduleFires,
  getTodaySun,
  localDateKey,
  type ScheduleRow,
} from "./schedule-service";

interface Fade {
  end: FadeEndpoint;
  start: FadeEndpoint;
  startedMs: number;
  fadeMinutes: number;
  lastWritten: DeviceLightState | null;
}

// entityId → active fade. Module-level so it survives across ticks (a worker
// restart clears it — acceptable, next day's fire re-runs). A snap action is just a
// fade with fadeMinutes 0 that completes on its first step.
const activeFades = new Map<string, Fade>();

/** Fraction 0..1 of a fade elapsed. fadeMinutes<=0 → 1 (snap). */
export function fadeProgress(startedMs: number, nowMs: number, fadeMinutes: number): number {
  if (fadeMinutes <= 0) return 1;
  const frac = (nowMs - startedMs) / (fadeMinutes * 60_000);
  return Math.min(1, Math.max(0, frac));
}

/** Read the current desired state for a set of entity ids. */
async function currentDesired(entityIds: string[]): Promise<Map<string, DeviceLightState | null>> {
  const rows = await db.select().from(deviceState).where(inArray(deviceState.entityId, entityIds));
  return new Map(
    rows.map((r) => [r.entityId, (r.desiredState as DeviceLightState | null) ?? null]),
  );
}

/** Build a FadeEndpoint from an existing desired state (the fade's start point). */
function endpointFromDesired(s: DeviceLightState | null): FadeEndpoint {
  return {
    on: s?.on ?? false,
    brightnessRaw: s?.brightness,
    rgb: s?.color?.rgb,
    kelvin: s?.color?.kelvin,
  };
}

/** Write desired for one entity (+ command window) so the enforcer actuates it. */
async function writeDesired(entityId: string, desired: DeviceLightState): Promise<void> {
  const light = findLight(entityId);
  if (!light) return;
  // The store owns the upsert + command-window stamp and throws on DB failure; the
  // cycle catches per-fade (a bad write must not abort the other targets' fades).
  await upsertDesired({
    id: light.id,
    kind: light.kind === LightKind.Lamp ? DeviceKind.Light : DeviceKind.Switch,
    entityId: light.entityId,
    domain: light.domain,
    label: light.label,
    desired,
  });
}

/**
 * One scheduler tick. Loads enabled schedules + today's sun, fires any whose
 * trigger just passed (edge-triggered once/day via lastFiredDate), registers a
 * fade per target (snap = fadeMinutes 0), then steps every active fade, writing
 * the interpolated desired state. Manual override aborts a fade: if a target's
 * current desired no longer equals what the fade last wrote, the fade drops that
 * target. The scheduler NEVER calls HA — the light-enforcer actuates the writes.
 */
export async function runScheduleRunnerCycle(): Promise<void> {
  const log = getLogger();
  const now = new Date();
  const today = localDateKey(now);

  let schedules: (typeof lightSchedules.$inferSelect)[] = [];
  try {
    schedules = await db.select().from(lightSchedules).where(eq(lightSchedules.enabled, true));
  } catch (err) {
    log.warn({ err }, "schedule-runner: load failed");
    return;
  }
  const sun = await getTodaySun(today);

  const rows: ScheduleRow[] = schedules.map((s) => ({
    id: s.id,
    enabled: s.enabled,
    days: s.days,
    trigger: s.trigger,
    lastFiredDate: s.lastFiredDate,
  }));
  const firing = new Set(decideScheduleFires(now, rows, sun));

  // Start fades for firing schedules, and stamp lastFiredDate so they fire once/day.
  for (const s of schedules) {
    if (!firing.has(s.id)) continue;
    const targetEntityIds = s.targetIds
      .map((id) => findLightById(id))
      .filter((l): l is NonNullable<typeof l> => !!l)
      .map((l) => l.entityId);
    if (targetEntityIds.length === 0) continue;
    const ends = actionEndpoints(s.action, targetEntityIds);
    const starts = await currentDesired(targetEntityIds);
    for (const entityId of targetEntityIds) {
      const end = ends.get(entityId);
      if (!end) continue;
      activeFades.set(entityId, {
        end,
        start: endpointFromDesired(starts.get(entityId) ?? null),
        startedMs: now.getTime(),
        fadeMinutes: s.action.fadeMinutes ?? 0,
        lastWritten: null,
      });
    }
    try {
      await db
        .update(lightSchedules)
        .set({ lastFiredDate: today })
        .where(eq(lightSchedules.id, s.id));
    } catch (err) {
      log.warn({ err, id: s.id }, "schedule-runner: lastFiredDate stamp failed");
    }
    log.info({ id: s.id, name: s.name, targets: targetEntityIds.length }, "schedule fired");
  }

  // Step every active fade.
  if (activeFades.size > 0) {
    const ids = [...activeFades.keys()];
    const desiredNow = await currentDesired(ids);
    for (const entityId of ids) {
      const fade = activeFades.get(entityId);
      if (!fade) continue;
      // Abort guard: user (or another schedule) changed desired out from under us.
      const cur = desiredNow.get(entityId) ?? null;
      if (fade.lastWritten && JSON.stringify(cur) !== JSON.stringify(fade.lastWritten)) {
        activeFades.delete(entityId);
        log.info({ entityId }, "schedule fade aborted (manual override)");
        continue;
      }
      const t = fadeProgress(fade.startedMs, now.getTime(), fade.fadeMinutes);
      const desired = interpolateLight(fade.start, fade.end, t);
      try {
        await writeDesired(entityId, desired);
        fade.lastWritten = desired;
      } catch (err) {
        log.warn({ err, entityId }, "schedule-runner: desired write failed");
      }
      if (t >= 1) activeFades.delete(entityId); // fade complete (snap completes at once)
    }
  }
}
