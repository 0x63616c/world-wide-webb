import { describe, expect, it } from "vitest";
import { tzInput } from "../trpc/routers/weight";

describe("tzInput", () => {
  it("accepts a real zone", () => {
    expect(tzInput.parse("America/Los_Angeles")).toBe("America/Los_Angeles");
  });
  it("rejects an unknown zone", () => {
    expect(() => tzInput.parse("Mars/Olympus")).toThrow();
  });
  it("rejects a SQL injection attempt", () => {
    expect(() => tzInput.parse("UTC'; drop table weight_measurement; --")).toThrow();
  });
});
