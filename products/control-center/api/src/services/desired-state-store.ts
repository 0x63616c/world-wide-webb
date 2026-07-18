/**
 * The desired-state store: the single write path onto the `device_state` table's
 * DESIRED columns (the "sticky desired + short command window" pattern, www-unxz).
 *
 * Every control mutation writes intent here and returns WITHOUT actuating; an
 * enforcer cycle reconciles desired→device. This module owns the three things
 * every such write shares, so no caller re-derives them:
 *   - the command-window stamp (`desiredUntilUtc`, via command-window.ts) that
 *     tells the enforcer to push a freshly-set desired regardless of control
 *     policy until it converges or the window lapses;
 *   - `desiredAtUtc` = now;
 *   - ONE failure policy: THROW. A desired write is the mutation's only effect
 *     (the enforcer actuates later), so a swallowed error is fabricated success.
 *     Callers that must degrade gracefully (e.g. a worker cycle continuing past
 *     one bad target) catch around the call site; the store never swallows.
 *
 * Two shapes, because the callers genuinely differ:
 *   - `upsertDesired` keys on `entityId` and creates the row if the enforcer has
 *     not seeded it yet (lamps/lights/speakers/schedule fades).
 *   - `updateDesired` keys on `id` and updates an existing row in place (the
 *     climate singleton, which the enforcer always seeds first). Existence is the
 *     caller's concern: it reads the row to derive the merged desired anyway, so a
 *     missing-row update is a silent no-op here, not an error.
 */

import { eq } from "drizzle-orm";

import { db } from "../db/index";
import type { DeviceStateValue } from "../db/schema";
import { deviceState } from "../db/schema";
import { stampCommandWindow } from "./command-window";
import type { DeviceKind } from "./device-state-mapping";

/** An upsert of a device's desired state, keyed on `entityId` (created if absent). */
export interface UpsertDesired {
  id: string;
  kind: DeviceKind;
  entityId: string;
  domain: string;
  label: string;
  desired: DeviceStateValue;
  /** Command-window length in ms; defaults to the shared COMMAND_WINDOW_MS. */
  windowMs?: number;
}

/** An in-place update of an existing device's desired state, keyed on `id`. */
export interface UpdateDesired {
  id: string;
  desired: DeviceStateValue;
  /** Command-window length in ms; defaults to the shared COMMAND_WINDOW_MS. */
  windowMs?: number;
}

/** The end of the command window: `now` + windowMs (default COMMAND_WINDOW_MS). */
function windowEnd(now: Date, windowMs: number | undefined): Date {
  return windowMs === undefined ? stampCommandWindow(now) : new Date(now.getTime() + windowMs);
}

/**
 * Upsert desired state for a device keyed on `entityId`. Inserts a full row
 * (available:true) on first sight, otherwise overwrites only the desired columns
 * (+ command window), leaving reported/availability to the enforcer. Throws on any
 * DB failure , the write is the caller's only effect.
 */
export async function upsertDesired(input: UpsertDesired): Promise<void> {
  const now = new Date();
  const desiredUntilUtc = windowEnd(now, input.windowMs);
  await db
    .insert(deviceState)
    .values({
      id: input.id,
      kind: input.kind,
      entityId: input.entityId,
      domain: input.domain,
      label: input.label,
      desiredState: input.desired,
      desiredAtUtc: now,
      desiredUntilUtc,
      available: true,
    })
    .onConflictDoUpdate({
      target: deviceState.entityId,
      set: { desiredState: input.desired, desiredAtUtc: now, desiredUntilUtc },
    });
}

/**
 * Update the desired state (+ command window) of an existing row keyed on `id`.
 * Existence is the caller's responsibility (it reads the row to merge the desired
 * first); a missing row is a no-op, not an error. Throws on any DB failure.
 */
export async function updateDesired(input: UpdateDesired): Promise<void> {
  const now = new Date();
  const desiredUntilUtc = windowEnd(now, input.windowMs);
  await db
    .update(deviceState)
    .set({ desiredState: input.desired, desiredAtUtc: now, desiredUntilUtc })
    .where(eq(deviceState.id, input.id));
}
