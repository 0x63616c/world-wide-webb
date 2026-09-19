import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  deviceIdSchema,
  deviceSettingsSchema,
  getDeviceSettings,
  updateDeviceSettings,
} from "../services/device-settings-service";

// Same hand-rolled fake as settings-service.test: the db is an argument, so
// standing in for the `select().from().where().limit()` chain is enough. The
// insert side additionally records what was upserted so the merge can be
// asserted without a real database.
function fakeDb(storedValue: unknown) {
  const upserts: unknown[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(storedValue === undefined ? [] : [{ value: storedValue }]),
        }),
      }),
    }),
    insert: () => ({
      values: (row: unknown) => ({
        onConflictDoUpdate: () => {
          upserts.push(row);
          return Promise.resolve();
        },
      }),
    }),
    // biome-ignore lint/suspicious/noExplicitAny: minimal stand-in for the drizzle db
  } as any;
  return { db, upserts };
}

describe("device-settings DEFAULTS", () => {
  it("defaults the name to empty (not yet set)", () => {
    expect(DEFAULTS.name).toBe("");
  });
});

describe("getDeviceSettings", () => {
  it("returns DEFAULTS for a panel with no row yet", async () => {
    const { db } = fakeDb(undefined);
    expect(await getDeviceSettings(db, "ipad13-1-3f9a2c1b")).toEqual(DEFAULTS);
  });

  it("returns the stored value when a row exists", async () => {
    const { db } = fakeDb({ name: "Calum's iPad" });
    expect((await getDeviceSettings(db, "ipad13-1-3f9a2c1b")).name).toBe("Calum's iPad");
  });

  it("merges a blob missing a newly-added field over DEFAULTS", async () => {
    // A row written before any future field existed: name survives, the rest
    // falls back rather than failing validation.
    const { db } = fakeDb({ name: "Calum's iPad" });
    const s = await getDeviceSettings(db, "ipad13-1-3f9a2c1b");
    expect(s).toEqual({ ...DEFAULTS, name: "Calum's iPad" });
  });

  it("returns the empty-string name default for a row with no name key", async () => {
    const { db } = fakeDb({});
    const s = await getDeviceSettings(db, "ipad13-1-3f9a2c1b");
    expect(s.name).toBe("");
  });

  it("falls back to DEFAULTS rather than throwing when the read fails", async () => {
    const db = {
      select: () => {
        throw new Error("connection refused");
      },
      // biome-ignore lint/suspicious/noExplicitAny: minimal stand-in for the drizzle db
    } as any;
    expect(await getDeviceSettings(db, "ipad13-1-3f9a2c1b")).toEqual(DEFAULTS);
  });
});

describe("updateDeviceSettings", () => {
  it("patches the device name", async () => {
    const { db, upserts } = fakeDb({ name: "" });
    const next = await updateDeviceSettings(db, "ipad13-1-3f9a2c1b", { name: "Calum's iPad" });
    expect(next.name).toBe("Calum's iPad");
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      deviceId: "ipad13-1-3f9a2c1b",
      value: { name: "Calum's iPad" },
    });
  });

  it("rejects an over-length name rather than persisting it", async () => {
    const { db, upserts } = fakeDb(undefined);
    await expect(
      updateDeviceSettings(db, "ipad13-1-3f9a2c1b", { name: "x".repeat(61) }),
    ).rejects.toThrow();
    expect(upserts).toHaveLength(0);
  });
});

describe("bounds", () => {
  it("accepts an empty name (not yet set)", () => {
    expect(deviceSettingsSchema.parse({ name: "" }).name).toBe("");
  });

  it("trims a name before validating its length", () => {
    expect(deviceSettingsSchema.parse({ name: "  Calum's iPad  " }).name).toBe("Calum's iPad");
  });

  it("rejects an empty device id so junk rows cannot be created", () => {
    expect(() => deviceIdSchema.parse("")).toThrow();
  });
});
