import { describe, expect, it } from "vitest";

import { COMMAND_WINDOW_MS } from "./command-window";
import { DeviceKind } from "./schema";
import type { DeviceStateStore } from "./store";

/**
 * Behavior contract every `DeviceStateStore` implementation must satisfy —
 * ported from `api/src/__tests__/desired-state-store.test.ts` (upsert/update
 * matrix) plus the newer read/seed/reported/clear ops. Run it against each
 * adapter via `runDeviceStateStoreContract(() => createAdapter())`.
 */
export function runDeviceStateStoreContract(
  makeStore: () => Promise<DeviceStateStore> | DeviceStateStore,
): void {
  async function freshStore(): Promise<DeviceStateStore> {
    return await makeStore();
  }

  const lampInput = {
    id: "lgt_globe",
    kind: DeviceKind.Light,
    entityId: "light.living_room_globe",
    domain: "light",
    label: "Globe",
    desired: { on: true, brightness: 200 },
  } as const;

  describe("upsertDesired", () => {
    it("creates a full row on first sight: available:true, desiredAtUtc set, default command window", async () => {
      const store = await freshStore();
      const before = Date.now();

      await store.upsertDesired({ ...lampInput });

      const row = await store.read(lampInput.id);
      expect(row).not.toBeNull();
      expect(row).toMatchObject({
        id: "lgt_globe",
        kind: "light",
        entityId: "light.living_room_globe",
        domain: "light",
        label: "Globe",
        desiredState: { on: true, brightness: 200 },
        available: true,
      });
      const at = (row?.desiredAtUtc as Date).getTime();
      const until = (row?.desiredUntilUtc as Date).getTime();
      expect(at).toBeGreaterThanOrEqual(before);
      expect(until).toBe(at + COMMAND_WINDOW_MS);
    });

    it("honors a custom windowMs override", async () => {
      const store = await freshStore();

      await store.upsertDesired({ ...lampInput, windowMs: 60_000 });

      const row = await store.read(lampInput.id);
      const at = (row?.desiredAtUtc as Date).getTime();
      const until = (row?.desiredUntilUtc as Date).getTime();
      expect(until).toBe(at + 60_000);
    });

    it("on an existing entityId overwrites ONLY the desired columns (+ window)", async () => {
      const store = await freshStore();
      await store.seed({
        id: lampInput.id,
        kind: lampInput.kind,
        entityId: lampInput.entityId,
        domain: lampInput.domain,
        label: "Original Label",
        reported: { on: false, brightness: 50 },
        available: true,
      });

      await store.upsertDesired({ ...lampInput, desired: { on: true, brightness: 200 } });

      const row = await store.read(lampInput.id);
      expect(row?.label).toBe("Original Label");
      expect(row?.reportedState).toEqual({ on: false, brightness: 50 });
      expect(row?.available).toBe(true);
      expect(row?.desiredState).toEqual({ on: true, brightness: 200 });
      expect(row?.desiredAtUtc).not.toBeNull();
      expect(row?.desiredUntilUtc).not.toBeNull();
    });
  });

  describe("updateDesired", () => {
    it("is a silent no-op when the row does not exist", async () => {
      const store = await freshStore();

      await expect(
        store.updateDesired({ id: "missing", desired: { mode: "off" } }),
      ).resolves.toBeUndefined();
      expect(await store.read("missing")).toBeNull();
    });

    it("on an existing id updates the desired triple only", async () => {
      const store = await freshStore();
      await store.seed({
        id: "climate-thermostat",
        kind: DeviceKind.Climate,
        entityId: "climate.thermostat",
        domain: "climate",
        label: "Thermostat",
        reported: { mode: "off" },
        available: true,
      });
      const before = Date.now();

      await store.updateDesired({
        id: "climate-thermostat",
        desired: { mode: "cool", target: 70 },
      });

      const row = await store.read("climate-thermostat");
      expect(row?.desiredState).toEqual({ mode: "cool", target: 70 });
      expect(row?.label).toBe("Thermostat");
      expect(row?.reportedState).toEqual({ mode: "off" });
      const at = (row?.desiredAtUtc as Date).getTime();
      const until = (row?.desiredUntilUtc as Date).getTime();
      expect(at).toBeGreaterThanOrEqual(before);
      expect(until).toBe(at + COMMAND_WINDOW_MS);
    });
  });

  describe("seed", () => {
    it("inserts a new row with no data: reportedAtUtc/desiredAtUtc stay null", async () => {
      const store = await freshStore();

      await store.seed({
        id: "lgt_seeded",
        kind: DeviceKind.Light,
        entityId: "light.seeded",
        domain: "light",
        label: "Seeded",
        available: false,
      });

      const row = await store.read("lgt_seeded");
      expect(row).toMatchObject({
        id: "lgt_seeded",
        entityId: "light.seeded",
        label: "Seeded",
        available: false,
        desiredState: null,
        reportedState: null,
        reportedAtUtc: null,
        desiredAtUtc: null,
      });
    });

    it("stamps reportedAtUtc/desiredAtUtc to `now` only for the data actually provided", async () => {
      const store = await freshStore();
      const now = new Date("2026-01-01T00:00:00Z");

      await store.seed({
        id: "lgt_seeded",
        kind: DeviceKind.Light,
        entityId: "light.seeded",
        domain: "light",
        label: "Seeded",
        reported: { on: true },
        available: true,
        now,
      });

      const row = await store.read("lgt_seeded");
      expect(row?.reportedState).toEqual({ on: true });
      expect(row?.reportedAtUtc).toEqual(now);
      // No `desired` given → desiredState/desiredAtUtc stay null.
      expect(row?.desiredState).toBeNull();
      expect(row?.desiredAtUtc).toBeNull();
    });

    it("mirror: stamps desiredAtUtc only, when only `desired` is provided (no `reported`)", async () => {
      const store = await freshStore();
      const now = new Date("2026-01-01T00:00:00Z");

      await store.seed({
        id: "lgt_seeded",
        kind: DeviceKind.Light,
        entityId: "light.seeded",
        domain: "light",
        label: "Seeded",
        desired: { on: false },
        available: true,
        now,
      });

      const row = await store.read("lgt_seeded");
      expect(row?.desiredState).toEqual({ on: false });
      expect(row?.desiredAtUtc).toEqual(now);
      // No `reported` given → reportedState/reportedAtUtc stay null.
      expect(row?.reportedState).toBeNull();
      expect(row?.reportedAtUtc).toBeNull();
    });

    it("is a no-op when the entityId already exists (first write wins)", async () => {
      const store = await freshStore();
      await store.seed({
        id: "lgt_seeded",
        kind: DeviceKind.Light,
        entityId: "light.seeded",
        domain: "light",
        label: "First",
        available: true,
      });

      await store.seed({
        id: "lgt_seeded_2",
        kind: DeviceKind.Light,
        entityId: "light.seeded",
        domain: "light",
        label: "Second",
        available: false,
      });

      const first = await store.read("lgt_seeded");
      const second = await store.read("lgt_seeded_2");
      expect(first?.label).toBe("First");
      expect(second).toBeNull();
    });
  });

  describe("writeReported", () => {
    async function seedRow(store: DeviceStateStore): Promise<void> {
      await store.seed({
        id: "lgt_globe",
        kind: DeviceKind.Light,
        entityId: "light.living_room_globe",
        domain: "light",
        label: "Globe",
        available: false,
      });
    }

    it("sets reportedState/reportedAtUtc/available/updatedAtUtc", async () => {
      const store = await freshStore();
      await seedRow(store);
      const now = new Date("2026-01-01T00:00:00Z");

      await store.writeReported({
        id: "lgt_globe",
        reported: { on: true, brightness: 100 },
        available: true,
        now,
      });

      const row = await store.read("lgt_globe");
      expect(row?.reportedState).toEqual({ on: true, brightness: 100 });
      expect(row?.reportedAtUtc).toEqual(now);
      expect(row?.available).toBe(true);
      expect(row?.updatedAtUtc).toEqual(now);
      expect(row?.reportedChangedAtUtc).toBeNull();
    });

    it("changed:true additionally stamps reportedChangedAtUtc", async () => {
      const store = await freshStore();
      await seedRow(store);
      const now = new Date("2026-01-01T00:00:00Z");

      await store.writeReported({
        id: "lgt_globe",
        reported: { on: true },
        available: true,
        changed: true,
        now,
      });

      const row = await store.read("lgt_globe");
      expect(row?.reportedChangedAtUtc).toEqual(now);
    });

    it("changed absent/false leaves reportedChangedAtUtc untouched", async () => {
      const store = await freshStore();
      await seedRow(store);
      const first = new Date("2026-01-01T00:00:00Z");
      await store.writeReported({
        id: "lgt_globe",
        reported: { on: true },
        available: true,
        changed: true,
        now: first,
      });

      const second = new Date("2026-01-01T00:01:00Z");
      await store.writeReported({
        id: "lgt_globe",
        reported: { on: true, brightness: 5 },
        available: true,
        changed: false,
        now: second,
      });

      const row = await store.read("lgt_globe");
      expect(row?.reportedChangedAtUtc).toEqual(first);
      expect(row?.reportedState).toEqual({ on: true, brightness: 5 });
    });

    it("adoptDesired also sets desiredState+desiredAtUtc and leaves desiredUntilUtc alone", async () => {
      const store = await freshStore();
      await store.upsertDesired({ ...lampInput, windowMs: 60_000 });
      const before = await store.read(lampInput.id);
      const now = new Date("2026-01-01T00:00:00Z");

      await store.writeReported({
        id: lampInput.id,
        reported: { on: false },
        available: true,
        adoptDesired: { on: false },
        now,
      });

      const row = await store.read(lampInput.id);
      expect(row?.desiredState).toEqual({ on: false });
      expect(row?.desiredAtUtc).toEqual(now);
      expect(row?.desiredUntilUtc).toEqual(before?.desiredUntilUtc);
    });
  });

  describe("clearDesired", () => {
    it("nulls desiredState/desiredAtUtc/desiredUntilUtc, leaves reported intact", async () => {
      const store = await freshStore();
      await store.upsertDesired({ ...lampInput });
      await store.writeReported({
        id: lampInput.id,
        reported: { on: true, brightness: 200 },
        available: true,
      });

      await store.clearDesired(lampInput.id);

      const row = await store.read(lampInput.id);
      expect(row?.desiredState).toBeNull();
      expect(row?.desiredAtUtc).toBeNull();
      expect(row?.desiredUntilUtc).toBeNull();
      expect(row?.reportedState).toEqual({ on: true, brightness: 200 });
    });

    it("is a no-op when the row does not exist", async () => {
      const store = await freshStore();
      await expect(store.clearDesired("missing")).resolves.toBeUndefined();
    });
  });

  describe("list", () => {
    async function seedThree(store: DeviceStateStore): Promise<void> {
      await store.seed({
        id: "lgt_a",
        kind: DeviceKind.Light,
        entityId: "light.a",
        domain: "light",
        label: "A",
        available: true,
      });
      await store.seed({
        id: "lgt_b",
        kind: DeviceKind.Light,
        entityId: "light.b",
        domain: "light",
        label: "B",
        available: true,
      });
      await store.seed({
        id: "climate_c",
        kind: DeviceKind.Climate,
        entityId: "climate.c",
        domain: "climate",
        label: "C",
        available: true,
      });
    }

    it("list() returns all rows", async () => {
      const store = await freshStore();
      await seedThree(store);

      const rows = await store.list();
      expect(rows.map((r) => r.id).sort()).toEqual(["climate_c", "lgt_a", "lgt_b"]);
    });

    it("list({kind}) filters by kind", async () => {
      const store = await freshStore();
      await seedThree(store);

      const rows = await store.list({ kind: DeviceKind.Light });
      expect(rows.map((r) => r.id).sort()).toEqual(["lgt_a", "lgt_b"]);
    });

    it("list({entityIds}) filters by entityId set", async () => {
      const store = await freshStore();
      await seedThree(store);

      const rows = await store.list({ entityIds: ["light.a", "climate.c"] });
      expect(rows.map((r) => r.id).sort()).toEqual(["climate_c", "lgt_a"]);
    });
  });

  describe("listExpiredWindows", () => {
    it("returns only rows with a non-null desiredUntilUtc < now", async () => {
      const store = await freshStore();
      await store.seed({
        id: "no_window",
        kind: DeviceKind.Light,
        entityId: "light.no_window",
        domain: "light",
        label: "No Window",
        available: true,
      });
      await store.upsertDesired({
        id: "expired",
        kind: DeviceKind.Light,
        entityId: "light.expired",
        domain: "light",
        label: "Expired",
        desired: { on: true },
        windowMs: -1000,
      });
      await store.upsertDesired({
        id: "open",
        kind: DeviceKind.Light,
        entityId: "light.open",
        domain: "light",
        label: "Open",
        desired: { on: true },
        windowMs: 60_000,
      });

      const rows = await store.listExpiredWindows(new Date());

      expect(rows.map((r) => r.id)).toEqual(["expired"]);
    });
  });

  describe("readEffective", () => {
    it("returns null for a missing row", async () => {
      const store = await freshStore();
      expect(await store.readEffective("missing")).toBeNull();
    });

    it("overlays desired per-field onto reported (bare on/off keeps reported brightness/color)", async () => {
      const store = await freshStore();
      await store.seed({
        id: lampInput.id,
        kind: lampInput.kind,
        entityId: lampInput.entityId,
        domain: lampInput.domain,
        label: lampInput.label,
        reported: { on: false, brightness: 128, color: { kelvin: 3000 } },
        available: true,
      });

      await store.updateDesired({ id: lampInput.id, desired: { on: true } });

      const effective = await store.readEffective(lampInput.id);
      expect(effective?.state).toEqual({ on: true, brightness: 128, color: { kelvin: 3000 } });
      expect(effective?.available).toBe(true);
    });

    it("is pending while a specified desired field has not converged with reported", async () => {
      const store = await freshStore();
      await store.seed({
        id: lampInput.id,
        kind: lampInput.kind,
        entityId: lampInput.entityId,
        domain: lampInput.domain,
        label: lampInput.label,
        reported: { on: true, brightness: 50 },
        available: true,
      });

      await store.updateDesired({ id: lampInput.id, desired: { on: true, brightness: 200 } });

      const effective = await store.readEffective(lampInput.id);
      expect(effective?.pending).toBe(true);
    });

    it("is not pending once desired and reported converge", async () => {
      const store = await freshStore();
      await store.seed({
        id: lampInput.id,
        kind: lampInput.kind,
        entityId: lampInput.entityId,
        domain: lampInput.domain,
        label: lampInput.label,
        reported: { on: true, brightness: 200 },
        available: true,
      });

      await store.updateDesired({ id: lampInput.id, desired: { on: true, brightness: 200 } });

      const effective = await store.readEffective(lampInput.id);
      expect(effective?.pending).toBe(false);
    });

    it("with no desired, passes reported through untouched with pending false", async () => {
      const store = await freshStore();
      await store.seed({
        id: lampInput.id,
        kind: lampInput.kind,
        entityId: lampInput.entityId,
        domain: lampInput.domain,
        label: lampInput.label,
        reported: { on: true, brightness: 77 },
        available: true,
      });

      const effective = await store.readEffective(lampInput.id);
      expect(effective).toEqual({
        state: { on: true, brightness: 77 },
        pending: false,
        available: true,
      });
    });
  });

  describe("clone discipline", () => {
    it("mutating a row returned by read() (incl. a nested field) does not affect the store", async () => {
      const store = await freshStore();
      await store.seed({
        id: lampInput.id,
        kind: lampInput.kind,
        entityId: lampInput.entityId,
        domain: lampInput.domain,
        label: lampInput.label,
        reported: { on: true, brightness: 128, color: { kelvin: 3000 } },
        available: true,
      });

      const row = await store.read(lampInput.id);
      expect(row).not.toBeNull();
      // biome-ignore lint/style/noNonNullAssertion: asserted non-null above
      row!.label = "mutated";
      // biome-ignore lint/style/noNonNullAssertion: asserted non-null above
      (row!.reportedState as { color?: { kelvin?: number } }).color!.kelvin = 9999;

      const reRead = await store.read(lampInput.id);
      expect(reRead?.label).toBe(lampInput.label);
      expect(reRead?.reportedState).toEqual({ on: true, brightness: 128, color: { kelvin: 3000 } });
    });

    it("mutating a row returned by list() (incl. a nested field) does not affect the store", async () => {
      const store = await freshStore();
      await store.seed({
        id: lampInput.id,
        kind: lampInput.kind,
        entityId: lampInput.entityId,
        domain: lampInput.domain,
        label: lampInput.label,
        reported: { on: true, brightness: 128, color: { kelvin: 3000 } },
        available: true,
      });

      const [row] = await store.list();
      expect(row).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: asserted defined above
      (row!.reportedState as { color?: { kelvin?: number } }).color!.kelvin = 9999;

      const reRead = await store.read(lampInput.id);
      expect(reRead?.reportedState).toEqual({ on: true, brightness: 128, color: { kelvin: 3000 } });
    });

    it("mutating readEffective's state (desired-only path, no reported) does not affect the store", async () => {
      const store = await freshStore();
      await store.upsertDesired({
        ...lampInput,
        desired: { on: true, brightness: 200, color: { kelvin: 2700 } },
      });

      const effective = await store.readEffective(lampInput.id);
      expect(effective?.state).not.toBeNull();
      const state = effective?.state as { color?: { kelvin?: number } };
      // biome-ignore lint/style/noNonNullAssertion: asserted not-null above
      state.color!.kelvin = 9999;

      const reRead = await store.readEffective(lampInput.id);
      expect(reRead?.state).toEqual({ on: true, brightness: 200, color: { kelvin: 2700 } });
    });

    it("mutating readEffective's state (overlay path, unoverridden nested field) does not affect the store", async () => {
      const store = await freshStore();
      await store.seed({
        id: lampInput.id,
        kind: lampInput.kind,
        entityId: lampInput.entityId,
        domain: lampInput.domain,
        label: lampInput.label,
        reported: { on: false, brightness: 128, color: { kelvin: 3000 } },
        available: true,
      });
      await store.updateDesired({ id: lampInput.id, desired: { on: true } });

      const effective = await store.readEffective(lampInput.id);
      const state = effective?.state as { color?: { kelvin?: number } };
      expect(state?.color).toEqual({ kelvin: 3000 });
      // biome-ignore lint/style/noNonNullAssertion: asserted above via toEqual
      state.color!.kelvin = 9999;

      const reRead = await store.readEffective(lampInput.id);
      expect((reRead?.state as { color?: { kelvin?: number } })?.color).toEqual({ kelvin: 3000 });
      const rawRow = await store.read(lampInput.id);
      expect(rawRow?.reportedState).toEqual({
        on: false,
        brightness: 128,
        color: { kelvin: 3000 },
      });
    });
  });
}
