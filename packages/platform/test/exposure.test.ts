import { describe, expect, test } from "vitest";
import {
  captivePortalWeb,
  defineProduct,
  homelabTarget,
  internalService,
  privateWeb,
  publicWeb,
} from "../src/index.ts";

describe("exposure intent primitives", () => {
  test("declares public web hostnames from product DNS codes", () => {
    const exposure = publicWeb(defineProduct("text-your-ex"), homelabTarget, { host: "api" });

    expect(exposure).toMatchObject({
      kind: "public-web",
      hostname: "api.tye.worldwidewebb.co",
      policy: "public",
    });
  });

  test("declares private web hostnames with Cloudflare Access intent", () => {
    const exposure = privateWeb(defineProduct("control-center"), homelabTarget, { host: "app" });

    expect(exposure).toMatchObject({
      cloudflareAccess: true,
      kind: "private-web",
      hostname: "app.cc.worldwidewebb.co",
      policy: "private",
    });
  });

  test("keeps captive portal as a special LAN/captive exposure", () => {
    const exposure = captivePortalWeb(defineProduct("captive-portal"), homelabTarget, {
      host: "app",
    });

    expect(exposure).toMatchObject({
      humanReview: {
        required: true,
        reason: "Captive portal exposure changes UniFi, LAN forwarding, DNS, and TLS behavior.",
      },
      kind: "captive-portal-web",
      hostname: "app.cp.worldwidewebb.co",
      policy: "captive",
    });
  });

  test("declares internal services without external DNS", () => {
    expect(internalService({ port: 4201 })).toEqual({
      kind: "internal-service",
      port: 4201,
      policy: "internal",
    });
  });

  test("does not create external API hostnames unless a service declares one", () => {
    const appOnly = privateWeb(defineProduct("control-center"), homelabTarget, { host: "app" });

    expect(appOnly.hostname).toBe("app.cc.worldwidewebb.co");
    expect(appOnly.hostname).not.toBe("api.cc.worldwidewebb.co");
  });
});
