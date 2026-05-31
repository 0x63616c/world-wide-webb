import { afterEach, describe, expect, test, vi } from "vitest";
import { UnifiClient } from "../integrations/unifi";
import { DEMO_NETWORK, getNetworkStatus, NetworkConnectivity } from "../services/network-service";

// ---------------------------------------------------------------------------
// DEMO_NETWORK shape — always-on demo payload for the wall panel
// ---------------------------------------------------------------------------

describe("DEMO_NETWORK", () => {
  test("has status Online", () => {
    expect(DEMO_NETWORK.status).toBe(NetworkConnectivity.Online);
  });

  test("has a non-empty ssid string", () => {
    expect(typeof DEMO_NETWORK.ssid).toBe("string");
    expect(DEMO_NETWORK.ssid.length).toBeGreaterThan(0);
  });

  test("ssid is 'world-wide-webb' — the actual home network name (CC-ats)", () => {
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
// UnifiClient.getTrafficBuckets — stat/report/5minutes.site
// ---------------------------------------------------------------------------

describe("UnifiClient.getTrafficBuckets", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeClient() {
    return new UnifiClient({
      baseUrl: "https://unifi.local",
      apiKey: "testkey",
      siteId: "default",
    });
  }

  function makeBucketData(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      "wan-rx_bytes": 50_000_000 + i * 1_000_000,
      "wan-tx_bytes": 15_000_000 + i * 500_000,
      time: 1_700_000_000_000 + i * 300_000,
    }));
  }

  test("returns 24 buckets mapped to {down, up} in bytes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: makeBucketData(24) }),
      }),
    );
    const result = await makeClient().getTrafficBuckets();
    expect(result).toHaveLength(24);
    expect(typeof result[0].down).toBe("number");
    expect(typeof result[0].up).toBe("number");
    expect(result[0].down).toBeGreaterThan(0);
  });

  test("zero-fills leading buckets to always return exactly 24 when API returns fewer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: makeBucketData(10) }),
      }),
    );
    const result = await makeClient().getTrafficBuckets();
    expect(result).toHaveLength(24);
    expect(result[0].down).toBe(0);
    expect(result[0].up).toBe(0);
    expect(result[23].down).toBeGreaterThan(0);
  });

  test("throws UnifiError on non-ok API response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      }),
    );
    await expect(makeClient().getTrafficBuckets()).rejects.toThrow();
  });

  test("throws on network-level failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(makeClient().getTrafficBuckets()).rejects.toThrow("ECONNREFUSED");
  });
});

// ---------------------------------------------------------------------------
// UnifiClient.getWanHealth — stat/health
// ---------------------------------------------------------------------------

describe("UnifiClient.getWanHealth", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeClient() {
    return new UnifiClient({
      baseUrl: "https://unifi.local",
      apiKey: "testkey",
      siteId: "default",
    });
  }

  function makeHealthData(latency = 3) {
    return {
      data: [
        { subsystem: "wlan", num_sta: 5 },
        {
          subsystem: "wan",
          status: "ok",
          uptime_stats: { WAN: { latency_average: latency, availability: 100.0 } },
        },
      ],
    };
  }

  test("returns ok status and WAN latency from stat/health", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(makeHealthData(7)),
      }),
    );
    const result = await makeClient().getWanHealth();
    expect(result.status).toBe("ok");
    expect(result.wanLatencyMs).toBe(7);
  });

  test("returns error status and null latency when WAN subsystem is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ subsystem: "wlan" }] }),
      }),
    );
    const result = await makeClient().getWanHealth();
    expect(result.status).toBe("error");
    expect(result.wanLatencyMs).toBeNull();
  });

  test("throws on network-level failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    await expect(makeClient().getWanHealth()).rejects.toThrow("timeout");
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
// getNetworkStatus — configured client, live data paths
// ---------------------------------------------------------------------------

describe("getNetworkStatus — configured client", () => {
  function makeConfiguredClient() {
    return new UnifiClient({ baseUrl: "https://fake-unifi", apiKey: "testkey", siteId: "default" });
  }

  function makeBuckets(count = 24) {
    return Array.from({ length: count }, (_, i) => ({
      down: 50_000_000 + i * 1_000_000,
      up: 10_000_000 + i * 200_000,
    }));
  }

  test("returns Online with traffic and ping from real client methods", async () => {
    const client = makeConfiguredClient();
    vi.spyOn(client, "isConfigured").mockReturnValue(true);
    vi.spyOn(client, "getTrafficBuckets").mockResolvedValue(makeBuckets());
    vi.spyOn(client, "getWanHealth").mockResolvedValue({ status: "ok", wanLatencyMs: 15 });

    const result = await getNetworkStatus(client);

    expect(result.status).toBe(NetworkConnectivity.Online);
    expect(result.ping).toBe(15);
    expect(result.traffic).toHaveLength(24);
    expect(result.down).toMatch(/^\d+\.\d$/);
    expect(result.up).toMatch(/^\d+\.\d$/);
  });

  test("returns Offline when health reports WAN error", async () => {
    const client = makeConfiguredClient();
    vi.spyOn(client, "isConfigured").mockReturnValue(true);
    vi.spyOn(client, "getTrafficBuckets").mockResolvedValue(Array(24).fill({ down: 0, up: 0 }));
    vi.spyOn(client, "getWanHealth").mockResolvedValue({ status: "error", wanLatencyMs: null });

    const result = await getNetworkStatus(client);

    expect(result.status).toBe(NetworkConnectivity.Offline);
    expect(result.ping).toBe(0);
  });

  test("derives GB totals from the sum of traffic bucket bytes", async () => {
    const client = makeConfiguredClient();
    vi.spyOn(client, "isConfigured").mockReturnValue(true);
    // 24 buckets × 500_000_000 bytes down = 12_000_000_000 bytes = 12.0 GB
    vi.spyOn(client, "getTrafficBuckets").mockResolvedValue(
      Array(24).fill({ down: 500_000_000, up: 100_000_000 }),
    );
    vi.spyOn(client, "getWanHealth").mockResolvedValue({ status: "ok", wanLatencyMs: 5 });

    const result = await getNetworkStatus(client);

    expect(result.down).toBe("12.0");
    expect(result.up).toBe("2.4");
  });

  test("throws when getTrafficBuckets throws", async () => {
    const client = makeConfiguredClient();
    vi.spyOn(client, "isConfigured").mockReturnValue(true);
    vi.spyOn(client, "getTrafficBuckets").mockRejectedValue(new Error("connection refused"));
    vi.spyOn(client, "getWanHealth").mockResolvedValue({ status: "ok", wanLatencyMs: 5 });

    await expect(getNetworkStatus(client)).rejects.toThrow("connection refused");
  });

  test("throws when getWanHealth throws", async () => {
    const client = makeConfiguredClient();
    vi.spyOn(client, "isConfigured").mockReturnValue(true);
    vi.spyOn(client, "getTrafficBuckets").mockResolvedValue(makeBuckets());
    vi.spyOn(client, "getWanHealth").mockRejectedValue(new Error("health endpoint unreachable"));

    await expect(getNetworkStatus(client)).rejects.toThrow("health endpoint unreachable");
  });
});
