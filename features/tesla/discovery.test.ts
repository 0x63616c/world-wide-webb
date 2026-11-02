import type { HaEntity } from "@www/core";
import { describe, expect, it, vi } from "vitest";
import { TESLA_ENTITY_PREFIX as prefix } from "../ac/config";
import { teslaStateSchema } from "./contract";
import { discoverTeslaEntities } from "./discovery";
import { createTeslaService } from "./service";

function entity(domain: string, name: string, unit?: string, deviceClass?: string): HaEntity {
  return {
    entity_id: `${domain}.${prefix}_${name}`,
    state: "0",
    attributes: { unit_of_measurement: unit, device_class: deviceClass },
    last_updated: "2026-01-01T00:00:00Z",
  };
}
function fleet() {
  return [
    entity("sensor", "battery_level", "%", "battery"),
    entity("sensor", "battery_range", "mi", "distance"),
    entity("sensor", "charging", undefined, "enum"),
    entity("sensor", "charger_power", "kW", "power"),
    entity("sensor", "odometer", "mi", "distance"),
    entity("sensor", "inside_temperature", "°F", "temperature"),
    entity("lock", "lock"),
    entity("climate", "climate"),
    entity("switch", "charge"),
  ];
}
describe("Tesla entity discovery", () => {
  it("matches Fleet/Teslemetry names with deterministic priority over misleading entities", () => {
    const all = fleet();
    const distractions = [
      entity("sensor", "usable_battery_level", "%", "battery"),
      entity("sensor", "estimate_battery_range", "mi"),
      entity("sensor", "ideal_battery_range", "mi"),
      entity("sensor", "outside_temperature", "°F"),
      entity("sensor", "charger_voltage", "V"),
      entity("sensor", "charge_energy_added", "kWh"),
      entity("binary_sensor", "charging"),
      entity("lock", "charge_cable_lock"),
      entity("climate", "cabin_overheat_protection"),
      entity("switch", "scheduled_charge"),
      entity("switch", "charge_port"),
    ];
    const expected = discoverTeslaEntities(all);
    expect(expected.missing).toEqual([]);
    expect(Object.values(expected.entities ?? {})).toEqual(all.map((e) => e.entity_id));
    expect(discoverTeslaEntities([...distractions, ...all].reverse())).toEqual(expected);
  });
  it("supports legacy custom integration and API path suffixes", () => {
    const all = fleet();
    all[0] = entity("sensor", "battery", "%");
    all[1] = entity("sensor", "range", "km");
    all[2] = entity("binary_sensor", "charging");
    all[3] = entity("sensor", "charging_power", "W");
    all[5] = entity("sensor", "temperature_inside", "°C");
    all[8] = entity("switch", "charger");
    expect(discoverTeslaEntities(all).missing).toEqual([]);
    all[2] = entity("sensor", "charge_state_charging_state");
    all[5] = entity("sensor", "climate_state_inside_temp", "°C");
    expect(discoverTeslaEntities(all).missing).toEqual([]);
  });
  it("falls back to battery metadata and safe vehicle lock/climate names", () => {
    const all = fleet();
    all[0] = entity("sensor", "state_of_charge", "%", "battery");
    all[6] = entity("lock", "vehicle");
    all[7] = entity("climate", "vehicle");
    expect(discoverTeslaEntities(all).missing).toEqual([]);
  });
  it("restricts matching to the exact object-id prefix and correct domains/units", () => {
    const all = fleet();
    for (const altered of [
      all.map((e) => ({ ...e, entity_id: e.entity_id.replace(`${prefix}_`, `${prefix}2_`) })),
      all.map((e) => ({ ...e, entity_id: e.entity_id.replace(`${prefix}_`, `other_${prefix}_`) })),
      all.map((e) => ({ ...e, entity_id: e.entity_id.replace(/^[^.]+/, "number") })),
    ])
      expect(discoverTeslaEntities(altered).missing).toHaveLength(9);
    expect(discoverTeslaEntities(all.map((e) => ({ ...e, attributes: {} }))).missing).toEqual([
      "battery",
      "range",
      "power",
      "odometer",
      "temperature",
    ]);
  });
  it("reports every missing role in stable contract order", () => {
    const all = fleet().filter((e) => !/battery_range|odometer/.test(e.entity_id));
    expect(discoverTeslaEntities(all)).toEqual({ entities: null, missing: ["range", "odometer"] });
  });
});

