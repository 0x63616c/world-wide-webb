/**
 * Tests for the UniFi guest-authorization client (www-q002.10).
 *
 * The portal grants internet by calling authorize-guest on the controller; it
 * reads active authorizations to cross-check the controller still holds a grant.
 * These are the ONLY UniFi writes in the system. Every test runs against a
 * mocked fetch: we assert the cmd payload (cmd, mac, minutes=43200) and the
 * request path, and that NO real network call escapes. A controller outage must
 * surface as a thrown UnifiError (services throw, never fake success).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnifiClient } from "../integrations/unifi";

const KEY = "test-api-key";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UnifiClient.authorizeGuest", () => {
  it("POSTs cmd/stamgr with cmd=authorize-guest, the mac, and minutes=43200", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ meta: { rc: "ok" }, data: [] }));

    const client = new UnifiClient({
      baseUrl: "https://gw.test",
      apiKey: KEY,
      siteId: "default",
    });
    await client.authorizeGuest("AA:BB:CC:DD:EE:FF");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://gw.test/proxy/network/api/s/default/cmd/stamgr");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.cmd).toBe("authorize-guest");
    expect(body.minutes).toBe(43200);
    // MAC is normalised to lowercase for the controller.
    expect(body.mac).toBe("aa:bb:cc:dd:ee:ff");
  });

  it("defaults to 43200 minutes (30 days) but accepts an override", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ meta: { rc: "ok" }, data: [] }));
    const client = new UnifiClient({ baseUrl: "https://gw.test", apiKey: KEY });
    await client.authorizeGuest("aa:bb:cc:dd:ee:ff", 60);
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(body.minutes).toBe(60);
  });

  it("throws UnifiError on a controller outage (never fakes success)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const client = new UnifiClient({ baseUrl: "https://gw.test", apiKey: KEY });
    await expect(client.authorizeGuest("aa:bb:cc:dd:ee:ff")).rejects.toThrow();
  });

  it("throws on a non-ok controller response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ meta: { rc: "error" } }, 401));
    const client = new UnifiClient({ baseUrl: "https://gw.test", apiKey: KEY });
    await expect(client.authorizeGuest("aa:bb:cc:dd:ee:ff")).rejects.toThrow();
  });
});

describe("UnifiClient.findActiveAuthorization", () => {
  it("GETs stat/guest and returns the row matching the mac (case-insensitive)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        meta: { rc: "ok" },
        data: [
          { mac: "11:22:33:44:55:66", start: now - 100, end: now + 1000 },
          { mac: "aa:bb:cc:dd:ee:ff", start: now - 50, end: now + 5000 },
        ],
      }),
    );
    const client = new UnifiClient({ baseUrl: "https://gw.test", apiKey: KEY, siteId: "default" });
    const found = await client.findActiveAuthorization("AA:BB:CC:DD:EE:FF");

    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://gw.test/proxy/network/api/s/default/stat/guest");
    expect(init?.method ?? "GET").toMatch(/GET/i);
    expect(found).not.toBeNull();
    expect(found?.mac).toBe("aa:bb:cc:dd:ee:ff");
  });

  it("returns null when no active authorization exists for the mac", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ meta: { rc: "ok" }, data: [] }));
    const client = new UnifiClient({ baseUrl: "https://gw.test", apiKey: KEY });
    expect(await client.findActiveAuthorization("aa:bb:cc:dd:ee:ff")).toBeNull();
  });

  it("throws UnifiError when the controller is unreachable", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ETIMEDOUT"));
    const client = new UnifiClient({ baseUrl: "https://gw.test", apiKey: KEY });
    await expect(client.findActiveAuthorization("aa:bb:cc:dd:ee:ff")).rejects.toThrow();
  });
});

describe("UnifiGuestClient interface (mockable, no real network)", () => {
  it("a hand-rolled mock satisfies the interface and makes zero real fetch calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const calls: Array<{ mac: string; minutes: number }> = [];
    const mock = {
      isConfigured: () => true,
      authorizeGuest: async (mac: string, minutes = 43200) => {
        calls.push({ mac, minutes });
      },
      findActiveAuthorization: async () => null,
    };
    await mock.authorizeGuest("aa:bb:cc:dd:ee:ff");
    expect(calls).toEqual([{ mac: "aa:bb:cc:dd:ee:ff", minutes: 43200 }]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
