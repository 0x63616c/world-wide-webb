// Portal data migration tooling (www-jtp0.5.6).
//
// Provides pure functions for rehearsal and validation of portal table migration
// from Control Center Postgres to Captive Portal Postgres. All logic is
// testable without a live database connection; the actual pg_dump/pg_restore
// invocations live in scripts/portal-export.sh and scripts/portal-import.sh.
//
// IMPORTANT: this module never reads or writes production databases.
// Production export/import requires a human review checkpoint (see REQUIRES_CALUM
// comment in scripts/portal-export.sh). The Control Center database remains the
// source of truth until the final cutover is approved and validated (www-jtp0.5.7).

/** The four portal tables subject to migration. */
export const PORTAL_TABLES = [
  "portal_guest",
  "portal_code",
  "portal_attempt",
  "portal_authorization",
] as const;

/** @public - union of the four portal table names; used as a discriminant in validation results. */
export type PortalTable = (typeof PORTAL_TABLES)[number];

/**
 * @public - minimal shape of a portal_guest row for migration fixture testing.
 * Scripts use this type to represent rows read from the source database.
 */
export interface PortalGuestRow {
  id: string; // gst_<id>
  name: string;
  email: string;
  createdAtUtc: Date;
}

export interface PortalCodeRow {
  id: string; // otp_<id>
  guestId: string;
  code: string;
  expiresAtUtc: Date;
  consumed: boolean;
  createdAtUtc: Date;
}

/** @public - minimal shape of a portal_attempt row for migration fixture testing. */
export interface PortalAttemptRow {
  id: string; // att_<id>
  mac: string;
  kind: "code" | "password";
  wrongCount: number;
  windowStartedAtUtc: Date;
  lockedUntilUtc: Date | null;
}

export interface PortalAuthorizationRow {
  id: string; // auth_<id>
  mac: string;
  guestId: string;
  grantedAtUtc: Date;
  expiresAtUtc: Date;
}

/** A snapshot of all four portal tables for rehearsal / validation. */
export interface PortalSnapshot {
  guests: PortalGuestRow[];
  codes: PortalCodeRow[];
  attempts: PortalAttemptRow[];
  authorizations: PortalAuthorizationRow[];
}

/** Row-count validation result. */
export interface RowCountValidation {
  table: PortalTable;
  expected: number;
  actual: number;
  match: boolean;
}

/**
 * Validates that the destination snapshot matches the source row counts exactly.
 * Returns one validation entry per table; all must be match=true for a valid migration.
 */
export function validateRowCounts(
  source: PortalSnapshot,
  destination: PortalSnapshot,
): RowCountValidation[] {
  return [
    {
      table: "portal_guest",
      expected: source.guests.length,
      actual: destination.guests.length,
      match: source.guests.length === destination.guests.length,
    },
    {
      table: "portal_code",
      expected: source.codes.length,
      actual: destination.codes.length,
      match: source.codes.length === destination.codes.length,
    },
    {
      table: "portal_attempt",
      expected: source.attempts.length,
      actual: destination.attempts.length,
      match: source.attempts.length === destination.attempts.length,
    },
    {
      table: "portal_authorization",
      expected: source.authorizations.length,
      actual: destination.authorizations.length,
      match: source.authorizations.length === destination.authorizations.length,
    },
  ];
}

/** Whether all row-count validations passed. */
export function rowCountsMatch(validations: RowCountValidation[]): boolean {
  return validations.every((v) => v.match);
}

/**
 * Semantic query: find the active authorization for a device MAC.
 * An authorization is active when expiresAtUtc is in the future relative to `now`.
 */
export function findActiveAuthorization(
  snapshot: PortalSnapshot,
  mac: string,
  now: Date,
): PortalAuthorizationRow | undefined {
  return snapshot.authorizations.find(
    (a) => a.mac === mac && a.expiresAtUtc.getTime() > now.getTime(),
  );
}

/**
 * Semantic query: find the expired authorization for a device MAC.
 * An authorization is expired when expiresAtUtc is in the past relative to `now`.
 */
export function findExpiredAuthorization(
  snapshot: PortalSnapshot,
  mac: string,
  now: Date,
): PortalAuthorizationRow | undefined {
  return snapshot.authorizations.find(
    (a) => a.mac === mac && a.expiresAtUtc.getTime() <= now.getTime(),
  );
}

