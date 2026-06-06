import { and, desc, eq, isNotNull, lt } from "drizzle-orm";

import { findLight } from "../config/lights";
import { db } from "../db/index";
import { deviceCommands, deviceState, integrationSyncStatus } from "../db/schema";
import { ha } from "../integrations/homeassistant";
import type { HaEntity } from "../integrations/homeassistant/types";
import { CommandStatus } from "./device-command-service";
import { mapHaToReported, stateEquals } from "./device-state-mapping";

const SYNC_INTEGRATION_ID = "homeassistant";
// Fan-only since the M2 cutover (www-7d5b.2.6): the light enforcer
// (light-enforcer-service) is now the sole owner of light/switch reconcile, so
// device-sync no longer fetches or reconciles the 'light' domain — that would
// double-drive the lights. Fan stays read-from-HA via this loop.
const SYNC_DOMAINS = ["fan"] as const;

// One device-sync cycle. The schedule lives in the worker runtime (src/worker.ts,
// www-7d5b.1.2) — this module only exposes the single cycle plus the pure
// reconcile/sweep helpers it composes.
export async function runDeviceSyncCycle(): Promise<void> {
  try {
    const snapshot = await fetchSnapshot();
    await reconcile(snapshot);
    await markHeartbeat(null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
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
    // Skip enforcer-managed lights: the light enforcer owns their desired/reported
    // reconcile (www-7d5b.2.6). device-sync must not write their state or it would
    // fight the enforcer (double-drive). Fan/other devices fall through as before.
    if (findLight(device.entityId)) continue;

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
      await confirmLatestSentCommand(device.id, now);
    }
  }

  await sweepExpiredWindows(now);
}

async function confirmLatestSentCommand(deviceId: string, at: Date): Promise<void> {
  const rows = await db
    .select()
    .from(deviceCommands)
    .where(
      and(eq(deviceCommands.deviceId, deviceId), eq(deviceCommands.status, CommandStatus.Sent)),
    )
    .orderBy(desc(deviceCommands.issuedAtUtc))
    .limit(1);
  const row = rows[0];
  if (!row) return;
  await db
    .update(deviceCommands)
    .set({ status: CommandStatus.Confirmed, confirmedAtUtc: at })
    .where(eq(deviceCommands.id, row.id));
}

export async function sweepExpiredWindows(now: Date): Promise<void> {
  const expired = await db
    .select()
    .from(deviceState)
    .where(and(isNotNull(deviceState.desiredUntilUtc), lt(deviceState.desiredUntilUtc, now)));

  for (const device of expired) {
    // Never sweep an enforcer-managed light: desired is sticky truth for those
    // (www-7d5b.2.6), so clearing it here would wipe the enforcer's intent. The
    // enforcer, not the desired-window, governs managed lights now.
    if (findLight(device.entityId)) continue;

    const desired = device.desiredState;
    const reported = device.reportedState ?? null;
    const settled = stateEquals(reported, desired);

    await db
      .update(deviceState)
      .set({ desiredUntilUtc: null, desiredState: null, desiredAtUtc: null })
      .where(eq(deviceState.id, device.id));

    if (!settled) {
      const rows = await db
        .select()
        .from(deviceCommands)
        .where(
          and(
            eq(deviceCommands.deviceId, device.id),
            eq(deviceCommands.status, CommandStatus.Sent),
          ),
        )
        .orderBy(desc(deviceCommands.issuedAtUtc))
        .limit(1);
      const row = rows[0];
      if (row) {
        await db
          .update(deviceCommands)
          .set({
            status: CommandStatus.Timeout,
            error: "Desired window expired before HA reflected change",
          })
          .where(eq(deviceCommands.id, row.id));
      }
    }
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
