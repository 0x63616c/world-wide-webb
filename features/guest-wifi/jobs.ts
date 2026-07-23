/**
 * Portal data-hygiene purge (www-q002.18, password-only since www-p9hx). Deletes
 * portal rows that have served their purpose so the table doesn't grow unbounded.
 * Run as a DAILY CronJob (one-shot job), NEVER a worker loop (PRD Backend rule 7).
 *
 * Retention policy:
 *  - portal_authorization: KEEP until 90 days past expiry, because a lapsed row
 *    is what drives the SessionExpired screen for a returning device; only purge
 *    well after it stops being useful.
 *
 * The portal_rate_limit singleton is self-resetting (one row, scoped to a UTC
 * day) so it needs no purge. portal_code / portal_guest / portal_attempt were
 * removed when the portal went password-only (www-p9hx).
 *
 * The delete predicate is built from an injected clock so the cutoff is
 * deterministic and testable; the count is returned (and logged by the caller).
 */
import { defineCron } from "@app-kit";
import { lt } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db } from "./db";
import * as schema from "./schema";

/** Authorizations are retained 90 days past expiry (then purged). */
export const AUTHORIZATION_GRACE_MS = 90 * 24 * 60 * 60 * 1000;

export interface PurgeCounts {
  authorizations: number;
}

/** The authorization retention cutoff for `now`. */
function authCutoff(now: Date): Date {
  return new Date(now.getTime() - AUTHORIZATION_GRACE_MS);
}

/** An authorization is purgeable once it expired more than the grace window ago. */
export function authorizationShouldPurge(row: { expiresAtUtc: Date }, now: Date): boolean {
  return row.expiresAtUtc.getTime() < authCutoff(now).getTime();
}

/** Postgres' node driver returns rowCount; treat null/undefined as 0. */
function rows(res: { rowCount?: number | null }): number {
  return res.rowCount ?? 0;
}

/**
 * Run one purge pass. Pure of any scheduling, the CronJob invokes the
 * `purge` entrypoint which calls this once and exits.
 */
export async function purgePortalData(
  db: NodePgDatabase<typeof schema>,
  now: Date = new Date(),
): Promise<PurgeCounts> {
  // Authorizations: expired more than 90 days ago.
  const authRes = await db
    .delete(schema.portalAuthorization)
    .where(lt(schema.portalAuthorization.expiresAtUtc, authCutoff(now)));

  return { authorizations: rows(authRes) };
}

/**
 * The scheduled purge as a branded {@link defineCron} facet (Track C, C7). The
 * codegen collects every exported `defineCron` into `features/_generated/crons.gen.ts`.
 *
 * NOTE: the ACTUAL scheduling still lives in `infra/src/crons.ts` as the
 * `portal-data-purge` k8s CronJob that runs the api image's bundled `purge.js`
 * (which calls {@link purgePortalData} directly with the api's own db). This
 * facet is forward scaffolding for a future codegen-driven scheduler; it has no
 * runtime consumer yet, so the infra CronJob is deliberately left unchanged.
 *
 * @public collected by the codegen (dynamic import in scripts/apps-gen/collect.ts,
 * an edge knip can't see) into features/_generated/crons.gen.ts; no static import.
 */
export const purgeCron = defineCron({
  name: "portal-data-purge",
  schedule: "0 2 * * *",
  run: async () => {
    await purgePortalData(db);
  },
});
