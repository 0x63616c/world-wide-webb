import { describe, expect, test, vi } from "vitest";
import { UnifiClient } from "../integrations/unifi";
import { getNetworkStatus } from "../services/network-service";

// ---------------------------------------------------------------------------
// getNetworkStatus — unconfigured client (no API key)
// ---------------------------------------------------------------------------

describe("getNetworkStatus — no API key", () => {
  test("throws when client is not configured", async () => {
    const client = new UnifiClient({ baseUrl: "https://fake", apiKey: "", siteId: "default" });
    await expect(getNetworkStatus(client)).rejects.toThrow("UniFi not configured");
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
