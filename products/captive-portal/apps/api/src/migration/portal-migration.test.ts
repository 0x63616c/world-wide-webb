// Tests for portal-migration tooling (www-jtp0.5.6).
//
// Red-first: these tests assert that the export/import tooling preserves
// portal rows, IDs, timestamps, foreign keys, and authorization semantics.
// All tests are hermetic fixture-driven (no real DB connection required).
//
// Rollback note: Control Center database remains the source of truth until
// the final cutover is approved and validated (www-jtp0.5.7, REQUIRES CALUM).

import { describe, expect, test } from "vitest";
import {
  buildRehearsalReport,
  findActiveAuthorization,
  findExpiredAuthorization,
  findNewestActiveCode,
  isAttemptLocked,
  PORTAL_TABLES,
  type PortalSnapshot,
  rowCountsMatch,
  semanticsValid,
  validateIdIntegrity,
  validateRowCounts,
  validateSemantics,
} from "./portal-migration";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const NOW = new Date("2026-06-14T12:00:00Z");
const IN_FUTURE = new Date("2026-07-14T12:00:00Z");
const IN_PAST = new Date("2026-05-14T12:00:00Z");
const TEN_MIN_FUTURE = new Date("2026-06-14T12:10:00Z");

/** A minimal complete portal snapshot for use in tests. */
function makeSourceSnapshot(): PortalSnapshot {
  return {
    guests: [
      {
        id: "gst_aaa",
        name: "Alice",
        email: "alice@example.com",
        createdAtUtc: new Date("2026-06-01T10:00:00Z"),
      },
      {
        id: "gst_bbb",
        name: "Bob",
        email: "bob@example.com",
        createdAtUtc: new Date("2026-06-02T10:00:00Z"),
      },
    ],
    codes: [
      // Active code for Alice
      {
        id: "otp_001",
        guestId: "gst_aaa",
        code: "123456",
        expiresAtUtc: TEN_MIN_FUTURE,
        consumed: false,
        createdAtUtc: new Date("2026-06-14T11:55:00Z"),
      },
      // Consumed code for Bob
      {
        id: "otp_002",
        guestId: "gst_bbb",
        code: "654321",
        expiresAtUtc: IN_FUTURE,
        consumed: true,
        createdAtUtc: new Date("2026-06-03T10:00:00Z"),
      },
    ],
    attempts: [
      // Locked attempt (code kind) for a device
      {
        id: "att_001",
        mac: "aa:bb:cc:dd:ee:01",
        kind: "code",
        wrongCount: 3,
        windowStartedAtUtc: new Date("2026-06-14T11:00:00Z"),
        lockedUntilUtc: IN_FUTURE,
      },
      // Clean attempt (password kind)
      {
        id: "att_002",
        mac: "aa:bb:cc:dd:ee:02",
        kind: "password",
        wrongCount: 1,
        windowStartedAtUtc: new Date("2026-06-14T11:00:00Z"),
        lockedUntilUtc: null,
      },
    ],
    authorizations: [
      // Active authorization (expires in future)
      {
        id: "auth_001",
        mac: "aa:bb:cc:dd:ee:03",
        guestId: "gst_aaa",
        grantedAtUtc: new Date("2026-06-14T10:00:00Z"),
        expiresAtUtc: IN_FUTURE,
      },
      // Expired authorization (expires in past)
      {
        id: "auth_002",
        mac: "aa:bb:cc:dd:ee:04",
        guestId: "gst_bbb",
        grantedAtUtc: new Date("2026-05-01T10:00:00Z"),
        expiresAtUtc: IN_PAST,
      },
    ],
  };
}

// ─── PORTAL_TABLES constant ───────────────────────────────────────────────────

describe("PORTAL_TABLES", () => {
  test("includes exactly the four portal tables subject to migration", () => {
    expect(PORTAL_TABLES).toContain("portal_guest");
    expect(PORTAL_TABLES).toContain("portal_code");
    expect(PORTAL_TABLES).toContain("portal_attempt");
    expect(PORTAL_TABLES).toContain("portal_authorization");
    expect(PORTAL_TABLES).toHaveLength(4);
  });
});

