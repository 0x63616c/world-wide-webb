import { describe, expect, test } from "vitest";
import { controlCenterProductManifest } from "../src/index.ts";

describe("Control Center platform representation", () => {
  test("declares Control Center app identity and target app surface", () => {
    const manifest = controlCenterProductManifest();

    expect(manifest.product.slug).toBe("control-center");
    expect(manifest.app.exposure.hostname).toBe("app.worldwidewebb.co");
  });

  test("declares every Control Center service the manifest owns", () => {
    const manifest = controlCenterProductManifest();
    const serviceNames = Object.values(manifest.services)
      .map((service) => service.service)
      .sort();

    // `captive-portal` and `storybook` were deleted by The Simplification
    // (§1 Storybook, §2 guest-wifi).
    expect(serviceNames).toEqual(["api", "cloudflared", "web", "worker"]);
  });
});
