import { describe, expect, test, vi } from "vitest";
import { UnifiClient } from "../integrations/unifi";
import { generateFallbackTraffic, getNetworkStatus } from "../services/network-service";

// ---------------------------------------------------------------------------
// generateFallbackTraffic
// ---------------------------------------------------------------------------

describe("generateFallbackTraffic", () => {
  test("returns exactly 24 buckets", () => {
    const traffic = generateFallbackTraffic();
    expect(traffic).toHaveLength(24);
  });

  test("all buckets have positive down and up values", () => {
    for (const bucket of generateFallbackTraffic()) {
      expect(bucket.down).toBeGreaterThan(0);
      expect(bucket.up).toBeGreaterThan(0);
    }
  });

  test("is deterministic (same output on repeated calls)", () => {
    expect(generateFallbackTraffic()).toEqual(generateFallbackTraffic());
  });
});

// ---------------------------------------------------------------------------
// getNetworkStatus — unconfigured client (no API key)
// ---------------------------------------------------------------------------

describe("getNetworkStatus — no API key", () => {
  test("returns graceful fallback when client is not configured", async () => {
    const client = new UnifiClient({ baseUrl: "https://fake", apiKey: "", siteId: "default" });
    const result = await getNetworkStatus(client);

    expect(result.status).toBe("Online");
    expect(typeof result.ssid).toBe("string");
    expect(typeof result.down).toBe("string");
    expect(typeof result.up).toBe("string");
    expect(typeof result.ping).toBe("number");
    expect(result.traffic).toHaveLength(24);
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
    expect(result.traffic).toHaveLength(24);
    expect(typeof result.ping).toBe("number");
  });

  test("returns fallback when getWanStats returns null (no gateway)", async () => {
    const client = makeConfiguredClient();
    vi.spyOn(client, "isConfigured").mockReturnValue(true);
    vi.spyOn(client, "getWanStats").mockResolvedValue(null);

    const result = await getNetworkStatus(client);

    expect(result.status).toBe("Online");
    expect(result.traffic).toHaveLength(24);
    expect(typeof result.ping).toBe("number");
  });

  test("degrades gracefully when getWanStats throws a network error", async () => {
    const client = makeConfiguredClient();
    vi.spyOn(client, "isConfigured").mockReturnValue(true);
    vi.spyOn(client, "getWanStats").mockRejectedValue(new Error("connection refused"));

    const result = await getNetworkStatus(client);

    expect(result.status).toBe("Online");
    expect(result.traffic).toHaveLength(24);
    expect(typeof result.ping).toBe("number");
    // Should still have valid GB strings on fallback.
    expect(result.down).toMatch(/^\d+\.\d$/);
    expect(result.up).toMatch(/^\d+\.\d$/);
  });

  test("traffic buckets all have numeric down and up", async () => {
    const client = makeConfiguredClient();
    vi.spyOn(client, "isConfigured").mockReturnValue(true);
    vi.spyOn(client, "getWanStats").mockResolvedValue({
      txBps: 500_000,
      rxBps: 4_000_000,
      txBytes24h: 1_000_000_000,
      rxBytes24h: 5_000_000_000,
    });

    const result = await getNetworkStatus(client);

    for (const bucket of result.traffic) {
      expect(typeof bucket.down).toBe("number");
      expect(typeof bucket.up).toBe("number");
    }
  });
});

// ---------------------------------------------------------------------------
// networkRouter.status — output shape validation
// ---------------------------------------------------------------------------

describe("networkRouter.status output shape", () => {
  test("conforms to the expected NetworkStatus shape", async () => {
    // Directly exercise the service (the router just delegates to it).
    const client = new UnifiClient({ baseUrl: "https://fake", apiKey: "", siteId: "default" });
    const result = await getNetworkStatus(client);

    // Shape: {status, ssid, down, up, ping, traffic[24]}
    expect(["Online", "Offline"]).toContain(result.status);
    expect(typeof result.ssid).toBe("string");
    expect(result.down).toMatch(/^\d+\.\d+$/);
    expect(result.up).toMatch(/^\d+\.\d+$/);
    expect(typeof result.ping).toBe("number");
    expect(result.ping).toBeGreaterThanOrEqual(0);
    expect(result.traffic).toHaveLength(24);
    expect(result.traffic[0]).toMatchObject({
      down: expect.any(Number),
      up: expect.any(Number),
    });
  });
});
