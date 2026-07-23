/**
 * Tests the real HomeAssistantClient edge parsing (www-355t.16). Service tests
 * mock the `ha` singleton, so the client's own Zod validation is covered here by
 * stubbing global fetch.
 *
 * Also exercises the shared `haFetch` request pipeline through all three public
 * body shapes (json via getEntities, text via renderTemplate, binary-Response
 * via getMedia): success, non-2xx -> HaError(status, body), network error ->
 * HaError(0), and timeout -> HaError(0).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { HomeAssistantClient } from "../integrations/homeassistant";
import { HaError } from "../integrations/homeassistant/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stubs global fetch with a single resolved Response-like value. */
function stubFetch(response: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubStates(states: unknown) {
  stubFetch({ ok: true, json: () => Promise.resolve(states) });
}

/** A non-2xx Response whose text() body drives HaError's message. */
function errorResponse(status: number, body: string) {
  return { ok: false, status, text: () => Promise.resolve(body) };
}

/**
 * Build a client with explicit config (the env-free `@www/core` constructor).
 * getMedia's Authorization header path needs a non-empty token; the other
 * methods do not care, so they default to an empty token.
 */
function client(token = "") {
  return new HomeAssistantClient({ baseUrl: "http://ha.test", token });
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

    const lights = await client().getEntities("light");

    expect(lights.map((e) => e.entity_id)).toEqual(["light.lamp", "light.desk"]);
    expect(lights[0].attributes.brightness).toBe(200);
  });

  it("rejects a malformed entity at the edge (missing entity_id)", async () => {
    stubStates([{ state: "on", attributes: {}, last_updated: "t" }]);
    await expect(client().getEntities("light")).rejects.toThrow();
  });
});

describe("haFetch pipeline: json shape (request via getEntity)", () => {
  it("returns the parsed body on success", async () => {
    stubFetch({
      ok: true,
      json: () => Promise.resolve({ entity_id: "light.lamp", state: "on", last_updated: "t" }),
    });
    const entity = await client().getEntity("light.lamp");
    expect(entity.entity_id).toBe("light.lamp");
  });

  it("maps a non-2xx to HaError(status) carrying the response body", async () => {
    stubFetch(errorResponse(404, "Entity not found"));
    const err = await client()
      .getEntity("light.missing")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HaError);
    expect((err as HaError).status).toBe(404);
    expect((err as HaError).message).toBe("Entity not found");
  });

  it("maps a network error to HaError(0)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const err = await client()
      .getEntity("light.lamp")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HaError);
    expect((err as HaError).status).toBe(0);
    expect((err as HaError).message).toContain("ECONNREFUSED");
  });

  it("maps a timeout abort to HaError(0)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError")),
    );
    const err = await client()
      .getEntity("light.lamp")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HaError);
    expect((err as HaError).status).toBe(0);
  });
});

describe("haFetch pipeline: text shape (renderTemplate)", () => {
  it("returns the rendered text on success", async () => {
    stubFetch({ ok: true, text: () => Promise.resolve("22.5") });
    const rendered = await client().renderTemplate("{{ states('x') }}");
    expect(rendered).toBe("22.5");
  });

  it("maps a non-2xx to HaError(status) carrying the response body", async () => {
    stubFetch(errorResponse(400, "invalid template"));
    const err = await client()
      .renderTemplate("{{ bad }}")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HaError);
    expect((err as HaError).status).toBe(400);
    expect((err as HaError).message).toBe("invalid template");
  });

  it("maps a network error to HaError(0)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("dns failure")));
    const err = await client()
      .renderTemplate("{{ x }}")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HaError);
    expect((err as HaError).status).toBe(0);
    expect((err as HaError).message).toContain("dns failure");
  });

  it("maps a timeout abort to HaError(0)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError")),
    );
    const err = await client()
      .renderTemplate("{{ x }}")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HaError);
    expect((err as HaError).status).toBe(0);
  });
});

describe("haFetch pipeline: binary-Response shape (getMedia)", () => {
  it("returns the raw Response on success so callers stream the body", async () => {
    const raw = { ok: true, headers: { get: () => "image/jpeg" } };
    const fetchMock = stubFetch(raw);
    const res = await client("test-token").getMedia("/api/camera_proxy/camera.door?token=secret");
    expect(res).toBe(raw);
    // The full path (with token) is fetched, but only the token-stripped path is
    // available for logging - assert the request URL still carries the token.
    expect(fetchMock.mock.calls[0]?.[0]).toContain("token=secret");
  });

  it("maps a non-2xx to HaError(status) carrying the response body", async () => {
    stubFetch(errorResponse(401, "Unauthorized"));
    const err = await client("test-token")
      .getMedia("/api/camera_proxy/camera.door?token=secret")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HaError);
    expect((err as HaError).status).toBe(401);
    expect((err as HaError).message).toBe("Unauthorized");
  });

  it("maps a network error to HaError(0)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hang up")));
    const err = await client("test-token")
      .getMedia("/api/camera_proxy/camera.door")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HaError);
    expect((err as HaError).status).toBe(0);
    expect((err as HaError).message).toContain("socket hang up");
  });

  it("maps a timeout abort to HaError(0)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError")),
    );
    const err = await client("test-token")
      .getMedia("/api/camera_proxy/camera.door")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HaError);
    expect((err as HaError).status).toBe(0);
  });
});
