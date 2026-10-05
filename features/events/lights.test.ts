import { createHomeAssistantClient, createInMemoryDeviceStateStore, DeviceKind } from "@www/core";
import { describe, expect, it, vi } from "vitest";
import { turnOnAlarmLights } from "./lights";

describe("alarm lighting", () => {
  it("persists desired state so the enforcer will not turn managed lamps back off", async () => {
    const store = createInMemoryDeviceStateStore();
    await store.upsertDesired({
      id: "bed-left",
      kind: DeviceKind.Light,
      entityId: "light.bed_lamp_left",
      domain: "light",
      label: "Bed Left",
      desired: { on: false, brightness: 0 },
    });
    const ha = createHomeAssistantClient({ baseUrl: "http://ha.test", token: "test-only" });
    const call = vi.spyOn(ha, "callService").mockResolvedValue();
    await turnOnAlarmLights("light.bed_lamp_left,switch.overhead_lights", ha, store);
    expect((await store.read("bed-left"))?.desiredState).toEqual({ on: true, brightness: 180 });
    expect((await store.read("overhead"))?.desiredState).toEqual({ on: true });
    expect(call).toHaveBeenCalledWith("light", "turn_on", { entity_id: "light.bed_lamp_left" });
    expect(call).toHaveBeenCalledWith("switch", "turn_on", { entity_id: "switch.overhead_lights" });
  });
  it("adopts the exact states applied by a scene without overwriting unrelated devices", async () => {
    const store = createInMemoryDeviceStateStore();
    const ha = createHomeAssistantClient({ baseUrl: "http://ha.test", token: "test-only" });
    vi.spyOn(ha, "getEntity").mockResolvedValue({
      entity_id: "scene.morning",
      state: "scening",
      attributes: { entity_id: ["light.bed_lamp_left"] },
      last_updated: "2026-10-05T16:00:00Z",
    });
    vi.spyOn(ha, "activateScene").mockResolvedValue([
      {
        entity_id: "light.bed_lamp_left",
        state: "on",
        attributes: { brightness: 200 },
        last_updated: "2026-10-05T16:00:00Z",
      },
      {
        entity_id: "light.desk",
        state: "on",
        attributes: { brightness: 20 },
        last_updated: "2026-10-05T16:00:00Z",
      },
    ]);
    await turnOnAlarmLights("scene.morning", ha, store);
    expect((await store.read("bed-left"))?.desiredState).toMatchObject({
      on: true,
      brightness: 200,
    });
    expect(await store.read("desk")).toBeNull();
  });
  it("propagates HA failures to the durable retry path", async () => {
    const ha = createHomeAssistantClient({ baseUrl: "http://ha.test", token: "test-only" });
    vi.spyOn(ha, "callService").mockRejectedValue(new Error("HA unavailable"));
    await expect(
      turnOnAlarmLights("light.bed_lamp_left", ha, createInMemoryDeviceStateStore()),
    ).rejects.toThrow("HA unavailable");
  });
});