function setup() {
  const all = fleet();
  for (const e of all) {
    if (e.entity_id.startsWith("lock.")) e.state = "locked";
    if (e.entity_id.startsWith("climate.")) e.state = "off";
    if (e.entity_id.endsWith("_charging")) e.state = "charging";
  }
  const client = {
    isConfigured: () => true,
    getAllEntities: vi.fn(async () => all),
    getEntity: vi.fn(async (id: string) => all.find((e) => e.entity_id === id) as HaEntity),
    callService: vi.fn(async () => {}),
  };
  return { all, client, service: createTeslaService(client, () => null) };
}
describe("discovery lifecycle", () => {
  it("caches shared state/command discovery for five minutes and coalesces concurrent reads", async () => {
    const { service, client } = setup();
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      expect((await Promise.all([service.state(), service.state()])).map((s) => s.status)).toEqual([
        "ready",
        "ready",
      ]);
      await service.command("chargeStart");
      expect(client.callService).toHaveBeenCalledWith("switch", "turn_on", {
        entity_id: `switch.${prefix}_charge`,
      });
      now.mockReturnValue(300999);
      await service.state();
      expect(client.getAllEntities).toHaveBeenCalledTimes(1);
      now.mockReturnValue(301001);
      await service.state();
      expect(client.getAllEntities).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });
  it("valid explicit configuration takes precedence over discovery", async () => {
    const { client, all } = setup();
    const ids = discoverTeslaEntities(all).entities;
    const service = createTeslaService(client, () => ids);
    expect((await service.state()).status).toBe("ready");
    await service.command("unlock");
    expect(client.getAllEntities).not.toHaveBeenCalled();
  });
  it("retries incomplete discovery and returns a backward-compatible reason", async () => {
    const { client, service, all } = setup();
    client.getAllEntities.mockResolvedValueOnce(all.filter((e) => !/_odometer$/.test(e.entity_id)));
    expect(teslaStateSchema.parse(await service.state())).toEqual({
      status: "unavailable",
      reason: "Missing Tesla entities: odometer",
      data: null,
    });
    expect((await service.state()).status).toBe("ready");
    expect(client.getAllEntities).toHaveBeenCalledTimes(2);
  });
  it("invalidates cached discovery after read and command failures, redacting upstream errors", async () => {
    const { client, service } = setup();
    await service.state();
    client.getEntity.mockRejectedValueOnce(new Error("private"));
    expect(await service.state()).toEqual({ status: "unavailable", data: null });
    await service.state();
    client.callService.mockRejectedValueOnce(new Error("private"));
    await expect(service.command("unlock")).rejects.toMatchObject({ message: "" });
    await service.state();
    expect(client.getAllEntities).toHaveBeenCalledTimes(3);
  });
  it("retries after discovery transport failure", async () => {
    const { client, service } = setup();
    client.getAllEntities.mockRejectedValueOnce(new Error("private"));
    expect(await service.state()).toEqual({ status: "unavailable", data: null });
    expect((await service.state()).status).toBe("ready");
  });
  it.each(["on", "off", "unknown"])("normalizes binary charging state %s", async (state) => {
    const { all, client } = setup();
    all[2] = { ...entity("binary_sensor", "charging"), state };
    const result = await createTeslaService(client, () => null).state();
    if (state === "unknown") expect(result.status).toBe("unavailable");
    else
      expect(result).toMatchObject({
        status: "ready",
        data: { chargingState: state === "on" ? "charging" : "stopped" },
      });
  });
  it("does not discover or command when HA is unconfigured", async () => {
    const { client } = setup();
    const service = createTeslaService({ ...client, isConfigured: () => false }, () => null);
    expect(await service.state()).toEqual({ status: "unconfigured", data: null });
    await expect(service.command("unlock")).rejects.toThrow();
    expect(client.getAllEntities).not.toHaveBeenCalled();
    expect(client.callService).not.toHaveBeenCalled();
  });
});