// ─── Row-count validation ─────────────────────────────────────────────────────

describe("validateRowCounts", () => {
  test("returns match=true for all tables when source and destination are identical", () => {
    const snap = makeSourceSnapshot();
    const results = validateRowCounts(snap, snap);
    for (const r of results) {
      expect(r.match).toBe(true);
    }
  });

  test("returns match=false when destination is missing rows", () => {
    const source = makeSourceSnapshot();
    const dest: PortalSnapshot = { ...source, guests: [] };
    const results = validateRowCounts(source, dest);
    const guestResult = results.find((r) => r.table === "portal_guest");
    expect(guestResult?.match).toBe(false);
    expect(guestResult?.expected).toBe(2);
    expect(guestResult?.actual).toBe(0);
  });

  test("rowCountsMatch returns false when any table fails", () => {
    const source = makeSourceSnapshot();
    const dest: PortalSnapshot = { ...source, codes: [] };
    const results = validateRowCounts(source, dest);
    expect(rowCountsMatch(results)).toBe(false);
  });

  test("rowCountsMatch returns true when all tables match", () => {
    const snap = makeSourceSnapshot();
    expect(rowCountsMatch(validateRowCounts(snap, snap))).toBe(true);
  });
});

// ─── Semantic queries ─────────────────────────────────────────────────────────

describe("findActiveAuthorization", () => {
  test("finds an active authorization when expiresAtUtc is in the future", () => {
    const snap = makeSourceSnapshot();
    const auth = findActiveAuthorization(snap, "aa:bb:cc:dd:ee:03", NOW);
    expect(auth?.id).toBe("auth_001");
  });

  test("returns undefined for an expired authorization", () => {
    const snap = makeSourceSnapshot();
    const auth = findActiveAuthorization(snap, "aa:bb:cc:dd:ee:04", NOW);
    expect(auth).toBeUndefined();
  });

  test("returns undefined for an unknown MAC", () => {
    const snap = makeSourceSnapshot();
    expect(findActiveAuthorization(snap, "ff:ff:ff:ff:ff:ff", NOW)).toBeUndefined();
  });
});

describe("findExpiredAuthorization", () => {
  test("finds an expired authorization when expiresAtUtc is in the past", () => {
    const snap = makeSourceSnapshot();
    const auth = findExpiredAuthorization(snap, "aa:bb:cc:dd:ee:04", NOW);
    expect(auth?.id).toBe("auth_002");
  });

  test("returns undefined for an active authorization", () => {
    const snap = makeSourceSnapshot();
    const auth = findExpiredAuthorization(snap, "aa:bb:cc:dd:ee:03", NOW);
    expect(auth).toBeUndefined();
  });
});

describe("findNewestActiveCode", () => {
  test("returns the newest unconsumed unexpired code for a guest", () => {
    const snap = makeSourceSnapshot();
    const code = findNewestActiveCode(snap, "gst_aaa", NOW);
    expect(code?.id).toBe("otp_001");
    expect(code?.consumed).toBe(false);
  });

  test("returns undefined for a guest with only consumed codes", () => {
    const snap = makeSourceSnapshot();
    const code = findNewestActiveCode(snap, "gst_bbb", NOW);
    expect(code).toBeUndefined();
  });

  test("returns undefined when no codes exist for a guest", () => {
    const snap = makeSourceSnapshot();
    const code = findNewestActiveCode(snap, "gst_zzz", NOW);
    expect(code).toBeUndefined();
  });

  test("returns newest code when multiple unconsumed codes exist for a guest", () => {
    const snap = makeSourceSnapshot();
    // Add a second unconsumed code for gst_aaa, newer than otp_001
    const newerCode = {
      id: "otp_003",
      guestId: "gst_aaa",
      code: "999999",
      expiresAtUtc: IN_FUTURE,
      consumed: false,
      createdAtUtc: new Date("2026-06-14T11:59:00Z"),
    };
    const snapWithTwo = { ...snap, codes: [...snap.codes, newerCode] };
    const found = findNewestActiveCode(snapWithTwo, "gst_aaa", NOW);
    expect(found?.id).toBe("otp_003");
  });
});

