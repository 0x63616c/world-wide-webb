import { createInMemoryDeviceStateStore, DeviceKind, type HaEntity, LIGHTS } from "@www/core";
import { describe, expect, it, vi } from "vitest";
import { createBedroomSwitch, parseInput, verifiedInput } from "./bedroom-switch";
import { BEDROOM_LAMPS, writeLightGroup } from "./light-command";

const entityId = "binary_sensor.test_input"; // Fixture only; production ID remains unverified.
const config = {
  BEDROOM_SWITCH_INPUT_ENABLED: "true",
  BEDROOM_SWITCH_INPUT_VERIFIED: "true",
  BEDROOM_SWITCH_INPUT_ENTITY_ID: entityId,
};
function sample(state: string, ms: number, attributes = {}): HaEntity {
  return {
    entity_id: entityId,
    state,
    attributes,
    last_updated: new Date(ms).toISOString(),
    last_changed: new Date(ms).toISOString(),
  };
}
async function setup(states = [false, false, false]) {
  const store = createInMemoryDeviceStateStore();
  for (const [i, entry] of BEDROOM_LAMPS.entries())
    await store.seed({
      ...entry,
      kind: DeviceKind.Light,
      available: false,
      desired: { on: states[i], brightness: 87, color: { kelvin: 2700 } },
    });
  const binding = createBedroomSwitch(config, store);
  return { store, binding, levels: async () => (await store.list()).map((r) => r.desiredState) };
}

describe("disabled bedroom input", () => {
  it.each([
    {},
    { ...config, BEDROOM_SWITCH_INPUT_ENABLED: "false" },
    { ...config, BEDROOM_SWITCH_INPUT_VERIFIED: "false" },
    { ...config, BEDROOM_SWITCH_INPUT_ENTITY_ID: "" },
    { ...config, BEDROOM_SWITCH_INPUT_ENTITY_ID: LIGHTS[0].entityId },
  ])("does nothing with %j", async (settings) => {
    const store = createInMemoryDeviceStateStore();
    const transaction = vi.spyOn(store, "lightTransaction");
    expect(verifiedInput(settings)).toBeNull();
    const binding = createBedroomSwitch(settings, store);
    await binding.sample(sample("off", 1000), true);
    await binding.sample(sample("on", 2000), false, sample("off", 1000));
    expect(transaction).not.toHaveBeenCalled();
  });
});

it("inverts both edges using desired even when all lamps unavailable, preserving color/brightness/window", async () => {
  const { store, binding, levels } = await setup([false, true, false]);
  await binding.sample(sample("off", 1000), true);
  await binding.sample(sample("on", 2000), false, sample("off", 1000));
  expect(await levels()).toEqual(
    Array(3).fill({ on: false, brightness: 87, color: { kelvin: 2700 } }),
  );
  await binding.sample(sample("off", 2200), false, sample("on", 2000));
  expect(await levels()).toEqual(
    Array(3).fill({ on: true, brightness: 87, color: { kelvin: 2700 } }),
  );
  for (const row of await store.list()) {
    expect(row.available).toBe(false);
    expect((row.desiredUntilUtc?.getTime() ?? 0) - (row.desiredAtUtc?.getTime() ?? 0)).toBe(10_000);
  }
});

it("dedupes replay, contact bounce and keeps rapid legitimate flips", async () => {
  const { binding, levels } = await setup();
  await binding.sample(sample("off", 1000), true);
  await binding.sample(sample("on", 2000), false, sample("off", 1000));
  await binding.sample(sample("on", 2000), false, sample("off", 1000));
  expect((await levels())[0]).toMatchObject({ on: true });
  await binding.sample(sample("off", 2050), false, sample("on", 2000));
  await binding.sample(sample("on", 2090), false, sample("off", 2050));
  expect((await levels())[0]).toMatchObject({ on: true });
  await binding.sample(sample("off", 2200), false, sample("on", 2090));
  expect((await levels())[0]).toMatchObject({ on: false });
});

it.each([
  null,
  sample("unavailable", 1500),
  sample("unknown", 1500),
  sample("on", 1500, { restored: true }),
])("breaks continuity on invalid/missing/restored samples", async (bad) => {
  const { binding, levels } = await setup();
  await binding.sample(sample("off", 1000), true);
  await binding.sample(bad);
  await binding.sample(sample("on", 2000), false, sample("off", 1000));
  expect((await levels())[0]).toMatchObject({ on: false });
  await binding.sample(sample("off", 2500), false, sample("on", 2000));
  expect((await levels())[0]).toMatchObject({ on: true });
});

it("reconnect baselines without recovering offline flips, rejects missing/mismatched old state", async () => {
  const { store, binding, levels } = await setup();
  await binding.sample(sample("off", 1000), true);
  const next = createBedroomSwitch(config, store);
  await next.sample(sample("on", 2000), true);
  await next.sample(sample("off", 3000));
  expect((await levels())[0]).toMatchObject({ on: false });
  await next.sample(sample("on", 4000), false, sample("off", 2500));
  expect((await levels())[0]).toMatchObject({ on: false });
  await next.sample(sample("off", 5000), false, sample("on", 4000));
  expect((await levels())[0]).toMatchObject({ on: true });
});

it("does not guess unseeded lamp intent", async () => {
  const store = createInMemoryDeviceStateStore();
  const binding = createBedroomSwitch(config, store);
  await binding.sample(sample("off", 1000), true);
  await binding.sample(sample("on", 2000), false, sample("off", 1000));
  expect(await store.list()).toEqual([]);
});

it("rolls back partial group and watermark on failure; retry commits once", async () => {
  const { store, binding, levels } = await setup();
  await binding.sample(sample("off", 1000), true);
  const original = store.upsertDesired.bind(store);
  let count = 0;
  const spy = vi.spyOn(store, "upsertDesired").mockImplementation(async (input) => {
    await original(input);
    if (++count === 2) throw new Error("crash");
  });
  await expect(binding.sample(sample("on", 2000), false, sample("off", 1000))).rejects.toThrow(
    "crash",
  );
  expect((await levels()).every((v) => v && "on" in v && !v.on)).toBe(true);
  expect((await store.readInput(entityId))?.state).toBe("off");
  spy.mockRestore();
  await binding.sample(sample("on", 2000), false, sample("off", 1000));
  // Crash after commit: a fresh session receiving the same edge cannot invert again.
  const restarted = createBedroomSwitch(config, store);
  await restarted.sample(sample("off", 1000), true);
  await restarted.sample(sample("on", 2000), false, sample("off", 1000));
  expect((await levels())[0]).toMatchObject({ on: true });
});

it("serializes explicit app targets with input inversion", async () => {
  const { store, binding, levels } = await setup();
  await binding.sample(sample("off", 1000), true);
  await Promise.all([
    store.lightTransaction((locked) =>
      writeLightGroup(BEDROOM_LAMPS, (_e, prev) => ({ ...prev, on: true }), locked),
    ),
    binding.sample(sample("on", 2000), false, sample("off", 1000)),
  ]);
  expect((await levels()).every((v) => v && "on" in v && !v.on)).toBe(true);
});

it("preserves microsecond replay order and rejects malformed timestamps", () => {
  expect(parseInput({ ...sample("on", 1000), last_changed: "bad" })).toBeNull();
  expect(
    parseInput({ ...sample("on", 1000), last_changed: "1970-01-01T00:00:01.123456+00:00" })
      ?.changed,
  ).toBe("1970-01-01T00:00:01.123456Z");
});
