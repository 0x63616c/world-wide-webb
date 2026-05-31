import { describe, expect, test, vi } from "vitest";
import { UnifiClient } from "../integrations/unifi";
import { DEMO_NETWORK, getNetworkStatus } from "../services/network-service";

// ---------------------------------------------------------------------------
// DEMO_NETWORK shape — always-on demo payload for the wall panel
// ---------------------------------------------------------------------------

describe("DEMO_NETWORK", () => {
  test("has status Online", () => {
    expect(DEMO_NETWORK.status).toBe("Online");
  });

  test("has a non-empty ssid string", () => {
    expect(typeof DEMO_NETWORK.ssid).toBe("string");
    expect(DEMO_NETWORK.ssid.length).toBeGreaterThan(0);
  });

  test("ssid is 'world-wide-webb' — the actual home network name (www-ats)", () => {
    expect(DEMO_NETWORK.ssid).toBe("world-wide-webb");
  });

  test("has down and up as numeric strings with one decimal place", () => {
    expect(DEMO_NETWORK.down).toMatch(/^\d+\.\d$/);
    expect(DEMO_NETWORK.up).toMatch(/^\d+\.\d$/);
  });

  test("has a ping greater than zero", () => {
    expect(DEMO_NETWORK.ping).toBeGreaterThan(0);
  });

  test("has exactly 24 traffic buckets", () => {
    expect(DEMO_NETWORK.traffic).toHaveLength(24);
  });

  test("all traffic buckets have numeric down and up values", () => {
    for (const bucket of DEMO_NETWORK.traffic) {
      expect(typeof bucket.down).toBe("number");
      expect(typeof bucket.up).toBe("number");
    }
  });

  test("traffic buckets have varied values (not all identical) to create a realistic chart", () => {
    const downs = DEMO_NETWORK.traffic.map((b) => b.down);
    const uniqueDowns = new Set(downs);
    expect(uniqueDowns.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// getNetworkStatus — unconfigured client returns DEMO_NETWORK
// ---------------------------------------------------------------------------

describe("getNetworkStatus — no API key", () => {
  test("returns DEMO_NETWORK when client is not configured (not a throw)", async () => {
    const client = new UnifiClient({ baseUrl: "https://fake", apiKey: "", siteId: "default" });
    const result = await getNetworkStatus(client);
    expect(result).toEqual(DEMO_NETWORK);
  });
});

// ---------------------------------------------------------------------------
// getNetworkStatus — configured client, various scenarios
// ---------------------------------------------------------------------------

describe("getNetworkStatus — configured client", () => {
  function makeConfiguredClient(): UnifiClient {
    return new UnifiClient({ baseUrl: "https://fake-unifi", apiKey: "testkey", siteId: "default" });
  }

  test("returns Online with correct GB values when getWanStats resolves", async () => {
    const client = makeConfiguredClient();
    vi.spyOn(client, "isConfigured").mockReturnValue(true);
    vi.spyOn(client, "getWanStats").mockResolvedValue({
      txBps: 1_000_000,
      rxBps: 8_000_000,
      txBytes24h: 3_800_000_000,
      rxBytes24h: 14_200_000_000,
    });

    const result = await getNetworkStatus(client);

    expect(result.status).toBe("Online");
    expect(result.down).toBe("14.2");
    expect(result.up).toBe("3.8");
    expect(typeof result.ping).toBe("number");
  });

  test("returns Online with zero GB when getWanStats returns null (no gateway)", async () => {
    const client = makeConfiguredClient();
    vi.spyOn(client, "isConfigured").mockReturnValue(true);
    vi.spyOn(client, "getWanStats").mockResolvedValue(null);

    const result = await getNetworkStatus(client);

    expect(result.status).toBe("Online");
    expect(result.down).toBe("0.0");
    expect(result.up).toBe("0.0");
  });

  test("throws when getWanStats throws a network error", async () => {
    const client = makeConfiguredClient();
    vi.spyOn(client, "isConfigured").mockReturnValue(true);
    vi.spyOn(client, "getWanStats").mockRejectedValue(new Error("connection refused"));

    await expect(getNetworkStatus(client)).rejects.toThrow("connection refused");
  });
});
