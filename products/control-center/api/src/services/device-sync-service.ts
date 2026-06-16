import { getLogger } from "@www/logger";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { findLight } from "../config/lights";
import { db } from "../db/index";
import { deviceState, integrationSyncStatus } from "../db/schema";
import { ha } from "../integrations/homeassistant";
import type { HaEntity } from "../integrations/homeassistant/types";
import { DeviceKind, mapHaToReported, stateEquals } from "./device-state-mapping";

const SYNC_INTEGRATION_ID = "homeassistant";
// Fan-only since the M2 cutover (www-7d5b.2.6): the light enforcer
// (light-enforcer-service) is now the sole owner of light/switch reconcile, so
// device-sync no longer fetches or reconciles the 'light' domain , that would
// double-drive the lights. Fan stays read-from-HA via this loop.
const SYNC_DOMAINS = ["fan"] as const;

/**
 * True for the climate thermostat row, which the climate enforcer owns
 * (www-unxz.2). device-sync must never touch it (write reported, clear desired, or
 * sweep its command window) or it would double-drive the AC.
 */
function isEnforcerManagedClimate(device: { kind: string }): boolean {
  return device.kind === DeviceKind.Climate;
}

/**
 * Speaker rows are owned by the sonos-volume-enforcer (www-5mek). Their entityId
 * is a LAN IP that never exists in the HA snapshot, so without this skip
 * device-sync would mark them unavailable every cycle (and sweep their sticky
 * desired), fighting the enforcer.
 */
function isEnforcerManagedSpeaker(device: { kind: string }): boolean {
  return device.kind === DeviceKind.Speaker;
}

// One device-sync cycle. The schedule lives in the worker runtime (src/worker.ts,
// www-7d5b.1.2) , this module only exposes the single cycle plus the pure
// reconcile/sweep helpers it composes.
export async function runDeviceSyncCycle(): Promise<void> {
  try {
    const snapshot = await fetchSnapshot();
    await reconcile(snapshot);
    await markHeartbeat(null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const consecutiveFailures = (await currentFailureStreak()) + 1;
    getLogger().error({ err, consecutiveFailures }, "device-sync cycle failed");
    await markHeartbeat(msg);
  }
}

async function fetchSnapshot(): Promise<Map<string, HaEntity>> {
  const lists = await Promise.all(SYNC_DOMAINS.map((d) => ha.getEntities(d)));
  const byEntityId = new Map<string, HaEntity>();
  for (const list of lists) for (const e of list) byEntityId.set(e.entity_id, e);
  return byEntityId;
}

export async function reconcile(snapshot: Map<string, HaEntity>): Promise<void> {
  const devices = await db.select().from(deviceState);
  const now = new Date();

  for (const device of devices) {
    // Skip enforcer-managed devices: the light enforcer owns the lights
    // (www-7d5b.2.6) and the climate enforcer owns the thermostat (www-unxz.2).
    // device-sync must not write their state or it would fight the enforcer
    // (double-drive). Fan/other devices fall through as before.
    if (
      findLight(device.entityId) ||
      isEnforcerManagedClimate(device) ||
      isEnforcerManagedSpeaker(device)
    )
      continue;

    const entity = snapshot.get(device.entityId);
    const { reported, available } = mapHaToReported(device.kind, entity);

    const reportedChanged = !stateEquals(device.reportedState ?? null, reported);
    const availabilityChanged = device.available !== available;

    if (reportedChanged || availabilityChanged) {
      await db
        .update(deviceState)
        .set({
          reportedState: reported,
          reportedAtUtc: now,
          ...(reportedChanged ? { reportedChangedAtUtc: now } : {}),
          available,
        })
        .where(eq(deviceState.id, device.id));
    }

    if (
      device.desiredUntilUtc &&
      device.desiredState &&
      stateEquals(reported, device.desiredState) &&
      device.desiredUntilUtc > now
    ) {
      await db
        .update(deviceState)
        .set({ desiredUntilUtc: null, desiredState: null, desiredAtUtc: null })
        .where(eq(deviceState.id, device.id));
    }
  }

  await sweepExpiredWindows(now);
}

export async function sweepExpiredWindows(now: Date): Promise<void> {
  const expired = await db
    .select()
    .from(deviceState)
    .where(and(isNotNull(deviceState.desiredUntilUtc), lt(deviceState.desiredUntilUtc, now)));

  for (const device of expired) {
    // Never sweep an enforcer-managed device: desired is sticky truth for the
    // lights (www-7d5b.2.6) and the climate thermostat (www-unxz.2), so clearing it
    // here would wipe the enforcer's intent. The enforcer, not the desired-window,
    // governs those devices now.
    if (
      findLight(device.entityId) ||
      isEnforcerManagedClimate(device) ||
      isEnforcerManagedSpeaker(device)
    )
      continue;

    await db
      .update(deviceState)
      .set({ desiredUntilUtc: null, desiredState: null, desiredAtUtc: null })
      .where(eq(deviceState.id, device.id));
  }
}

async function markHeartbeat(error: string | null): Promise<void> {
  const now = new Date();
  // consecutiveFailures is a real streak counter: reset to 0 on success,
  // increment the prior value on error (www-355t.9). A single in-process poller
  // runs ticks sequentially, so this read-modify-write is race-free.
  const consecutiveFailures = error ? (await currentFailureStreak()) + 1 : 0;
  await db
    .insert(integrationSyncStatus)
    .values({
      integrationId: SYNC_INTEGRATION_ID,
      lastPolledAtUtc: now,
      lastError: error,
      consecutiveFailures,
    })
    .onConflictDoUpdate({
      target: integrationSyncStatus.integrationId,
      set: {
        lastPolledAtUtc: now,
        lastError: error,
        consecutiveFailures,
      },
    });
}

async function currentFailureStreak(): Promise<number> {
  const rows = await db
    .select({ n: integrationSyncStatus.consecutiveFailures })
    .from(integrationSyncStatus)
    .where(eq(integrationSyncStatus.integrationId, SYNC_INTEGRATION_ID))
    .limit(1);
  return rows[0]?.n ?? 0;
}
