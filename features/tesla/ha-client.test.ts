import { HomeAssistantClient } from "@www/core";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

it("lists and validates all HA states while preserving domain filtering", async () => {
  const states = ["sensor.evee_battery", "climate.evee_climate"].map((entity_id) => ({
    entity_id,
    state: "unknown",
    attributes: {},
    last_updated: "2026-01-01T00:00:00Z",
  }));
  const fetch = vi.fn(async () => Response.json(states));
  vi.stubGlobal("fetch", fetch);
  const client = new HomeAssistantClient({ baseUrl: "http://ha.test", token: "test-token" });
  expect(await client.getAllEntities()).toEqual(states);
  expect(fetch).toHaveBeenCalledWith("http://ha.test/api/states", expect.any(Object));
  expect(await client.getEntities("climate")).toEqual([states[1]]);
  fetch.mockResolvedValueOnce(Response.json([{ entity_id: "sensor.invalid" }]));
  await expect(client.getAllEntities()).rejects.toThrow();
});

it.each([
  ["", ""],
  ["http://ha.test", ""],
  ["", "test-token"],
])("requires both HA URL and token (%s)", (baseUrl, token) => {
  expect(new HomeAssistantClient({ baseUrl, token }).isConfigured()).toBe(false);
});
