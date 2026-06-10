/**
 * Portal data-hygiene purge (www-q002.18). Deletes short-lived portal rows that
 * have served their purpose so the tables don't grow unbounded. Run as a DAILY
 * bosun cronJob (one-shot Swarm job), NEVER a worker loop (PRD Backend rule 7).
 *
 * Retention policy:
 *  - portal_code: delete once consumed OR past expiry, a code is single-use and
 *    only valid for 10 minutes, so neither state is ever needed again.
 *  - portal_attempt: delete once the row is older than the lockout window, the
 *    counter has lapsed, so the device is no longer rate-limited by it.
 *  - portal_authorization: KEEP until 90 days past expiry, because a lapsed row
 *    is what drives the SessionExpired screen for a returning device; only purge
 *    well after it stops being useful.
 *
 * The delete predicates are built from an injected clock so the cutoffs are
 * deterministic and testable; counts are returned (and logged by the caller).
 */
import { eq, lt, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";

/** Authorizations are retained 90 days past expiry (then purged). */
export const AUTHORIZATION_GRACE_MS = 90 * 24 * 60 * 60 * 1000;
/**
 * Attempt rows are retained one day, comfortably past the 10-minute lockout
 * window, so a row is only ever deleted long after it stopped rate-limiting.
 */
export const ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface PurgeCounts {
  codes: number;
  attempts: number;
  authorizations: number;
}

/** The retention cutoffs for `now`. SQL clauses + row predicates share these. */
function purgeCutoffs(now: Date): { attemptCutoff: Date; authCutoff: Date } {
  return {
    attemptCutoff: new Date(now.getTime() - ATTEMPT_RETENTION_MS),
    authCutoff: new Date(now.getTime() - AUTHORIZATION_GRACE_MS),
  };
}

// Pure per-row predicates, the single source of truth for "does this row get
// purged at `now`". The SQL WHERE clauses in purgePortalData() mirror these 1:1;
// the boundary tests assert them directly so a flipped comparator fails a test.

/** A code is dead weight once consumed OR past its expiry. */
export function codeShouldPurge(
  row: { consumed: boolean; expiresAtUtc: Date },
  now: Date,
): boolean {
  return row.consumed || row.expiresAtUtc.getTime() < now.getTime();
}

/** An attempt row is purgeable once its window started before the retention cutoff. */
export function attemptShouldPurge(row: { windowStartedAtUtc: Date }, now: Date): boolean {
  return row.windowStartedAtUtc.getTime() < purgeCutoffs(now).attemptCutoff.getTime();
}

/** An authorization is purgeable once it expired more than the grace window ago. */
export function authorizationShouldPurge(row: { expiresAtUtc: Date }, now: Date): boolean {
  return row.expiresAtUtc.getTime() < purgeCutoffs(now).authCutoff.getTime();
}

/** Postgres' node driver returns rowCount; treat null/undefined as 0. */
function rows(res: { rowCount?: number | null }): number {
  return res.rowCount ?? 0;
}

/**
 * Run one purge pass. Pure of any scheduling, the bosun cronJob invokes the
 * `purge` entrypoint which calls this once and exits.
 */
export async function purgePortalData(
  db: NodePgDatabase<typeof schema>,
  now: Date = new Date(),
): Promise<PurgeCounts> {
  const { attemptCutoff, authCutoff } = purgeCutoffs(now);

  // Codes: consumed OR expired (either makes the row dead weight).
  const codeRes = await db
    .delete(schema.portalCode)
    .where(or(eq(schema.portalCode.consumed, true), lt(schema.portalCode.expiresAtUtc, now)));

  // Attempts: window started before the retention cutoff. The 1-day retention is
  // far longer than the 10-minute lockout window, so any row this old can no
  // longer be locking a device out, it's safe dead weight.
  const attemptRes = await db
    .delete(schema.portalAttempt)
    .where(lt(schema.portalAttempt.windowStartedAtUtc, attemptCutoff));

  // Authorizations: expired more than 90 days ago.
  const authRes = await db
    .delete(schema.portalAuthorization)
    .where(lt(schema.portalAuthorization.expiresAtUtc, authCutoff));

  return {
    codes: rows(codeRes),
    attempts: rows(attemptRes),
    authorizations: rows(authRes),
  };
}
