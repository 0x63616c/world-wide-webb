/**
 * Interaction sessions , a visit to the wall panel, reconstructed.
 *
 * DERIVED, NOT STORED. There is deliberately no `interaction_session` table:
 * the `session/start` and `session/end` entries the panel already ships carry
 * every attribute a session has (reason, event count, duration), and the log
 * shipper is idempotent and backfills offline windows. A second write path for
 * session rows would be a copy that can drift from, and lose rows relative to,
 * the log it copies. An aggregate cannot drift.
 *
 * The cost is that a session is a GROUP BY rather than a row, which is why the
 * ui-channel entries carry `interactionSessionId` in their JSONB payload and
 * the frontend_log ts index does the heavy lifting. At panel scale (one device,
 * tens of visits a day, 30-day log retention) that cost is noise.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { frontendLog, wakePhoto } from "../db/schema";

export interface InteractionSessionSummary {
  id: string;
  startedAt: number;
  /** Null while the visit is still in progress (no session/end shipped yet). */
  endedAt: number | null;
  durationMs: number | null;
  eventCount: number;
  endReason: string | null;
  deviceName: string;
  /** Burst frame paths, chronological. Empty when the burst failed or dimming is off. */
  photoPaths: string[];
  /**
   * A short summary of the notable things touched this visit ("Climate · Desk
   * lamp · Settings", capped with "+N more"), so a list row says what happened
   * without opening the transcript. Null when nothing notable was done.
   */
  digest: string | null;
}

export interface InteractionSessionEvent {
  ts: number;
  idx: number;
  msg: string;
  data: unknown;
}

export interface InteractionSessionDetail extends InteractionSessionSummary {
  events: InteractionSessionEvent[];
}

const DEFAULT_LIMIT = 50;

/** Max distinct subjects named before the digest collapses to "+N more". */
const DIGEST_CAP = 3;

function digestRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

