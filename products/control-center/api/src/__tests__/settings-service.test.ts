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
  it("carries the minimap + PIN defaults", () => {
    expect(DEFAULTS.showMinimap).toBe(true);
    expect(DEFAULTS.pinCode).toBe("000000");
    expect(DEFAULTS.pinLockSettings).toBe(true);
    expect(DEFAULTS.pinLockWakePhotos).toBe(true);
  });
});

describe("getSettings", () => {
  it("returns DEFAULTS when the row is absent", async () => {
    const s = await getSettings(fakeDb(undefined));
    expect(s).toEqual(DEFAULTS);
  });

  it("merges a legacy blob (missing the new fields) over DEFAULTS", async () => {
    // A row written before the minimap + PIN fields existed.
    const legacy = {
      activeBrightness: 1,
      idleDimEnabled: true,
      idleDimTimeoutMs: 600_000,
      idleDimLevel: 0.25,
      recenterEnabled: true,
      recenterTimeoutMs: 600_000,
      showFps: false,
      showBuildBadge: true,
      snapMode: "mandatory-settle",
    };
    const s = await getSettings(fakeDb(legacy));
    expect(s.showMinimap).toBe(true);
    expect(s.pinCode).toBe("000000");
    expect(s.pinLockSettings).toBe(true);
    expect(s.pinLockWakePhotos).toBe(true);
  });

  it("keeps a stored 1 h idle timeout valid (server cap unchanged)", async () => {
    const s = await getSettings(fakeDb({ ...DEFAULTS, idleDimTimeoutMs: 3_600_000 }));
    expect(s.idleDimTimeoutMs).toBe(3_600_000);
  });
});
