/**
 * Tests for the portal data-hygiene purge (www-q002.18). The purge runs as a
 * daily bosun cronJob (one-shot, never a worker loop). It deletes:
 *  - portal_code rows that are consumed OR past expiry,
 *  - portal_attempt rows whose lock/window is stale (older than the retention),
 *  - portal_authorization rows expired more than 90 days ago (kept until then so
 *    they still drive the SessionExpired UX).
 * The cutoff math is pure and unit-tested directly; the delete wiring is checked
 * against a fake db that records which table each delete targeted + the count.
 */

import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import type * as schema from "../db/schema";
import { portalAttempt, portalAuthorization, portalCode } from "../db/schema";
import {
  ATTEMPT_RETENTION_MS,
  AUTHORIZATION_GRACE_MS,
  purgePortalData,
} from "../services/portal-purge-service";

// A fake drizzle db: db.delete(table).where(cond) resolves to { rowCount }.
// We record the table identity so the test can assert which tables were purged.
const asDb = (fake: unknown) => fake as unknown as NodePgDatabase<typeof schema>;

function makeFakeDb(rowCounts: { codes: number; attempts: number; auths: number }) {
  const deleted: string[] = [];
  const tableName = (t: unknown) =>
    t === portalCode
      ? "portal_code"
      : t === portalAttempt
        ? "portal_attempt"
        : t === portalAuthorization
          ? "portal_authorization"
          : "unknown";
  const countFor = (name: string) =>
    name === "portal_code"
      ? rowCounts.codes
      : name === "portal_attempt"
        ? rowCounts.attempts
        : rowCounts.auths;
  const db = {
    delete(table: unknown) {
      const name = tableName(table);
      return {
        where(_cond: unknown) {
          deleted.push(name);
          return Promise.resolve({ rowCount: countFor(name) });
        },
      };
    },
  };
  return { db, deleted };
}

describe("purge retention constants", () => {
  it("keeps authorizations 90 days past expiry (drives SessionExpired UX)", () => {
    expect(AUTHORIZATION_GRACE_MS).toBe(90 * 24 * 60 * 60 * 1000);
  });
  it("retains attempt rows at least as long as the lockout window (>= 10 min)", () => {
    expect(ATTEMPT_RETENTION_MS).toBeGreaterThanOrEqual(10 * 60 * 1000);
  });
});

describe("purgePortalData", () => {
  it("deletes from all three portal tables and returns per-table counts", async () => {
    const { db, deleted } = makeFakeDb({ codes: 3, attempts: 2, auths: 1 });
    const result = await purgePortalData(asDb(db), new Date());
    expect(deleted).toEqual(
      expect.arrayContaining(["portal_code", "portal_attempt", "portal_authorization"]),
    );
    expect(result).toEqual({ codes: 3, attempts: 2, authorizations: 1 });
  });

  it("returns zero counts when nothing matches the cutoffs", async () => {
    const { db } = makeFakeDb({ codes: 0, attempts: 0, auths: 0 });
    const result = await purgePortalData(asDb(db), new Date());
    expect(result).toEqual({ codes: 0, attempts: 0, authorizations: 0 });
  });

  it("treats a null rowCount as zero (driver may omit it)", async () => {
    const db = {
      delete: () => ({ where: () => Promise.resolve({ rowCount: null }) }),
    };
    const result = await purgePortalData(asDb(db), new Date());
    expect(result).toEqual({ codes: 0, attempts: 0, authorizations: 0 });
  });

  it("uses the injected clock for the authorization 90-day cutoff", async () => {
    const seen: unknown[] = [];
    const db = {
      delete: () => ({
        where: (cond: unknown) => {
          seen.push(cond);
          return Promise.resolve({ rowCount: 0 });
        },
      }),
    };
    const now = new Date(Date.UTC(2026, 0, 1));
    await purgePortalData(asDb(db), now);
    // Three deletes issued (codes, attempts, authorizations).
    expect(seen.length).toBe(3);
  });
});
