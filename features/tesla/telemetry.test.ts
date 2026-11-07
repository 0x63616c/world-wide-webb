import { describe, expect, it } from "vitest";
import { teslaEntitiesSchema } from "./contract";
import { readTeslaExtras } from "./telemetry";

const ids = teslaEntitiesSchema.parse({
  battery: "sensor.battery",
  range: "sensor.range",
  charging: "sensor.charging",
  power: "sensor.power",
  odometer: "sensor.odometer",
  temperature: "sensor.temperature",
  lock: "lock.car",
  climate: "climate.car",
  chargeSwitch: "switch.charge",
  shiftState: "sensor.gear",
  vehicleOnline: "binary_sensor.status",
  cableConnected: "binary_sensor.cable",
  chargeLimit: "number.limit",
  chargeCompleteAt: "sensor.complete",
});
function client(states: Record<string, string>, unit = "%") {
  return {
    getEntity: async (id: string) => ({
      entity_id: id,
      state: states[id] ?? "unavailable",
      attributes: { unit_of_measurement: unit },
      last_updated: "2026-11-07T00:00:00Z",
    }),
  };
}
describe("Tesla optional telemetry", () => {
  it.each([
    ["p", "parked"],
    ["D", "driving"],
    ["r", "reversing"],
    ["n", "neutral"],
  ])("reads explicit gear %s", async (gear, expected) => {
    expect((await readTeslaExtras(client({ "sensor.gear": gear }), ids)).driveState).toBe(expected);
  });
  it("never infers parked, connected or a charge limit from unknown or invalid data", async () => {
    const result = await readTeslaExtras(
      client({ "sensor.gear": "unknown", "number.limit": "", "sensor.complete": "tomorrow" }),
      ids,
    );
    expect(Object.values(result).every((v) => v === undefined)).toBe(true);
    expect(
      (await readTeslaExtras(client({ "number.limit": "101" }), ids)).chargeLimitPercent,
    ).toBeUndefined();
    expect(
      (await readTeslaExtras(client({ "number.limit": "80" }, "A"), ids)).chargeLimitPercent,
    ).toBeUndefined();
  });
  it("keeps false and zero and accepts the completion timestamp's offset", async () => {
    expect(
      await readTeslaExtras(
        client({
          "binary_sensor.status": "off",
          "binary_sensor.cable": "on",
          "number.limit": "0",
          "sensor.complete": "2026-11-07T03:00:00-08:00",
        }),
        ids,
      ),
    ).toMatchObject({
      vehicleOnline: false,
      cableConnected: true,
      chargeLimitPercent: 0,
      chargeCompleteAt: "2026-11-07T03:00:00-08:00",
    });
  });
  it("optional read failures do not fail the vehicle snapshot", async () => {
    const result = await readTeslaExtras(
      {
        getEntity: async () => {
          throw new Error("unavailable");
        },
      },
      ids,
    );
    expect(Object.values(result).every((v) => v === undefined)).toBe(true);
  });
});
