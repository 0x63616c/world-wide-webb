import { and, desc, eq, isNotNull, lt } from "drizzle-orm";

import { db } from "../db/index";
import type { DeviceStateValue } from "../db/schema";
import { deviceCommands, deviceState, integrationSyncStatus } from "../db/schema";
import { ha } from "../integrations/homeassistant";
import type { HaEntity } from "../integrations/homeassistant/types";
import { CommandStatus } from "./device-command-service";
import { mapHaToReported, stateEquals } from "./device-state-mapping";

const SYNC_INTEGRATION_ID = "homeassistant";
const SYNC_INTERVAL_MS = 1_000;
const SYNC_DOMAINS = ["light", "fan"] as const;

export interface DeviceSyncHandle {
  stop: () => void;
}

export interface MergedDeviceState {
  state: DeviceStateValue | null;
  pending: boolean;
  available: boolean;
}

export function mergeDeviceState(
  device: {
    reportedState?: DeviceStateValue | null;
    desiredState?: DeviceStateValue | null;
    desiredUntilUtc?: Date | null;
    available: boolean;
  },
  now: Date,
): MergedDeviceState {
  if (device.desiredUntilUtc && device.desiredUntilUtc > now && device.desiredState != null) {
    return { state: device.desiredState, pending: true, available: device.available };
  }
  return { state: device.reportedState ?? null, pending: false, available: device.available };
}

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

export function startDeviceSyncService(): DeviceSyncHandle {
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    await runDeviceSyncCycle();
    if (stopped) return;
    setTimeout(tick, SYNC_INTERVAL_MS);
  };

  void tick();

  return {
    stop: () => {
      stopped = true;
    },
  };
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
  await db
    .insert(integrationSyncStatus)
    .values({
      integrationId: SYNC_INTEGRATION_ID,
      lastPolledAtUtc: now,
      lastError: error,
      consecutiveFailures: 0,
    })
    .onConflictDoUpdate({
      target: integrationSyncStatus.integrationId,
      set: {
        lastPolledAtUtc: now,
        lastError: error,
        consecutiveFailures: 0,
      },
    });
}
