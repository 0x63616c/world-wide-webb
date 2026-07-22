import { describe, expect, test } from "vitest";
import {
  captivePortalWeb,
  defineProduct,
  homelabTarget,
  internalService,
  privateWeb,
} from "../src/index.ts";

describe("exposure intent primitives", () => {
  test("declares private web hostnames from product DNS codes", () => {
    const exposure = privateWeb(defineProduct("control-center"), homelabTarget, { host: "api" });

    expect(exposure).toMatchObject({
      kind: "private-web",
      hostname: "api--cc.worldwidewebb.co",
      policy: "private",
      tls: {
        coverage: {
          dnsNames: ["api--cc.worldwidewebb.co"],
          hostname: "api--cc.worldwidewebb.co",
          kind: "exact-host",
        },
        required: true,
      },
    });
  });

  test.each([
    ["control-center", "app", "app--cc.worldwidewebb.co"],
    ["captive-portal", "app", "app--cp.worldwidewebb.co"],
    ["control-center", "api", "api--cc.worldwidewebb.co"],
  ] as const)("derives nested hostnames for %s %s", (slug, host, hostname) => {
    const exposure = privateWeb(defineProduct(slug), homelabTarget, { host });

    expect(exposure.hostname).toBe(hostname);
    expect(exposure.hostname).not.toBe(`${slug}.worldwidewebb.co`);
  });

  test("declares private web hostnames with Cloudflare Access intent", () => {
    const exposure = privateWeb(defineProduct("control-center"), homelabTarget, { host: "app" });

    expect(exposure).toMatchObject({
      cloudflareAccess: true,
      kind: "private-web",
      hostname: "app--cc.worldwidewebb.co",
      policy: "private",
    });
  });

  test("keeps captive portal as a special LAN/captive exposure", () => {
    const exposure = captivePortalWeb(defineProduct("captive-portal"), homelabTarget, {
      host: "app",
    });

    expect(exposure).toMatchObject({
      kind: "captive-portal-web",
      hostname: "app--cp.worldwidewebb.co",
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

    expect(appOnly.hostname).toBe("app--cc.worldwidewebb.co");
    expect(appOnly.hostname).not.toBe("api--cc.worldwidewebb.co");
  });
});