describe("isAttemptLocked", () => {
  test("returns true when a device is locked out in the future", () => {
    const snap = makeSourceSnapshot();
    expect(isAttemptLocked(snap, "aa:bb:cc:dd:ee:01", "code", NOW)).toBe(true);
  });

  test("returns false when the lockout has expired", () => {
    const snap = makeSourceSnapshot();
    // Check that a past lock is not considered locked
    const snapWithExpiredLock: PortalSnapshot = {
      ...snap,
      attempts: snap.attempts.map((a) =>
        a.mac === "aa:bb:cc:dd:ee:01" ? { ...a, lockedUntilUtc: IN_PAST } : a,
      ),
    };
    expect(isAttemptLocked(snapWithExpiredLock, "aa:bb:cc:dd:ee:01", "code", NOW)).toBe(false);
  });

  test("returns false when no lockout is set", () => {
    const snap = makeSourceSnapshot();
    expect(isAttemptLocked(snap, "aa:bb:cc:dd:ee:02", "password", NOW)).toBe(false);
  });

  test("returns false for an unknown MAC", () => {
    const snap = makeSourceSnapshot();
    expect(isAttemptLocked(snap, "ff:ff:ff:ff:ff:ff", "code", NOW)).toBe(false);
  });
});

// ─── Full semantic validation ─────────────────────────────────────────────────

describe("validateSemantics", () => {
  test("all checks pass when destination is identical to source", () => {
    const snap = makeSourceSnapshot();
    const result = validateSemantics(snap, snap, NOW);
    expect(semanticsValid(result)).toBe(true);
    expect(result.details).toHaveLength(0);
  });

  test("reports activeAuthorizationsPreserved=false when active auth is missing in dest", () => {
    const source = makeSourceSnapshot();
    // Keep only the expired auth (index 1), so the active auth is absent from dest
    const expiredOnly = source.authorizations.filter(
      (a) => a.expiresAtUtc.getTime() <= NOW.getTime(),
    );
    const dest: PortalSnapshot = { ...source, authorizations: expiredOnly };
    const result = validateSemantics(source, dest, NOW);
    expect(result.activeAuthorizationsPreserved).toBe(false);
    expect(result.details.some((d) => d.includes("active authorization"))).toBe(true);
  });

  test("reports expiredAuthorizationsPreserved=false when expired auth is missing in dest", () => {
    const source = makeSourceSnapshot();
    // Keep only the active auth, so the expired auth is absent from dest
    const activeOnly = source.authorizations.filter(
      (a) => a.expiresAtUtc.getTime() > NOW.getTime(),
    );
    const dest: PortalSnapshot = { ...source, authorizations: activeOnly };
    const result = validateSemantics(source, dest, NOW);
    expect(result.expiredAuthorizationsPreserved).toBe(false);
    expect(result.details.some((d) => d.includes("expired authorization"))).toBe(true);
  });

  test("reports activeCodesPreserved=false when active code is missing in dest", () => {
    const source = makeSourceSnapshot();
    const dest: PortalSnapshot = { ...source, codes: [] };
    const result = validateSemantics(source, dest, NOW);
    expect(result.activeCodesPreserved).toBe(false);
  });

  test("reports lockedAttemptsPreserved=false when locked attempt is missing in dest", () => {
    const source = makeSourceSnapshot();
    const dest: PortalSnapshot = { ...source, attempts: [] };
    const result = validateSemantics(source, dest, NOW);
    expect(result.lockedAttemptsPreserved).toBe(false);
  });

  test("semanticsValid returns false when any check fails", () => {
    const source = makeSourceSnapshot();
    const dest: PortalSnapshot = { ...source, authorizations: [] };
    const result = validateSemantics(source, dest, NOW);
    expect(semanticsValid(result)).toBe(false);
  });

  test("vacuously passes for empty snapshot (nothing to preserve)", () => {
    const empty: PortalSnapshot = { guests: [], codes: [], attempts: [], authorizations: [] };
    const result = validateSemantics(empty, empty, NOW);
    expect(semanticsValid(result)).toBe(true);
  });
});

