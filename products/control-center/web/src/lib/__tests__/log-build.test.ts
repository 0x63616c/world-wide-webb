import { describe, expect, it } from "vitest";
import { getBuild, getTail, log, resolveBuild } from "../log/logger";

describe("build number stamping", () => {
  it('defaults to "web" off-device', () => {
    expect(getBuild()).toBe("web");
  });

  it("stamps the current build onto every entry", () => {
    const before = getTail().length;
    log.info("build stamp line");
    const stamped = getTail()[before];
    expect(stamped?.build).toBe(getBuild());
    expect(stamped?.build).toBe("web");
  });

  it('resolveBuild stays "web" in a non-native (jsdom) environment', async () => {
    // Capacitor.isNativePlatform() is false under jsdom, so no @capacitor/app
    // call happens and the build number holds its default , the accepted
    // late-resolve contract for a plain browser / Storybook / test run.
    await resolveBuild();
    expect(getBuild()).toBe("web");
  });
});
