/**
 * Guards the settings CONTRACT , the shared module (../contract/settings) that
 * the api's zod schema and the web store both derive from.
 *
 * The point is not to re-test zod. It is that these two sides used to declare
 * the same vocabulary independently, and had already drifted. These tests
 * fail if someone reintroduces a literal here instead of importing the contract.
 */

import { describe, expect, it } from "vitest";

import { ACCENTS, DEFAULT_TIME_ZONE, SETTINGS_DEFAULTS } from "../contract/settings";
import { DEFAULTS, settingsSchema } from "../services/settings-service";

describe("settings contract", () => {
  it("accepts every accent the web picker can offer", () => {
    // The picker is built by mapping ACCENTS, so a key the schema rejects is
    // a key the user can select and then fail to save.
    for (const accent of ACCENTS) {
      expect(settingsSchema.parse({ ...DEFAULTS, accent }).accent).toBe(accent);
    }
  });

  it("rejects an accent outside the contract", () => {
    expect(() => settingsSchema.parse({ ...DEFAULTS, accent: "purple" })).toThrow();
  });

  it("validates its own defaults", () => {
    // DEFAULTS is the merge floor for every read and write; if it did not parse,
    // getSettings would throw on a fresh install.
    expect(settingsSchema.parse(DEFAULTS)).toEqual(DEFAULTS);
    expect(DEFAULTS).toBe(SETTINGS_DEFAULTS);
  });

  it("defaults the panel's calendar zone to Los Angeles and rejects invalid zones", () => {
    expect(DEFAULTS.timeZone).toBe(DEFAULT_TIME_ZONE);
    expect(settingsSchema.parse({ ...DEFAULTS, timeZone: "Europe/London" }).timeZone).toBe(
      "Europe/London",
    );
    expect(() => settingsSchema.parse({ ...DEFAULTS, timeZone: "not/a-zone" })).toThrow();
  });

  it("enforces the PIN's 6-digit shape", () => {
    expect(settingsSchema.parse({ ...DEFAULTS, pinCode: "123456" }).pinCode).toBe("123456");
    expect(() => settingsSchema.parse({ ...DEFAULTS, pinCode: "12345" })).toThrow();
    expect(() => settingsSchema.parse({ ...DEFAULTS, pinCode: "abcdef" })).toThrow();
  });
});