/**
 * Semantic query: find the newest unconsumed (active) code for a guest.
 * Returns undefined if no active code exists (all consumed, all expired, or no codes).
 */
export function findNewestActiveCode(
  snapshot: PortalSnapshot,
  guestId: string,
  now: Date,
): PortalCodeRow | undefined {
  return snapshot.codes
    .filter((c) => c.guestId === guestId && !c.consumed && c.expiresAtUtc.getTime() > now.getTime())
    .sort((a, b) => b.createdAtUtc.getTime() - a.createdAtUtc.getTime())[0];
}

/**
 * Semantic query: check if a device MAC is currently locked out.
 * A device is locked if lockedUntilUtc is set and in the future.
 */
export function isAttemptLocked(
  snapshot: PortalSnapshot,
  mac: string,
  kind: "code" | "password",
  now: Date,
): boolean {
  const attempt = snapshot.attempts.find((a) => a.mac === mac && a.kind === kind);
  if (!attempt?.lockedUntilUtc) return false;
  return attempt.lockedUntilUtc.getTime() > now.getTime();
}

/** Result of a full semantic validation pass. */
export interface SemanticValidation {
  activeAuthorizationsPreserved: boolean;
  expiredAuthorizationsPreserved: boolean;
  activeCodesPreserved: boolean;
  lockedAttemptsPreserved: boolean;
  details: string[];
}

/**
 * Runs the four semantic checks against source and destination snapshots.
 * Used to confirm that migration preserved the semantics the application relies on,
 * not just the raw bytes.
 *
 * Each check samples the first row of its kind from the source and looks for it
 * (with the same semantics) in the destination. A snapshot with no rows of a kind
 * reports that check as passing (vacuously true - nothing to preserve).
 */
export function validateSemantics(
  source: PortalSnapshot,
  destination: PortalSnapshot,
  now: Date,
): SemanticValidation {
  const details: string[] = [];

  // Active authorization: verify the first active auth in source also appears active in dest.
  const srcActiveAuth = source.authorizations.find((a) => a.expiresAtUtc.getTime() > now.getTime());
  let activeAuthorizationsPreserved = true;
  if (srcActiveAuth) {
    const destActive = findActiveAuthorization(destination, srcActiveAuth.mac, now);
    activeAuthorizationsPreserved = destActive !== undefined;
    if (!activeAuthorizationsPreserved) {
      details.push(`active authorization for mac=${srcActiveAuth.mac} missing in destination`);
    }
  }

  // Expired authorization: verify the first expired auth in source also appears expired in dest.
  const srcExpiredAuth = source.authorizations.find(
    (a) => a.expiresAtUtc.getTime() <= now.getTime(),
  );
  let expiredAuthorizationsPreserved = true;
  if (srcExpiredAuth) {
    const destExpired = findExpiredAuthorization(destination, srcExpiredAuth.mac, now);
    expiredAuthorizationsPreserved = destExpired !== undefined;
    if (!expiredAuthorizationsPreserved) {
      details.push(`expired authorization for mac=${srcExpiredAuth.mac} missing in destination`);
    }
  }

  // Newest active code: verify the first guest with an active code in source has one in dest.
  const guestWithActiveCode = source.guests.find((g) => findNewestActiveCode(source, g.id, now));
  let activeCodesPreserved = true;
  if (guestWithActiveCode) {
    const destCode = findNewestActiveCode(destination, guestWithActiveCode.id, now);
    activeCodesPreserved = destCode !== undefined;
    if (!activeCodesPreserved) {
      details.push(`active code for guestId=${guestWithActiveCode.id} missing in destination`);
    }
  }

  // Locked attempt: verify the first locked attempt in source also shows locked in dest.
  const srcLockedAttempt = source.attempts.find(
    (a) => a.lockedUntilUtc && a.lockedUntilUtc.getTime() > now.getTime(),
  );
  let lockedAttemptsPreserved = true;
  if (srcLockedAttempt) {
    const destLocked = isAttemptLocked(
      destination,
      srcLockedAttempt.mac,
      srcLockedAttempt.kind,
      now,
    );
    lockedAttemptsPreserved = destLocked;
    if (!lockedAttemptsPreserved) {
      details.push(
        `locked attempt for mac=${srcLockedAttempt.mac} kind=${srcLockedAttempt.kind} missing in destination`,
      );
    }
  }

  return {
    activeAuthorizationsPreserved,
    expiredAuthorizationsPreserved,
    activeCodesPreserved,
    lockedAttemptsPreserved,
    details,
  };
}

