import { describe, expect, it } from "vitest";
import { captivePortalApiDependencies } from "./dependencies";
import { captivePortalApiRouter } from "./router";

describe("captive portal product API boundary", () => {
  it("exposes only the captive portal tRPC procedures", () => {
    const procedures = Object.keys(captivePortalApiRouter._def.procedures).sort();

    expect(procedures).toEqual(["portal.authorize", "portal.checkPassword", "portal.status"]);
  });

  it("declares the service integrations and secret inputs it depends on", () => {
    expect(captivePortalApiDependencies).toMatchObject({
      service: "captive-portal-api",
      routerBoundary: "portal-only",
      integrationDependencies: ["unifi"],
      secretNames: ["POSTGRES_PASSWORD", "UNIFI_API_KEY", "WIFI_PASSWORD", "WIFI_SSID"],
    });
  });
});
