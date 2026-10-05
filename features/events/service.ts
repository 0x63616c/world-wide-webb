import { createHash } from "node:crypto";
import { genId } from "@www/platform";
import { and, asc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { alarmDefaults } from "./config";
import { type AlarmInput, alarmInputSchema } from "./contract";
import { db } from "./db";
import { dueAlarmPlan, nextAlarmAt, RING_TIMEOUT_MS } from "./schedule";
import { alarmRings, alarms } from "./schema";

export class AlarmError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

type Defaults = ReturnType<typeof alarmDefaults>;
type Database = typeof db;

/** Postgres is the arbiter: no in-process timers, locks, or last-fired memory. */
export function createAlarmService(database: Database, defaults: () => Defaults = alarmDefaults) {
  return {
    async create(raw: AlarmInput, requestKey?: string, now = new Date()) {
      const definition = alarmInputSchema.parse(raw);
      const requestHash = createHash("sha256").update(JSON.stringify(definition)).digest("hex");
      // Do the idempotency lookup before validating the date: a successful retry
      // after its alarm has fired still returns the original resource.
      const existing = async () => {
        const [row] = await database
          .select()
          .from(alarms)
          .where(eq(alarms.requestKey, requestKey ?? ""))
          .limit(1);
        if (row && row.requestHash !== requestHash)
          throw new AlarmError(409, "Idempotency key was used with different alarm details");
        return row;
      };
      if (requestKey) {
        const row = await existing();
        if (row) return { id: row.id, nextFireAt: row.nextFireAt?.toISOString() ?? null };
      }
      const nextFireAt = nextAlarmAt(definition, now);
      if (!nextFireAt) throw new AlarmError(400, "Choose a future alarm time");
      const [created] = await database
        .insert(alarms)
        .values({
          id: genId("alm"),
          definition,
          nextFireAt,
          requestKey,
          requestHash,
        })
        .onConflictDoNothing({ target: alarms.requestKey })
        .returning();
      const row = created ?? (await existing());
      if (!row) throw new Error("Alarm insert did not return a row");
      return { id: row.id, nextFireAt: row.nextFireAt?.toISOString() ?? null };
    },

    async update(id: string, definition: AlarmInput, now = new Date()) {
      const parsed = alarmInputSchema.parse(definition);
      return database.transaction(async (tx) => {
        const [row] = await tx.select().from(alarms).where(eq(alarms.id, id)).for("update");
        if (!row) throw new AlarmError(404, "Alarm not found");
        const nextFireAt = row.enabled ? nextAlarmAt(parsed, now) : null;
        if (row.enabled && !nextFireAt) throw new AlarmError(400, "Choose a future alarm time");
        await tx.update(alarms).set({ definition: parsed, nextFireAt }).where(eq(alarms.id, id));
        await tx
          .update(alarmRings)
          .set({ status: "stopped", version: sql`${alarmRings.version} + 1` })
          .where(
            and(eq(alarmRings.alarmId, id), inArray(alarmRings.status, ["ringing", "snoozed"])),
          );
        return { id };
      });
    },

    async setEnabled(id: string, enabled: boolean, now = new Date()) {
      return database.transaction(async (tx) => {
        const [row] = await tx.select().from(alarms).where(eq(alarms.id, id)).for("update");
        if (!row) throw new AlarmError(404, "Alarm not found");
        // Duplicate enable requests must not advance a just-due alarm.
        if (row.enabled === enabled) return { id };
        const nextFireAt = enabled ? nextAlarmAt(row.definition, now) : null;
        if (enabled && !nextFireAt)
          throw new AlarmError(400, "Edit the date before enabling this alarm");
        await tx.update(alarms).set({ enabled, nextFireAt }).where(eq(alarms.id, id));
        if (!enabled)
          await tx
            .update(alarmRings)
            .set({ status: "stopped", version: sql`${alarmRings.version} + 1` })
            .where(
              and(eq(alarmRings.alarmId, id), inArray(alarmRings.status, ["ringing", "snoozed"])),
            );
        return { id };
      });
    },

    async remove(id: string) {
      const rows = await database
        .delete(alarms)
        .where(eq(alarms.id, id))
        .returning({ id: alarms.id });
      if (!rows.length) throw new AlarmError(404, "Alarm not found");
      return { id };
    },

    async snapshot(now = new Date()) {
      return database.transaction(
        async (tx) => {
          const definitions = await tx.select().from(alarms).orderBy(asc(alarms.createdAt));
          const rings = await tx
            .select()
            .from(alarmRings)
            .where(
              and(
                inArray(alarmRings.status, ["ringing", "snoozed"]),
                gt(alarmRings.expiresAt, now),
              ),
            )
            .orderBy(asc(alarmRings.ringAt));
          const next =
            [
              ...definitions
                .filter((a) => a.enabled && a.nextFireAt)
                .map((a) => ({
                  id: a.id,
                  label: a.definition.label,
                  at: a.nextFireAt?.toISOString() ?? "",
                  timeZone: a.definition.timeZone,
                })),
              ...rings
                .filter((r) => r.status === "snoozed")
                .map((r) => ({
                  id: r.id,
                  label: r.label,
                  at: r.ringAt.toISOString(),
                  timeZone:
                    definitions.find((a) => a.id === r.alarmId)?.definition.timeZone ?? "UTC",
                })),
            ]
              .sort((a, b) => a.at.localeCompare(b.at))
              .at(0) ?? null;
          return {
            alarms: definitions.map((a) => ({
              id: a.id,
              ...a.definition,
              enabled: a.enabled,
              nextFireAt: a.nextFireAt?.toISOString() ?? null,
            })),
            active: rings.map((r) => ({
              id: r.id,
              alarmId: r.alarmId,
              label: r.label,
              status: r.status,
              version: r.version,
              ringAt: r.ringAt.toISOString(),
              expiresAt: r.expiresAt.toISOString(),
              snoozeMinutes: r.snoozeMinutes,
              lightsPending: !r.lightsDeliveredAt,
            })),
            next,
            defaults: defaults(),
            serverNow: now.toISOString(),
          };
        },
        { isolationLevel: "repeatable read", accessMode: "read only" },
      );
    },

    async act(id: string, version: number, action: "stop" | "snooze", now = new Date()) {
      const rows = await database
        .update(alarmRings)
        .set(
          action === "stop"
            ? {
                status: "stopped",
                version: sql`${alarmRings.version} + 1`,
              }
            : {
                status: "snoozed",
                version: sql`${alarmRings.version} + 1`,
                ringAt: sql`${now.toISOString()}::timestamptz + ${alarmRings.snoozeMinutes} * interval '1 minute'`,
                expiresAt: sql`${now.toISOString()}::timestamptz + ${alarmRings.snoozeMinutes} * interval '1 minute' + interval '30 minutes'`,
              },
        )
        .where(
          and(
            eq(alarmRings.id, id),
            eq(alarmRings.version, version),
            gt(alarmRings.expiresAt, now),
            inArray(alarmRings.status, action === "stop" ? ["ringing", "snoozed"] : ["ringing"]),
          ),
        )
        .returning({ id: alarmRings.id });
      if (!rows.length) throw new AlarmError(409, "This alarm has changed. Refresh and try again.");
      return { id };
    },

    async claimDue(now = new Date()) {
      const config = defaults();
      return database.transaction(async (tx) => {
        const due = await tx
          .select()
          .from(alarms)
          .where(and(eq(alarms.enabled, true), lte(alarms.nextFireAt, now)))
          .orderBy(asc(alarms.nextFireAt))
          .limit(100)
          .for("update", { skipLocked: true });
        let fired = 0;
        for (const alarm of due) {
          if (!alarm.nextFireAt) continue;
          const plan = dueAlarmPlan({ ...alarm.definition, nextFireAt: alarm.nextFireAt }, now);
          const inserted = await tx
            .insert(alarmRings)
            .values({
              id: genId("alr"),
              alarmId: alarm.id,
              scheduledAt: plan.scheduledAt,
              label: alarm.definition.label,
              status: plan.ring ? "ringing" : "missed",
              ringAt: now,
              expiresAt: new Date(now.getTime() + RING_TIMEOUT_MS),
              snoozeMinutes: alarm.definition.snoozeMinutes ?? config.snoozeMinutes,
              lightTarget: alarm.definition.lightTarget ?? config.lightTarget,
              lightsRetryAt: now,
            })
            .onConflictDoNothing()
            .returning({ id: alarmRings.id });
          if (plan.ring) fired += inserted.length;
          await tx
            .update(alarms)
            .set({ nextFireAt: plan.nextFireAt, enabled: plan.nextFireAt !== null })
            .where(eq(alarms.id, alarm.id));
        }
        // Snoozes survive process restarts, and become a new version of the SAME occurrence.
        await tx
          .update(alarmRings)
          .set({ status: "stopped", version: sql`${alarmRings.version} + 1` })
          .where(
            and(inArray(alarmRings.status, ["ringing", "snoozed"]), lte(alarmRings.expiresAt, now)),
          );
        const snoozes = await tx
          .update(alarmRings)
          .set({ status: "ringing", version: sql`${alarmRings.version} + 1` })
          .where(
            and(
              eq(alarmRings.status, "snoozed"),
              lte(alarmRings.ringAt, now),
              gt(alarmRings.expiresAt, now),
            ),
          )
          .returning({ id: alarmRings.id });
        return fired + snoozes.length;
      });
    },

    /** A row lock serializes delivery across workers. HA turn_on is idempotent:
     * after a crash between HA success and commit it may be retried. The ring
     * occurrence is still exactly once. Stop/delete wait for in-flight delivery. */
    async deliverLights(
      deliver: (target: string) => Promise<void>,
      onFailure: (id: string, error: unknown) => void,
      now = new Date(),
    ) {
      await database.transaction(async (tx) => {
        const pending = await tx
          .select()
          .from(alarmRings)
          .where(
            and(
              inArray(alarmRings.status, ["ringing", "snoozed"]),
              isNull(alarmRings.lightsDeliveredAt),
              lte(alarmRings.lightsRetryAt, now),
              gt(alarmRings.expiresAt, now),
            ),
          )
          .limit(10)
          .for("update", { skipLocked: true });
        for (const ring of pending) {
          try {
            await deliver(ring.lightTarget);
            await tx
              .update(alarmRings)
              .set({ lightsDeliveredAt: now })
              .where(eq(alarmRings.id, ring.id));
          } catch (error) {
            onFailure(ring.id, error);
            const delay = Math.min(60_000, 1000 * 2 ** Math.min(ring.lightsAttempts, 6));
            await tx
              .update(alarmRings)
              .set({
                lightsAttempts: ring.lightsAttempts + 1,
                lightsRetryAt: new Date(now.getTime() + delay),
              })
              .where(eq(alarmRings.id, ring.id));
          }
        }
      });
    },
  };
}

export const alarmService = createAlarmService(db);
