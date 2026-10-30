import type { HaEntity } from "@www/core";
import { describe, expect, it, vi } from "vitest";
import { type TeslaAction, type TeslaEntities, teslaStateSchema } from "./contract";
import { createTeslaService, parseEntities, TeslaUnavailable } from "./service";

const ids: TeslaEntities = {
  battery: "sensor.test_battery",
  range: "sensor.test_range",
  charging: "sensor.test_charging",
  power: "sensor.test_power",
  odometer: "sensor.test_odometer",
  temperature: "sensor.test_temperature",
  climate: "climate.test_car",
  lock: "lock.test_car",
  chargeSwitch: "switch.test_charge",
};
function fixture() {
  const values: Record<string, [string, string?]> = {
    [ids.battery]: ["72", "%"],
    [ids.range]: ["321.8688", "km"],
    [ids.charging]: ["charging"],
    [ids.power]: ["7000", "W"],
    [ids.odometer]: ["16093.44", "km"],
    [ids.temperature]: ["20", "°C"],
    [ids.lock]: ["locked"],
    [ids.climate]: ["off"],
  };
  const client = {
    isConfigured: () => true,
    getEntity: vi.fn(async (id: string): Promise<HaEntity> => {
      const [state, unit] = values[id] ?? ["unavailable"];
      return {
        entity_id: id,
        state,
        attributes: { unit_of_measurement: unit },
        last_updated: "2026-01-01T00:00:00Z",
      };
    }),
    callService: vi.fn(async () => {}),
  };
  return { values, client, service: createTeslaService(client, () => ids) };
}
describe("Tesla HA adapter", () => {
  it("requires explicit complete domain-checked config, never discovers a vehicle by name", async () => {
    for (const raw of [undefined, "", "{", "{}", JSON.stringify({ ...ids, lock: "switch.wrong" })])
      expect(parseEntities(raw)).toBeNull();
    expect(parseEntities(JSON.stringify(ids))).toEqual(ids);
    const { client } = fixture();
    expect(await createTeslaService(client, () => null).state()).toEqual({
      status: "unconfigured",
      data: null,
    });
    expect(client.getEntity).not.toHaveBeenCalled();
    expect(
      await createTeslaService({ ...client, isConfigured: () => false }, () => ids).state(),
    ).toEqual({ status: "unconfigured", data: null });
    await expect(createTeslaService(client, () => null).command("unlock")).rejects.toBeInstanceOf(
      TeslaUnavailable,
    );
    expect(client.callService).not.toHaveBeenCalled();
  });
  it("normalizes reported units and matches the synthetic native wire fixture", async () => {
    const { service } = fixture();
    const result = teslaStateSchema.parse(await service.state());
    expect(result).toEqual({
      status: "ready",
      data: {
        batteryPercent: 72,
        rangeMiles: 200,
        chargingState: "charging",
        chargePowerKW: 7,
        locked: true,
        climateOn: false,
        cabinFahrenheit: 68,
        odometerMiles: 10000,
      },
    });
  });
  it("accepts zero/off and imperial units without inventing activity", async () => {
    const { values, service } = fixture();
    values[ids.battery] = ["0", "%"];
    values[ids.range] = ["0", "mi"];
    values[ids.power] = ["0", "kW"];
    values[ids.odometer] = ["120", "mi"];
    values[ids.charging] = ["Disconnected"];
    values[ids.temperature] = ["32", "°F"];
    values[ids.lock] = ["unlocked"];
    expect(await service.state()).toMatchObject({
      status: "ready",
      data: {
        batteryPercent: 0,
        rangeMiles: 0,
        chargingState: "disconnected",
        chargePowerKW: 0,
        locked: false,
        cabinFahrenheit: 32,
        odometerMiles: 120,
      },
    });
  });
  it.each([
    [ids.battery, "unknown", "%"],
    [ids.battery, "", "%"],
    [ids.battery, "101", "%"],
    [ids.range, "200", "meters"],
    [ids.lock, "locking", ""],
    [ids.climate, "unavailable", ""],
    [ids.charging, "future-state", ""],
    [ids.power, "8", "volts"],
    [ids.temperature, "20", "K"],
    [ids.odometer, "-1", "mi"],
  ])("fails closed for bad telemetry %s %s", async (id, value, unit) => {
    const { values, service } = fixture();
    values[id] = [value, unit];
    expect(await service.state()).toEqual({ status: "unavailable", data: null });
  });
  it.each([
    ["lock", "lock", "lock", ids.lock],
    ["unlock", "lock", "unlock", ids.lock],
    ["climateOn", "climate", "turn_on", ids.climate],
    ["climateOff", "climate", "turn_off", ids.climate],
    ["chargeStart", "switch", "turn_on", ids.chargeSwitch],
    ["chargeStop", "switch", "turn_off", ids.chargeSwitch],
  ])("only dispatches the configured target for %s", async (action, domain, serviceName, id) => {
    const { service, client } = fixture();
    expect(await service.command(action as TeslaAction)).toEqual({ accepted: true });
    expect(client.callService).toHaveBeenCalledWith(domain, serviceName, { entity_id: id });
    expect(client.getEntity).not.toHaveBeenCalled();
  });
  it("redacts HA failures and never reports a failed write as accepted", async () => {
    const { service, client } = fixture();
    client.getEntity.mockRejectedValue(new Error("private upstream response"));
    expect(await service.state()).toEqual({ status: "unavailable", data: null });
    client.callService.mockRejectedValue(new Error("private upstream response"));
    await expect(service.command("unlock")).rejects.toMatchObject({ message: "" });
  });
});
