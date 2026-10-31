import { TRPCError } from "@app-kit/server";
import { createNotification } from "@features/notifications/service";
import { genId } from "@www/platform";
import { and, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import type { z } from "zod";
import type { historyInput, startInput, stopInput, updateInput, Walk, WalkState } from "./contract";
import { db } from "./db";
import { walks } from "./schema";

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const visible = isNull(walks.deletedAt);
const active = and(visible, isNull(walks.endedAt));
const wire = (row: typeof walks.$inferSelect): Walk => ({
  id: row.id,
  startedAt: row.startedAt.toISOString(),
  endedAt: row.endedAt?.toISOString() ?? null,
  source: row.source,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export function createWalkService(database: Database) {
  // Shared transaction lock, including reads of state, gives coherent snapshots
  // across API replicas. The partial unique index independently guards inserts.
  const locked = <T>(fn: (tx: Transaction) => Promise<T>) =>
    database.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(270027)`);
      return fn(tx);
    });
  const snapshot = async (tx: Transaction): Promise<WalkState> => {
    const [row] = await tx.select().from(walks).where(active).limit(1);
    const [latest] = await tx
      .select({ at: walks.updatedAt })
      .from(walks)
      .orderBy(desc(walks.updatedAt))
      .limit(1);
    return {
      active: row ? wire(row) : null,
      updatedAt: latest?.at.toISOString() ?? new Date(0).toISOString(),
      serverTime: new Date().toISOString(),
    };
  };
  const find = async (tx: Transaction, id: string) => {
    const [row] = await tx.select().from(walks).where(eq(walks.id, id)).limit(1);
    return row;
  };
  return {
    state: () => locked(snapshot),
    async history(input: z.output<typeof historyInput>) {
      const rows = await database
        .select()
        .from(walks)
        .where(
          and(
            visible,
            isNotNull(walks.endedAt),
            input.before ? lt(walks.startedAt, new Date(input.before)) : undefined,
          ),
        )
        .orderBy(desc(walks.startedAt), desc(walks.id))
        .limit(input.limit);
      return { walks: rows.map(wire) };
    },
    start: (input: z.output<typeof startInput>) =>
      locked(async (tx) => {
        // A completed/deleted id is also consumed: retrying must never restart it.
        if (input.id && (await find(tx, input.id))) return snapshot(tx);
        const [running] = await tx.select().from(walks).where(active).limit(1);
        if (!running) {
          const now = new Date();
          const id = input.id ?? genId("walk");
          await tx.insert(walks).values({
            id,
            startedAt: input.startedAt ? new Date(input.startedAt) : now,
            source: input.source,
            createdAt: now,
            updatedAt: now,
          });
          await createNotification(
            {
              source_module: "walks",
              title: "Walk started",
              body: "Dog Walk is in progress.",
              deep_link: "module/walks",
              dedupe_key: `${id}:started`,
            },
            tx,
          );
        }
        return snapshot(tx);
      }),
    stop: (input: z.output<typeof stopInput>) =>
      locked(async (tx) => {
        const row = await find(tx, input.id);
        if (row && !row.deletedAt && !row.endedAt) {
          const now = new Date();
          await tx
            .update(walks)
            .set({
              endedAt: new Date(
                Math.max(
                  row.startedAt.getTime(),
                  input.endedAt ? Date.parse(input.endedAt) : now.getTime(),
                ),
              ),
              updatedAt: now,
            })
            .where(eq(walks.id, input.id));
          await createNotification(
            {
              source_module: "walks",
              title: "Walk stopped",
              body: "Dog Walk has finished.",
              deep_link: "module/walks",
              dedupe_key: `${row.id}:stopped`,
            },
            tx,
          );
        }
        return snapshot(tx);
      }),
    delete: (id: string) =>
      locked(async (tx) => {
        const now = new Date();
        await tx
          .update(walks)
          .set({ deletedAt: now, updatedAt: now })
          .where(and(eq(walks.id, id), visible));
        return snapshot(tx);
      }),
    update: (input: z.output<typeof updateInput>) =>
      locked(async (tx) => {
        const row = await find(tx, input.id);
        if (!row || row.deletedAt)
          throw new TRPCError({ code: "NOT_FOUND", message: "Walk not found" });
        const startedAt = input.startedAt ? new Date(input.startedAt) : row.startedAt;
        const endedAt = input.endedAt ? new Date(input.endedAt) : row.endedAt;
        if (endedAt && endedAt < startedAt)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "endedAt must be at or after startedAt",
          });
        if (input.startedAt || input.endedAt)
          await tx
            .update(walks)
            .set({ startedAt, endedAt, updatedAt: new Date() })
            .where(eq(walks.id, input.id));
        if (input.endedAt && !row.endedAt) {
          await createNotification(
            {
              source_module: "walks",
              title: "Walk stopped",
              body: "Dog Walk has finished.",
              deep_link: "module/walks",
              dedupe_key: `${row.id}:stopped`,
            },
            tx,
          );
        }
        return snapshot(tx);
      }),
  };
}
export const walkService = createWalkService(db);
