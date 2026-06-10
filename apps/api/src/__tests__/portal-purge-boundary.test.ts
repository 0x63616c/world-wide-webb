/**
 * Row-level predicate boundary tests for the portal purge (www-q002.18 hardening).
 * These prove the EXACT cutoff a row is purged at, so a flipped comparator or an
 * off-by-one in the retention math fails a test instead of silently deleting live
 * data. The pure predicate helpers below are the single source of truth that the
 * SQL WHERE clauses mirror 1:1.
 */
import { describe, expect, it } from "vitest";
import {
  ATTEMPT_RETENTION_MS,
  AUTHORIZATION_GRACE_MS,
  attemptShouldPurge,
  authorizationShouldPurge,
  codeShouldPurge,
} from "../services/portal-purge-service";

const NOW = new Date(Date.UTC(2026, 5, 10, 12, 0, 0));
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);
const minutesFromNow = (m: number) => new Date(NOW.getTime() + m * 60 * 1000);

describe("codeShouldPurge", () => {
  it("DELETES a consumed code even if still fresh (not yet expired)", () => {
    expect(codeShouldPurge({ consumed: true, expiresAtUtc: minutesFromNow(5) }, NOW)).toBe(true);
  });
  it("KEEPS an unconsumed, unexpired code (still usable)", () => {
    expect(codeShouldPurge({ consumed: false, expiresAtUtc: minutesFromNow(5) }, NOW)).toBe(false);
  });
  it("DELETES an unconsumed but expired code", () => {
    expect(codeShouldPurge({ consumed: false, expiresAtUtc: minutesFromNow(-1) }, NOW)).toBe(true);
  });
});

describe("authorizationShouldPurge (90-day grace)", () => {
  it("KEEPS an authorization expired 89 days ago (still drives SessionExpired)", () => {
    expect(authorizationShouldPurge({ expiresAtUtc: daysAgo(89) }, NOW)).toBe(false);
  });
  it("DELETES an authorization expired 91 days ago", () => {
    expect(authorizationShouldPurge({ expiresAtUtc: daysAgo(91) }, NOW)).toBe(true);
  });
  it("KEEPS a still-active authorization (expires in the future)", () => {
    expect(authorizationShouldPurge({ expiresAtUtc: daysAgo(-1) }, NOW)).toBe(false);
  });
  it("boundary: exactly at the 90-day cutoff is KEPT (strictly-older purges)", () => {
    const exactly = new Date(NOW.getTime() - AUTHORIZATION_GRACE_MS);
    expect(authorizationShouldPurge({ expiresAtUtc: exactly }, NOW)).toBe(false);
  });
});

describe("attemptShouldPurge (1-day retention)", () => {
  it("KEEPS an attempt whose window started 23h ago", () => {
    expect(attemptShouldPurge({ windowStartedAtUtc: hoursAgo(23) }, NOW)).toBe(false);
  });
  it("DELETES an attempt whose window started 25h ago", () => {
    expect(attemptShouldPurge({ windowStartedAtUtc: hoursAgo(25) }, NOW)).toBe(true);
  });
  it("retention is comfortably longer than the 10-minute lockout window", () => {
    expect(ATTEMPT_RETENTION_MS).toBeGreaterThan(10 * 60 * 1000);
  });
});
