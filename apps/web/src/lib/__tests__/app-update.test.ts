import { describe, expect, it } from "vitest";
import { type AppUpdateStatus, computeAppUpdateBanner } from "../app-update";

const NOW = Date.parse("2026-07-11T00:00:00Z");

function status(overrides: Partial<AppUpdateStatus> = {}): AppUpdateStatus {
  return {
    buildNumber: 68,
    marketingVersion: "1.0",
    // 2 days before NOW so the age reads "2 days".
    uploadedDate: "2026-07-09T00:00:00Z",
    fetchedAt: "2026-07-11T00:00:00Z",
    ...overrides,
  };
}

describe("computeAppUpdateBanner", () => {
  it("returns the banner model when the panel is behind", () => {
    expect(computeAppUpdateBanner(65, status(), NOW)).toEqual({
      buildNumber: 68,
      message: "Update available",
      detail: "1.0 (68) · 3 builds behind · 2 days old",
    });
  });

  it("singularizes a one-build gap", () => {
    expect(computeAppUpdateBanner(67, status(), NOW)?.detail).toContain("1 build behind");
  });

  it("returns null when up to date", () => {
    expect(computeAppUpdateBanner(68, status(), NOW)).toBeNull();
  });

  it("returns null when ahead (local dev build newer than ASC)", () => {
    expect(computeAppUpdateBanner(70, status(), NOW)).toBeNull();
  });

  it("returns null with no installed build (plain browser)", () => {
    expect(computeAppUpdateBanner(null, status(), NOW)).toBeNull();
  });

  it("returns null with no cached status (poller never succeeded)", () => {
    expect(computeAppUpdateBanner(65, null, NOW)).toBeNull();
  });

  it("falls back to a bare build number when ASC gave no marketing version", () => {
    expect(computeAppUpdateBanner(65, status({ marketingVersion: "" }), NOW)?.detail).toContain(
      "build 68",
    );
  });

  it("omits the age segment for an unparseable uploadedDate", () => {
    const model = computeAppUpdateBanner(65, status({ uploadedDate: "garbage" }), NOW);
    expect(model?.detail).toBe("1.0 (68) · 3 builds behind");
  });

  it("names the device in the message when given a device name", () => {
    const model = computeAppUpdateBanner(65, status(), NOW, "iPad");
    expect(model?.message).toBe("Update available on iPad");
  });
});