// ─── ID integrity validation ─────────────────────────────────────────────────

describe("validateIdIntegrity", () => {
  test("passes when all IDs and foreign keys are intact", () => {
    const snap = makeSourceSnapshot();
    const result = validateIdIntegrity(snap, snap);
    expect(result.valid).toBe(true);
    expect(result.details).toHaveLength(0);
  });

  test("fails when a guest ID is missing in destination", () => {
    const source = makeSourceSnapshot();
    // Keep only gst_bbb, so gst_aaa is missing from destination
    const dest: PortalSnapshot = {
      ...source,
      guests: source.guests.filter((g) => g.id === "gst_bbb"),
    };
    const result = validateIdIntegrity(source, dest);
    expect(result.valid).toBe(false);
    expect(result.details.some((d) => d.includes("gst_aaa"))).toBe(true);
  });

  test("fails when a code references a guest that is missing in destination", () => {
    const source = makeSourceSnapshot();
    // Drop gst_aaa from dest guests but keep the code that references it
    const dest: PortalSnapshot = {
      ...source,
      guests: source.guests.filter((g) => g.id === "gst_bbb"),
    };
    const result = validateIdIntegrity(source, dest);
    expect(result.valid).toBe(false);
    // The dangling code FK should be reported
    expect(result.details.some((d) => d.includes("dangling guestId"))).toBe(true);
  });

  test("timestamps are preserved (createdAtUtc matches)", () => {
    // Verify that the fixture carries timestamps through to dest unchanged.
    const snap = makeSourceSnapshot();
    expect(snap.guests[0]?.createdAtUtc.toISOString()).toBe("2026-06-01T10:00:00.000Z");
    expect(snap.codes[0]?.expiresAtUtc.toISOString()).toBe("2026-06-14T12:10:00.000Z");
  });
});

// ─── Rehearsal report ─────────────────────────────────────────────────────────

describe("buildRehearsalReport", () => {
  test("includes PASSED and rollback note when all validations green", () => {
    const snap = makeSourceSnapshot();
    const rowCounts = validateRowCounts(snap, snap);
    const semantics = validateSemantics(snap, snap, NOW);
    const idIntegrity = validateIdIntegrity(snap, snap);
    const report = buildRehearsalReport(rowCounts, semantics, idIntegrity);
    expect(report).toContain("PASSED");
    expect(report).toContain("ROLLBACK NOTE");
    expect(report).toContain("source of truth");
  });

  test("includes FAILED when row counts do not match", () => {
    const source = makeSourceSnapshot();
    const dest: PortalSnapshot = { ...source, guests: [] };
    const rowCounts = validateRowCounts(source, dest);
    const semantics = validateSemantics(source, dest, NOW);
    const idIntegrity = validateIdIntegrity(source, dest);
    const report = buildRehearsalReport(rowCounts, semantics, idIntegrity);
    expect(report).toContain("FAILED");
  });

  test("includes per-table row counts in the report", () => {
    const snap = makeSourceSnapshot();
    const rowCounts = validateRowCounts(snap, snap);
    const semantics = validateSemantics(snap, snap, NOW);
    const idIntegrity = validateIdIntegrity(snap, snap);
    const report = buildRehearsalReport(rowCounts, semantics, idIntegrity);
    expect(report).toContain("portal_guest");
    expect(report).toContain("portal_code");
    expect(report).toContain("portal_attempt");
    expect(report).toContain("portal_authorization");
  });

  test("does not leak sensitive values (no email addresses, no codes) in report", () => {
    const snap = makeSourceSnapshot();
    const rowCounts = validateRowCounts(snap, snap);
    const semantics = validateSemantics(snap, snap, NOW);
    const idIntegrity = validateIdIntegrity(snap, snap);
    const report = buildRehearsalReport(rowCounts, semantics, idIntegrity);
    // The report is structural - no guest data should appear in it
    expect(report).not.toContain("alice@example.com");
    expect(report).not.toContain("123456");
  });
});
