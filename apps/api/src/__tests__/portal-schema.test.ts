/**
 * Tests for the captive-portal domain schema (CC-q002.8).
 * Verifies table shape, column names, constraints (primaryKey, FK onDelete,
 * uniqueIndex), and default values via Drizzle introspection.
 * No DB connection needed — all checks use static schema metadata.
 */
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { portalAttempt, portalAuthorization, portalCode, portalGuest } from "../db/schema";

// Helper: find a column config by its SQL column name.
function col(table: ReturnType<typeof getTableConfig>, name: string) {
  const c = table.columns.find((c) => c.name === name);
  if (!c) throw new Error(`Column '${name}' not found in ${table.name}`);
  return c;
}

// Drizzle stores the table name on a well-known symbol; cast through unknown to read it.
const DRIZZLE_NAME = Symbol.for("drizzle:Name") as unknown as string;

describe("portal_guest table schema", () => {
  it("has expected column names", () => {
    const cols = Object.keys(portalGuest);
    for (const name of ["id", "name", "email", "createdAtUtc"]) {
      expect(cols).toContain(name);
    }
  });

  it("id is the primary key", () => {
    const cfg = getTableConfig(portalGuest);
    expect(col(cfg, "id").primary).toBe(true);
  });

  it("required fields are notNull", () => {
    const cfg = getTableConfig(portalGuest);
    for (const name of ["id", "name", "email", "created_at_utc"]) {
      expect(col(cfg, name).notNull).toBe(true);
    }
  });
});

describe("portal_code table schema", () => {
  it("has expected column names", () => {
    const cols = Object.keys(portalCode);
    for (const name of ["id", "guestId", "code", "expiresAtUtc", "consumed", "createdAtUtc"]) {
      expect(cols).toContain(name);
    }
  });

  it("id is the primary key", () => {
    const cfg = getTableConfig(portalCode);
    expect(col(cfg, "id").primary).toBe(true);
  });

  it("consumed defaults to false", () => {
    const cfg = getTableConfig(portalCode);
    const c = col(cfg, "consumed");
    expect(c.hasDefault).toBe(true);
    expect(c.default).toBe(false);
  });

  it("guest_id FK references portal_guest.id with onDelete:cascade", () => {
    const cfg = getTableConfig(portalCode);
    const fk = cfg.foreignKeys.find((fk) =>
      fk.reference().columns.some((c) => c.name === "guest_id"),
    );
    expect(fk).toBeDefined();
    if (!fk) throw new Error("fk unexpectedly undefined after toBeDefined()");
    const ref = fk.reference();
    const foreignTableName = (ref.foreignTable as unknown as Record<string, unknown>)[
      DRIZZLE_NAME
    ] as string;
    expect(foreignTableName).toBe("portal_guest");
    expect(ref.foreignColumns.map((c) => c.name)).toContain("id");
    expect(fk.onDelete).toBe("cascade");
  });

  it("required fields are notNull", () => {
    const cfg = getTableConfig(portalCode);
    for (const name of ["id", "guest_id", "code", "expires_at_utc", "consumed", "created_at_utc"]) {
      expect(col(cfg, name).notNull).toBe(true);
    }
  });

  it("indexes guest_id + consumed for the active-code lookup", () => {
    const cfg = getTableConfig(portalCode);
    const names = cfg.indexes.map((i) => i.config?.name);
    expect(names).toContain("portal_code_guest_consumed_idx");
  });
});

describe("portal_attempt table schema", () => {
  it("has expected column names", () => {
    const cols = Object.keys(portalAttempt);
    for (const name of [
      "id",
      "mac",
      "kind",
      "wrongCount",
      "windowStartedAtUtc",
      "lockedUntilUtc",
    ]) {
      expect(cols).toContain(name);
    }
  });

  it("id is the primary key", () => {
    const cfg = getTableConfig(portalAttempt);
    expect(col(cfg, "id").primary).toBe(true);
  });

  it("wrong_count defaults to 0", () => {
    const cfg = getTableConfig(portalAttempt);
    const c = col(cfg, "wrong_count");
    expect(c.hasDefault).toBe(true);
    expect(c.default).toBe(0);
  });

  it("one row per (mac, kind): unique index", () => {
    const cfg = getTableConfig(portalAttempt);
    const uniques = cfg.indexes.filter((i) => i.config?.unique === true);
    const names = uniques.map((i) => i.config?.name);
    expect(names).toContain("portal_attempt_mac_kind_idx");
  });

  it("required fields are notNull", () => {
    const cfg = getTableConfig(portalAttempt);
    for (const name of ["id", "mac", "kind", "wrong_count", "window_started_at_utc"]) {
      expect(col(cfg, name).notNull).toBe(true);
    }
  });
});

describe("portal_authorization table schema", () => {
  it("has expected column names", () => {
    const cols = Object.keys(portalAuthorization);
    for (const name of ["id", "mac", "guestId", "grantedAtUtc", "expiresAtUtc"]) {
      expect(cols).toContain(name);
    }
  });

  it("id is the primary key", () => {
    const cfg = getTableConfig(portalAuthorization);
    expect(col(cfg, "id").primary).toBe(true);
  });

  it("mac has a unique index (one authorization row per device — idempotent upsert)", () => {
    const cfg = getTableConfig(portalAuthorization);
    const uniques = cfg.indexes.filter((i) => i.config?.unique === true);
    const names = uniques.map((i) => i.config?.name);
    expect(names).toContain("portal_authorization_mac_idx");
  });

  it("guest_id FK references portal_guest.id with onDelete:cascade", () => {
    const cfg = getTableConfig(portalAuthorization);
    const fk = cfg.foreignKeys.find((fk) =>
      fk.reference().columns.some((c) => c.name === "guest_id"),
    );
    expect(fk).toBeDefined();
    if (!fk) throw new Error("fk unexpectedly undefined after toBeDefined()");
    const ref = fk.reference();
    const foreignTableName = (ref.foreignTable as unknown as Record<string, unknown>)[
      DRIZZLE_NAME
    ] as string;
    expect(foreignTableName).toBe("portal_guest");
    expect(fk.onDelete).toBe("cascade");
  });

  it("required fields are notNull", () => {
    const cfg = getTableConfig(portalAuthorization);
    for (const name of ["id", "mac", "guest_id", "granted_at_utc", "expires_at_utc"]) {
      expect(col(cfg, name).notNull).toBe(true);
    }
  });
});
