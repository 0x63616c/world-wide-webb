/**
 * Tests the real HomeAssistantClient edge parsing (www-355t.16). Service tests
 * mock the `ha` singleton, so the client's own Zod validation is covered here by
 * stubbing global fetch.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeAssistantClient } from "../integrations/homeassistant";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubStates(states: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(states) }),
  );
}

describe("HomeAssistantClient.getEntities", () => {
  it("parses /api/states and filters to the requested domain", async () => {
    stubStates([
      { entity_id: "light.lamp", state: "on", attributes: { brightness: 200 }, last_updated: "t" },
      { entity_id: "climate.home", state: "cool", attributes: {}, last_updated: "t" },
      // Extra top-level fields (context, last_reported) must pass through untouched.
      {
        entity_id: "light.desk",
        state: "off",
        attributes: {},
        last_updated: "t",
        context: { id: "x" },
      },
    ]);

    const lights = await new HomeAssistantClient().getEntities("light");

    expect(lights.map((e) => e.entity_id)).toEqual(["light.lamp", "light.desk"]);
    expect(lights[0].attributes.brightness).toBe(200);
  });

  it("rejects a malformed entity at the edge (missing entity_id)", async () => {
    stubStates([{ state: "on", attributes: {}, last_updated: "t" }]);
    await expect(new HomeAssistantClient().getEntities("light")).rejects.toThrow();
  });
});
