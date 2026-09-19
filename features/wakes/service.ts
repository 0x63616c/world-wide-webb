/**
 * Interaction sessions , a visit to the wall panel, reconstructed.
 *
 * DERIVED, NOT STORED. There is deliberately no `interaction_session` table.
 *
 * ⚠️ REDUCED BY THE SIMPLIFICATION (§2, felogs). This used to reconstruct a
 * session by grouping `frontend_log` ui-channel rows on their
 * `interactionSessionId`, which is where the transcript, the duration, the end
 * reason and the digest came from. The frontend log pipeline and the
 * `frontend_log` table are gone, so the ONLY surviving record of a visit is the
 * front-camera burst the panel uploads on undim , `wake_photo`, this feature's
 * own table.
 *
 * What that leaves is honest but thin: a session is "a burst of frames that
 * named this session id", so it has an id, a start (its first frame), a device
 * and its frames. Everything the transcript used to supply is reported as
 * `null` / empty rather than invented, per the repo's no-fake-data rule.
 * `endedAt`/`durationMs`/`endReason`/`digest` now mean "unknown", not "still
 * running", and `events` is always empty. Those fields are kept on the wire
 * only so the Activity view keeps typechecking; they should be deleted from
 * both ends once that view drops its transcript panel.
 */
import { asc, desc, isNotNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./schema";
import { wakePhoto } from "./schema";

export interface InteractionSessionSummary {
  id: string;
  startedAt: number;
  /** Always null: no end bracket survives the frontend-log removal. */
  endedAt: null;
  /** Always null: derived from the end bracket, which is gone. */
  durationMs: null;
  /** Always 0: the interaction transcript is gone. */
  eventCount: number;
  /** Always null: derived from the end bracket, which is gone. */
  endReason: null;
  deviceName: string;
  /** Burst frame paths, chronological. */
  photoPaths: string[];
  /** Always null: the digest was folded from the transcript, which is gone. */
  digest: null;
}

export interface InteractionSessionEvent {
  ts: number;
  idx: number;
  msg: string;
  data: unknown;
}

export interface InteractionSessionDetail extends InteractionSessionSummary {
  /** Always empty, see the module note. */
  events: InteractionSessionEvent[];
}

const DEFAULT_LIMIT = 50;

/** Burst frame paths for one session, chronological. */
async function photosFor(db: NodePgDatabase<typeof schema>, id: string): Promise<string[]> {
  const rows = await db
    .select({ path: wakePhoto.path })
    .from(wakePhoto)
    .where(sql`${wakePhoto.interactionSessionId} = ${id}`)
    .orderBy(asc(wakePhoto.capturedAt));
  return rows.map((r) => r.path);
}

/**
 * Fold one session's burst into its summary. Exported for direct tests , this
 * is the whole derivation now that the transcript is gone.
 */
export function summarise(
  id: string,
  startedAt: number,
  deviceName: string,
  photoPaths: string[],
): InteractionSessionSummary {
  return {
    id,
    startedAt,
    endedAt: null,
    durationMs: null,
    eventCount: 0,
    endReason: null,
    deviceName,
    photoPaths,
    digest: null,
  };
}

export async function listInteractionSessions(
  db: NodePgDatabase<typeof schema>,
  opts: { limit?: number } = {},
): Promise<InteractionSessionSummary[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT;

  // One row per session: its id, the instant of its first frame, and the device
  // that shot it. Newest visit first. Rides wake_photo_session_idx.
  const groups = await db
    .select({
      id: sql<string>`${wakePhoto.interactionSessionId}`.as("id"),
      startedAt: sql<Date>`min(${wakePhoto.capturedAt})`.as("started_at"),
      // `deviceId` is nullable for bursts backfilled before the column existed.
      deviceId: sql<string | null>`max(${wakePhoto.deviceId})`.as("device_id"),
    })
    .from(wakePhoto)
    .where(isNotNull(wakePhoto.interactionSessionId))
    .groupBy(wakePhoto.interactionSessionId)
    .orderBy(desc(sql`min(${wakePhoto.capturedAt})`))
    .limit(limit);

  const summaries: InteractionSessionSummary[] = [];
  for (const g of groups) {
    summaries.push(
      summarise(g.id, g.startedAt.getTime(), g.deviceId ?? "unknown", await photosFor(db, g.id)),
    );
  }
  return summaries;
}

export async function getInteractionSession(
  db: NodePgDatabase<typeof schema>,
  id: string,
): Promise<InteractionSessionDetail | null> {
  const rows = await db
    .select({
      path: wakePhoto.path,
      capturedAt: wakePhoto.capturedAt,
      deviceId: wakePhoto.deviceId,
    })
    .from(wakePhoto)
    .where(sql`${wakePhoto.interactionSessionId} = ${id}`)
    .orderBy(asc(wakePhoto.capturedAt));

  if (rows.length === 0) return null;

  const first = rows[0];
  return {
    ...summarise(
      id,
      first.capturedAt.getTime(),
      rows.find((r) => r.deviceId !== null)?.deviceId ?? "unknown",
      rows.map((r) => r.path),
    ),
    events: [],
  };
}
