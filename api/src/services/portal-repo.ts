/**
 * Drizzle/Postgres adapter for PortalRepo (www-q002.9, password-only since
 * www-p9hx). The portal service is pure logic over the PortalRepo interface;
 * this is the one place that touches SQL. Stripe-style ids (auth_), UTC
 * timestamps, idempotent upserts keyed by the natural keys the DB enforces
 * (mac for authorizations, a constant id for the global rate-limit singleton).
 */
import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import { PORTAL_RATE_LIMIT_ID } from "../db/schema";
import type { PortalAuthorizationRow, PortalRateLimitRow, PortalRepo } from "./portal-service";

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}

export function createDrizzlePortalRepo(db: NodePgDatabase<typeof schema>): PortalRepo {
  return {
    async getRateLimit(): Promise<PortalRateLimitRow | null> {
      const [row] = await db
        .select()
        .from(schema.portalRateLimit)
        .where(eq(schema.portalRateLimit.id, PORTAL_RATE_LIMIT_ID))
        .limit(1);
      return row ?? null;
    },

    async bumpWrongAttempt(dateUtc, now): Promise<number> {
      // Atomic upsert: increment within the same UTC day, reset to 1 across a
      // day rollover. The CASE compares the STORED date to the incoming one.
      const [row] = await db
        .insert(schema.portalRateLimit)
        .values({ id: PORTAL_RATE_LIMIT_ID, dateUtc, wrongAttempts: 1, updatedAtUtc: now })
        .onConflictDoUpdate({
          target: schema.portalRateLimit.id,
          set: {
            wrongAttempts: sql`case when ${schema.portalRateLimit.dateUtc} = ${dateUtc} then ${schema.portalRateLimit.wrongAttempts} + 1 else 1 end`,
            dateUtc,
            updatedAtUtc: now,
          },
        })
        .returning();
      return row.wrongAttempts;
    },

    async findAuthorizationByMac(mac): Promise<PortalAuthorizationRow | null> {
      const [row] = await db
        .select()
        .from(schema.portalAuthorization)
        .where(eq(schema.portalAuthorization.mac, mac))
        .limit(1);
      return row ?? null;
    },

    async upsertAuthorization(mac, grantedAtUtc, expiresAtUtc): Promise<PortalAuthorizationRow> {
      const [row] = await db
        .insert(schema.portalAuthorization)
        .values({ id: newId("auth"), mac, grantedAtUtc, expiresAtUtc })
        .onConflictDoUpdate({
          target: schema.portalAuthorization.mac,
          set: { grantedAtUtc, expiresAtUtc },
        })
        .returning();
      return row;
    },
  };
}