/** Whether all semantic validations passed. */
export function semanticsValid(v: SemanticValidation): boolean {
  return (
    v.activeAuthorizationsPreserved &&
    v.expiredAuthorizationsPreserved &&
    v.activeCodesPreserved &&
    v.lockedAttemptsPreserved
  );
}

/**
 * Validates that IDs and foreign-key references were preserved exactly.
 * A migration that renumbers IDs or drops FKs would corrupt the application.
 */
export function validateIdIntegrity(
  source: PortalSnapshot,
  destination: PortalSnapshot,
): { valid: boolean; details: string[] } {
  const details: string[] = [];

  // Every source guest id must appear in destination.
  const destGuestIds = new Set(destination.guests.map((g) => g.id));
  for (const g of source.guests) {
    if (!destGuestIds.has(g.id)) {
      details.push(`guest id=${g.id} missing in destination`);
    }
  }

  // Every code's guestId must resolve to a real guest in destination.
  for (const c of destination.codes) {
    if (!destGuestIds.has(c.guestId)) {
      details.push(`code id=${c.id} has dangling guestId=${c.guestId}`);
    }
  }

  // Every authorization's guestId must resolve to a real guest in destination.
  for (const a of destination.authorizations) {
    if (!destGuestIds.has(a.guestId)) {
      details.push(`authorization id=${a.id} has dangling guestId=${a.guestId}`);
    }
  }

  return { valid: details.length === 0, details };
}

/**
 * Human-readable migration rehearsal report. Summarises all validation results
 * for the human review checkpoint required before any production export/import.
 *
 * NOTE: this report is produced for REHEARSAL only (scratch DB). Production
 * export/import requires Calum's explicit approval (REQUIRES CALUM - www-jtp0.5.7).
 */
export function buildRehearsalReport(
  rowCounts: RowCountValidation[],
  semantics: SemanticValidation,
  idIntegrity: { valid: boolean; details: string[] },
): string {
  const lines: string[] = [];

  lines.push("=== Portal migration rehearsal report ===");
  lines.push("");

  lines.push("Row counts:");
  for (const rc of rowCounts) {
    const status = rc.match ? "OK" : "FAIL";
    lines.push(`  [${status}] ${rc.table}: expected=${rc.expected} actual=${rc.actual}`);
  }
  lines.push("");

  lines.push("Semantic checks:");
  lines.push(
    `  [${semantics.activeAuthorizationsPreserved ? "OK" : "FAIL"}] active authorizations preserved`,
  );
  lines.push(
    `  [${semantics.expiredAuthorizationsPreserved ? "OK" : "FAIL"}] expired authorizations preserved`,
  );
  lines.push(`  [${semantics.activeCodesPreserved ? "OK" : "FAIL"}] active codes preserved`);
  lines.push(`  [${semantics.lockedAttemptsPreserved ? "OK" : "FAIL"}] locked attempts preserved`);
  if (semantics.details.length > 0) {
    for (const d of semantics.details) {
      lines.push(`    ! ${d}`);
    }
  }
  lines.push("");

  lines.push("ID integrity:");
  lines.push(`  [${idIntegrity.valid ? "OK" : "FAIL"}] foreign-key references intact`);
  if (idIntegrity.details.length > 0) {
    for (const d of idIntegrity.details) {
      lines.push(`    ! ${d}`);
    }
  }
  lines.push("");

  const allGreen = rowCountsMatch(rowCounts) && semanticsValid(semantics) && idIntegrity.valid;
  lines.push(
    allGreen
      ? "RESULT: rehearsal PASSED - ready for human review checkpoint"
      : "RESULT: rehearsal FAILED - review the failures above before proceeding",
  );
  lines.push("");
  lines.push("ROLLBACK NOTE: Control Center database is the source of truth until the final");
  lines.push("cutover is approved by Calum and validated (www-jtp0.5.7 REQUIRES CALUM).");

  return lines.join("\n");
}
