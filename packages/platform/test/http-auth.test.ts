import { describe, expect, it } from "vitest";
import { matchesBearer } from "../http-auth";

describe("machine bearer authentication", () => {
  const token = "test-only-token-at-least-32-characters";
  const request = (header?: string) =>
    new Request("https://panel.test", { headers: header ? { Authorization: header } : {} });
  it("accepts only the exact configured token", () => {
    expect(matchesBearer(request(`Bearer ${token}`), token)).toBe(true);
    for (const header of [undefined, "Basic abc", `Bearer ${token}x`, "Bearer abc"])
      expect(matchesBearer(request(header), token)).toBe(false);
  });
  it("fails closed for absent or undersized configuration", () => {
    expect(matchesBearer(request(`Bearer ${token}`), undefined)).toBe(false);
    expect(matchesBearer(request("Bearer short"), "short")).toBe(false);
  });
});
