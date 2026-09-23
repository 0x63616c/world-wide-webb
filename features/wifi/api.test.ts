import { describe, expect, test } from "vitest";
import { buildWifiQrPayload } from "./api";

describe("buildWifiQrPayload", () => {
  test("encodes a WPA network", () => {
    expect(buildWifiQrPayload("Home Guest", "hunter2")).toBe("WIFI:T:WPA;S:Home Guest;P:hunter2;;");
  });

  test("encodes an open network when the password is empty", () => {
    expect(buildWifiQrPayload("Cafe", "")).toBe("WIFI:T:nopass;S:Cafe;;");
  });

  test("is empty when no SSID is configured", () => {
    expect(buildWifiQrPayload("", "pw")).toBe("");
  });

  test("backslash-escapes the structural characters", () => {
    // String.raw so the backslashes read exactly as a scanner sees them.
    expect(buildWifiQrPayload(String.raw`a;b,c:d"e\f`, "p;w")).toBe(
      String.raw`WIFI:T:WPA;S:a\;b\,c\:d\"e\\f;P:p\;w;;`,
    );
  });
});
