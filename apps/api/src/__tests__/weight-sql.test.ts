import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { dayExpr, isValidTimeZone } from "../services/weight-sql";

const dialect = new PgDialect();

describe("isValidTimeZone", () => {
  it("accepts IANA names", () => {
    expect(isValidTimeZone("America/Los_Angeles")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
  });
  it("rejects junk and injection attempts", () => {
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(isValidTimeZone("'; drop table weight_measurement; --")).toBe(false);
  });
});

describe("dayExpr", () => {
  it("binds the timezone as a parameter, never inlines it", () => {
    const { params, sql } = dialect.sqlToQuery(dayExpr("America/Los_Angeles"));
    expect(params).toContain("America/Los_Angeles");
    expect(sql).not.toContain("America/Los_Angeles");
  });
});
