import { describe, expect, test } from "vitest";
import { captivePortalWeb, homelabTarget, internalService, privateWeb } from "../src/index.ts";

describe("exposure intent primitives", () => {
  test("declares private web hostnames as a single label under the zone", () => {
    const exposure = privateWeb(homelabTarget, { host: "api" });

    expect(exposure).toMatchObject({
      kind: "private-web",
      hostname: "api.worldwidewebb.co",
      policy: "private",
      tls: {
        coverage: {
          dnsNames: ["api.worldwidewebb.co"],
          hostname: "api.worldwidewebb.co",
          kind: "exact-host",
        },
        required: true,
      },
    });
  });

  test.each([
    ["app", "app.worldwidewebb.co"],
    ["storybook", "storybook.worldwidewebb.co"],
    ["api", "api.worldwidewebb.co"],
  ] as const)("derives the single-label hostname for host %s", (host, hostname) => {
    const exposure = privateWeb(homelabTarget, { host });

    expect(exposure.hostname).toBe(hostname);
    // No `--` flattening remnant (retired with the dnsCode scheme, Task 7C).
    expect(exposure.hostname).not.toContain("--");
  });

  test("declares private web hostnames with Cloudflare Access intent", () => {
    const exposure = privateWeb(homelabTarget, { host: "app" });

    expect(exposure).toMatchObject({
      cloudflareAccess: true,
      kind: "private-web",
      hostname: "app.worldwidewebb.co",
      policy: "private",
    });
  });

  test("keeps captive portal as a special LAN/captive exposure", () => {
    const exposure = captivePortalWeb(homelabTarget, { host: "app" });

    expect(exposure).toMatchObject({
      kind: "captive-portal-web",
      hostname: "app.worldwidewebb.co",
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
    const appOnly = privateWeb(homelabTarget, { host: "app" });

    expect(appOnly.hostname).toBe("app.worldwidewebb.co");
    expect(appOnly.hostname).not.toBe("api.worldwidewebb.co");
  });
});
