/**
 * Frontend log ingest (spec 2026-07-18-frontend-log-shipping-design). Devices
 * ship their on-device frontend logs (IndexedDB + native JSONL mirror) here so
 * they land in the `frontend_log` Postgres table and become queryable from a
 * desk via SQL. The frontend tracks a cursor and pushes everything after it, so
 * a batch can contain rows the backend already has (offline backfill, cursor
 * loss after storage eviction). Ingest is idempotent by construction: the
 * composite PK is (device_id, entry_id) and we `on conflict do nothing`, so
 * resends never double-insert and never error.
 *
 * The only entry we drop is a pathological one: `data` whose serialized form
 * exceeds MAX_DATA_BYTES. The capture side already size-caps `data` (the
 * `truncated` flag), so this is a backstop mirroring the structured-logging
 * invariant, not the normal path. A dropped entry is counted as `rejected`, it
 * never fails the batch — the frontend advances its cursor on any 2xx and we
 * must not wedge shipping behind one bad row.
 */
import { getLogger } from "@www/logger";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { z } from "zod";

import * as schema from "../db/schema";

/** Max serialized size of a single entry's `data` payload; larger entries are dropped. */
export const MAX_DATA_BYTES = 32 * 1024;

/** Max entries accepted in one ingest call, mirrors the frontend shipper's batch size. */
export const MAX_BATCH_SIZE = 500;

/** One shipped log entry. Mirrors the web `LogEntry` wire shape plus `build`. */
export const frontendLogEntrySchema = z.object({
  /** `${bootMs}-${seq}`, unique per device (not globally) → PK part 2. */
  id: z.string().min(1),
  /** Capture time as epoch milliseconds (web `LogEntry.ts`). */
  ts: z.number().int(),
  level: z.enum(["debug", "info", "warn", "error"]),
  source: z.string(),
  msg: z.string(),
  /** Structured payload, already truncated at capture time. Optional. */
  data: z.unknown().optional(),
  sha: z.string(),
  /**
   * App Store / TestFlight build number ("80") or "web" for browser sessions.
   * Optional on the wire (old rows and pre-boot-resolution entries lack it) and
   * defaulted to "web" so a missing value never rejects the batch, while the DB
   * column stays notNull.
   */
  build: z.string().default("web"),
  deviceName: z.string(),
});

export type FrontendLogEntry = z.infer<typeof frontendLogEntrySchema>;

export const frontendLogIngestSchema = z.object({
  deviceId: z.string().min(1),
  entries: z.array(frontendLogEntrySchema).max(MAX_BATCH_SIZE),
});

export type FrontendLogIngestInput = z.infer<typeof frontendLogIngestSchema>;

export interface FrontendLogIngestResult {
  /** Entries persisted (idempotently) — passed the size guard. */
  accepted: number;
  /** Entries dropped for exceeding MAX_DATA_BYTES; never fails the batch. */
  rejected: number;
}

/** Byte size of an entry's serialized `data`; undefined data is 0. */
function dataBytes(data: unknown): number {
  if (data === undefined) return 0;
  return Buffer.byteLength(JSON.stringify(data), "utf8");
}

/**
 * Persist a batch of shipped log entries for one device. Oversized entries are
 * dropped (counted, not fatal); everything else is inserted with
 * `on conflict do nothing` so resends and cursor resets are idempotent.
 */
export async function ingestFrontendLogs(
  db: NodePgDatabase<typeof schema>,
  input: FrontendLogIngestInput,
): Promise<FrontendLogIngestResult> {
  const log = getLogger();
  const { deviceId, entries } = input;

  const rows: (typeof schema.frontendLog.$inferInsert)[] = [];
  let rejected = 0;
  for (const e of entries) {
    if (dataBytes(e.data) > MAX_DATA_BYTES) {
      rejected++;
      continue;
    }
    rows.push({
      deviceId,
      entryId: e.id,
      ts: new Date(e.ts),
      level: e.level,
      source: e.source,
      msg: e.msg,
      data: e.data ?? null,
      sha: e.sha,
      build: e.build,
      deviceName: e.deviceName,
    });
  }

  if (rows.length > 0) {
    await db.insert(schema.frontendLog).values(rows).onConflictDoNothing();
  }

  if (rejected > 0) {
    log.warn(
      { deviceId, rejected, accepted: rows.length },
      "frontend log ingest dropped oversized entries",
    );
  }

  return { accepted: rows.length, rejected };
}