/** Sentence-case a machine token (`sound_system` → "Sound system"). */
function prettyToken(raw: string): string {
  const spaced = raw
    .replace(/^tile_/, "")
    .replace(/[._-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!spaced) return "";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** A control id reads reversed: `control.lamp.desk` → "Desk lamp". */
function controlSubject(target: string): string {
  const segments = target
    .replace(/^control\./, "")
    .split(".")
    .filter(Boolean);
  if (segments.length === 0) return "Control";
  const phrase = segments.reverse().join(" ");
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/**
 * The digest subject for one event, or null when the event is not notable.
 * Notable = a tile the person opened, a control they moved, or a setting they
 * changed; brackets (start/end/wake), pans, and modal opens are noise here.
 */
function digestSubject(msg: string, data: unknown): string | null {
  const rec = digestRecord(data);
  const target = typeof rec.target === "string" ? rec.target : "";
  const [surface, action] = msg.split("/");
  if (surface === "tile" && action === "tap") {
    return (typeof rec.label === "string" && rec.label) || prettyToken(target) || null;
  }
  if (surface === "control" && (action === "change" || action === "commit")) {
    return controlSubject(target);
  }
  if (surface === "settings" && (action === "change" || action === "commit")) {
    return "Settings";
  }
  return null;
}

/**
 * Fold a session's events into a compact digest of what was touched, in first-
 * seen order, deduped, capped with a "+N more" tail. Null when nothing notable
 * happened (a glance that opened no tile and changed nothing).
 */
export function computeDigest(events: InteractionSessionEvent[]): string | null {
  const subjects: string[] = [];
  for (const e of events) {
    const subject = digestSubject(e.msg, e.data);
    if (subject && !subjects.includes(subject)) subjects.push(subject);
  }
  if (subjects.length === 0) return null;
  const head = subjects.slice(0, DIGEST_CAP).join(" · ");
  const rest = subjects.length - DIGEST_CAP;
  return rest > 0 ? `${head} · +${rest} more` : head;
}

/** The ui-channel rows for one session, in transcript order. */
async function eventsFor(
  db: NodePgDatabase<typeof schema>,
  id: string,
): Promise<InteractionSessionEvent[]> {
  const rows = await db
    .select({ ts: frontendLog.ts, msg: frontendLog.msg, data: frontendLog.data })
    .from(frontendLog)
    .where(
      and(eq(frontendLog.source, "ui"), sql`${frontendLog.data}->>'interactionSessionId' = ${id}`),
    )
    .orderBy(asc(frontendLog.ts));

  return rows.map((r) => ({
    ts: r.ts.getTime(),
    idx: Number((r.data as { idx?: number } | null)?.idx ?? 0),
    msg: r.msg,
    data: r.data,
  }));
}

/** Burst frame paths for one session, chronological. */
async function photosFor(db: NodePgDatabase<typeof schema>, id: string): Promise<string[]> {
  const rows = await db
    .select({ path: wakePhoto.path })
    .from(wakePhoto)
    .where(eq(wakePhoto.interactionSessionId, id))
    .orderBy(asc(wakePhoto.capturedAt));
  return rows.map((r) => r.path);
}

/**
 * Fold a session's ordered events + photos into its summary. Exported for
 * direct tests , this is where ALL the derivation logic lives (end detection,
 * live-session nulls, count fallback); the SQL around it is a thin fetch.
 */
export function summarise(
  id: string,
  events: InteractionSessionEvent[],
  deviceName: string,
  photoPaths: string[],
): InteractionSessionSummary {
  const end = events.find((e) => e.msg === "session/end");
  const endData = end?.data as
    | { reason?: string; events?: number; durationMs?: number }
    | undefined;
  return {
    id,
    startedAt: events[0]?.ts ?? 0,
    endedAt: end?.ts ?? null,
    durationMs: endData?.durationMs ?? null,
    // Prefer the count the panel itself recorded; fall back to what shipped, so
    // a live (unended) session still reports a truthful number.
    eventCount:
      endData?.events ??
      events.filter((e) => e.msg !== "session/start" && e.msg !== "session/end").length,
    endReason: endData?.reason ?? null,
    deviceName,
    photoPaths,
    digest: computeDigest(events),
  };
}

export async function listInteractionSessions(
  db: NodePgDatabase<typeof schema>,
  opts: { limit?: number } = {},
): Promise<InteractionSessionSummary[]> {
  const limit = opts.limit ?? DEFAULT_LIMIT;

  // One row per session: its id, start and device, newest visit first.
  const groups = await db
    .select({
      id: sql<string>`${frontendLog.data}->>'interactionSessionId'`.as("id"),
      startedAt: sql<Date>`min(${frontendLog.ts})`.as("started_at"),
      deviceName: sql<string>`max(${frontendLog.deviceName})`.as("device_name"),
    })
    .from(frontendLog)
    .where(
      and(
        eq(frontendLog.source, "ui"),
        sql`${frontendLog.data}->>'interactionSessionId' is not null`,
      ),
    )
    .groupBy(sql`${frontendLog.data}->>'interactionSessionId'`)
    .orderBy(desc(sql`min(${frontendLog.ts})`))
    .limit(limit);

  // Deliberate N+1 (two indexed lookups per session): at panel scale (one
  // device, tens of visits, limit 50) that is ~100 hits on
  // frontend_log_ui_session_idx / wake_photo_session_idx per list call, which
  // is cheaper to own than a three-way JSONB join is to read. Revisit only if
  // a fleet of devices ever makes this list hot.
  const summaries: InteractionSessionSummary[] = [];
  for (const g of groups) {
    const events = await eventsFor(db, g.id);
    summaries.push(summarise(g.id, events, g.deviceName, await photosFor(db, g.id)));
  }
  return summaries;
}

export async function getInteractionSession(
  db: NodePgDatabase<typeof schema>,
  id: string,
): Promise<InteractionSessionDetail | null> {
  const events = await eventsFor(db, id);
  if (events.length === 0) return null;

  const [row] = await db
    .select({ deviceName: frontendLog.deviceName })
    .from(frontendLog)
    .where(
      and(eq(frontendLog.source, "ui"), sql`${frontendLog.data}->>'interactionSessionId' = ${id}`),
    )
    .limit(1);

  return {
    ...summarise(id, events, row?.deviceName ?? "unknown", await photosFor(db, id)),
    events,
  };
}
