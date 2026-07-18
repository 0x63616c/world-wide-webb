import { and, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "../db/index";
import { deviceState } from "../db/schema";
import { ha } from "../integrations/homeassistant";
import type { HaEntity } from "../integrations/homeassistant/types";
import { DeviceOwner, mapHaToReported, ownerOf, stateEquals } from "./device-state-mapping";
import { heartbeat, runCycle } from "./integration-heartbeat";

const SYNC_INTEGRATION_ID = "homeassistant";
// Fan-only since the M2 cutover (www-7d5b.2.6): the light enforcer
// (light-enforcer-service) is now the sole owner of light/switch reconcile, so
// device-sync no longer fetches or reconciles the 'light' domain , that would
// double-drive the lights. Fan stays read-from-HA via this loop.
const SYNC_DOMAINS = ["fan"] as const;

// One device-sync cycle. The schedule lives in the worker runtime (src/worker.ts,
// www-7d5b.1.2) , this module only exposes the single cycle plus the pure
// reconcile/sweep helpers it composes.
export async function runDeviceSyncCycle(): Promise<void> {
  await runCycle(heartbeat(SYNC_INTEGRATION_ID), "device-sync", async () => {
    const snapshot = await fetchSnapshot();
    await reconcile(snapshot);
  });
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
    // device-sync only reconciles the rows it OWNS. Rows owned by an enforcer
    // (lights, thermostat, speakers) are skipped , writing their state here would
    // fight the enforcer (double-drive). Ownership is data now; see ownerOf.
    if (ownerOf(device) !== DeviceOwner.DeviceSync) continue;

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
    // Never sweep a row device-sync doesn't own: desired is sticky truth for the
    // enforcer-owned rows (lights, thermostat, speakers), so clearing it here
    // would wipe the enforcer's intent. Same ownership check as reconcile().
    if (ownerOf(device) !== DeviceOwner.DeviceSync) continue;

    await db
      .update(deviceState)
      .set({ desiredUntilUtc: null, desiredState: null, desiredAtUtc: null })
      .where(eq(deviceState.id, device.id));
  }
}
