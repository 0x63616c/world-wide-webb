import { describe, expect, it } from "vitest";
import { DEFAULTS, getSettings } from "../services/settings-service";

// getSettings takes the db as an argument, so a hand-rolled fake standing in for
// the `select().from().where().limit()` chain is enough , no module mock needed.
function fakeDb(storedValue: unknown) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(storedValue === undefined ? [] : [{ value: storedValue }]),
        }),
      }),
    }),
    // biome-ignore lint/suspicious/noExplicitAny: minimal stand-in for the drizzle db
  } as any;
}

describe("settings-service DEFAULTS", () => {
  it("carries the PIN + accent + time zone defaults", () => {
    expect(DEFAULTS.pinCode).toBe("000000");
    expect(DEFAULTS.accent).toBe("white");
    expect(DEFAULTS.timeZone).toBe("America/Los_Angeles");
  });
});

describe("getSettings", () => {
  it("returns DEFAULTS when the row is absent", async () => {
    const s = await getSettings(fakeDb(undefined));
    expect(s).toEqual(DEFAULTS);
  });

  it("merges a legacy blob (missing a field) over DEFAULTS", async () => {
    // A row written before the accent field existed.
    const legacy = { pinCode: "123456", timeZone: "Europe/London" };
    const s = await getSettings(fakeDb(legacy));
    expect(s.pinCode).toBe("123456");
    expect(s.timeZone).toBe("Europe/London");
    expect(s.accent).toBe(DEFAULTS.accent);
  });

  it("silently drops a stored blob's retired fields", async () => {
    // The Simplification (§6) retired every synced field except pinCode, accent
    // and timeZone , idle dim, lock screen, snap mode, the minimap, the PIN-pad
    // layout, the typeface and the goal-day cutoff. Rows written before that
    // still carry these keys; settingsSchema has no `.strict()`, so zod strips
    // them rather than throwing, and getSettings must not surface them.
    const legacyBlob = {
      ...DEFAULTS,
      activeBrightness: 1,
      idleDimEnabled: true,
      idleDimTimeoutMs: 600_000,
      idleDimLevel: 0.25,
      lockScreenEnabled: true,
      lockScreenBlurPercent: 10,
      showFps: false,
      showBuildBadge: true,
      showBuildNumber: false,
      snapMode: "mandatory-settle",
      showMinimap: true,
      pinPadLayout: "scrambled-per-key",
      typeface: "sf",
      goalDayCutoffHour: 3,
    };
    const s = await getSettings(fakeDb(legacyBlob));
    expect(s).toEqual(DEFAULTS);
    expect(s).not.toHaveProperty("activeBrightness");
    expect(s).not.toHaveProperty("idleDimEnabled");
    expect(s).not.toHaveProperty("snapMode");
    expect(s).not.toHaveProperty("showMinimap");
    expect(s).not.toHaveProperty("pinPadLayout");
    expect(s).not.toHaveProperty("typeface");
    expect(s).not.toHaveProperty("goalDayCutoffHour");
  });

  it("falls back to DEFAULTS for a stored blob that fails validation", async () => {
    // An out-of-shape stored value (e.g. a malformed pinCode) fails validation ,
    // which getSettings catches, logs, and answers with DEFAULTS rather than
    // propagating.
    const s = await getSettings(fakeDb({ ...DEFAULTS, pinCode: "not-six-digits" }));
    expect(s).toEqual(DEFAULTS);
  });
});
