/**
 * Drizzle/Postgres adapter for PortalRepo (www-q002.9). The portal service is
 * pure logic over the PortalRepo interface; this is the one place that touches
 * SQL. Stripe-style ids (gst_/otp_/att_/auth_), UTC timestamps, idempotent
 * upserts keyed by the natural keys the DB enforces (mac for authorizations,
 * mac+kind for attempts).
 */
import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "../db/schema";
import type {
  PortalAttemptRow,
  PortalAuthorizationRow,
  PortalCodeRow,
  PortalGuestRow,
  PortalRepo,
} from "./portal-service";

type AttemptKind = "code" | "password";

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(4).toString("hex")}`;
}

export function createDrizzlePortalRepo(db: NodePgDatabase<typeof schema>): PortalRepo {
  return {
    async createGuest(name, email, now): Promise<PortalGuestRow> {
      const [row] = await db
        .insert(schema.portalGuest)
        .values({ id: newId("gst"), name, email, createdAtUtc: now })
        .returning();
      return row;
    },

    async newestGuestByEmail(email): Promise<PortalGuestRow | null> {
      const [row] = await db
        .select()
        .from(schema.portalGuest)
        .where(eq(schema.portalGuest.email, email))
        .orderBy(desc(schema.portalGuest.createdAtUtc))
        .limit(1);
      return row ?? null;
    },

    async newestUnconsumedCodeForGuest(guestId): Promise<PortalCodeRow | null> {
      const [row] = await db
        .select()
        .from(schema.portalCode)
        .where(and(eq(schema.portalCode.guestId, guestId), eq(schema.portalCode.consumed, false)))
        .orderBy(desc(schema.portalCode.createdAtUtc))
        .limit(1);
      return row ?? null;
    },

    async consumeCodesForGuest(guestId): Promise<void> {
      await db
        .update(schema.portalCode)
        .set({ consumed: true })
        .where(eq(schema.portalCode.guestId, guestId));
    },

    async createCode(guestId, code, expiresAtUtc, now): Promise<PortalCodeRow> {
      const [row] = await db
        .insert(schema.portalCode)
        .values({
          id: newId("otp"),
          guestId,
          code,
          consumed: false,
          expiresAtUtc,
          createdAtUtc: now,
        })
        .returning();
      return row;
    },

    async markCodeConsumed(codeId): Promise<void> {
      await db
        .update(schema.portalCode)
        .set({ consumed: true })
        .where(eq(schema.portalCode.id, codeId));
    },

    async getAttempt(mac, kind): Promise<PortalAttemptRow | null> {
      const [row] = await db
        .select()
        .from(schema.portalAttempt)
        .where(and(eq(schema.portalAttempt.mac, mac), eq(schema.portalAttempt.kind, kind)))
        .limit(1);
      if (!row) return null;
      return {
        mac: row.mac,
        kind: row.kind,
        wrongCount: row.wrongCount,
        lockedUntilUtc: row.lockedUntilUtc,
      };
    },

    async upsertAttempt(mac, kind, wrongCount, lockedUntilUtc): Promise<void> {
      await db
        .insert(schema.portalAttempt)
        .values({
          id: newId("att"),
          mac,
          kind,
          wrongCount,
          windowStartedAtUtc: new Date(),
          lockedUntilUtc,
        })
        .onConflictDoUpdate({
          target: [schema.portalAttempt.mac, schema.portalAttempt.kind],
          set: { wrongCount, lockedUntilUtc },
        });
    },

    async clearAttempt(mac, kind: AttemptKind): Promise<void> {
      await db
        .delete(schema.portalAttempt)
        .where(and(eq(schema.portalAttempt.mac, mac), eq(schema.portalAttempt.kind, kind)));
    },

    async findAuthorizationByMac(mac): Promise<PortalAuthorizationRow | null> {
      const [row] = await db
        .select()
        .from(schema.portalAuthorization)
        .where(eq(schema.portalAuthorization.mac, mac))
        .limit(1);
      return row ?? null;
    },

    async upsertAuthorization(
      mac,
      guestId,
      grantedAtUtc,
      expiresAtUtc,
    ): Promise<PortalAuthorizationRow> {
      const [row] = await db
        .insert(schema.portalAuthorization)
        .values({ id: newId("auth"), mac, guestId, grantedAtUtc, expiresAtUtc })
        .onConflictDoUpdate({
          target: schema.portalAuthorization.mac,
          set: { guestId, grantedAtUtc, expiresAtUtc },
        })
        .returning();
      return row;
    },
  };
}
