import { env } from "../env";
import { UnifiClient } from "../integrations/unifi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrafficBucket {
  /** Download relative value (normalised, mirrors design chart). */
  down: number;
  /** Upload relative value (normalised, mirrors design chart). */
  up: number;
}

export interface NetworkStatus {
  status: "Online" | "Offline";
  ssid: string;
  /** 24 h download in GB, formatted as a string (e.g. "12.4"). */
  down: string;
  /** 24 h upload in GB, formatted as a string (e.g. "3.1"). */
  up: string;
  /** Round-trip latency in ms. */
  ping: number;
  /** 24 hourly buckets for the butterfly chart, index 0 = oldest hour. */
  traffic: TrafficBucket[];
}

// ---------------------------------------------------------------------------
// DEMO_NETWORK — stable realistic payload shipped while UniFi is deferred (CC-32o).
// Lives in the backend only; frontend never fabricates data.
// ---------------------------------------------------------------------------

export const DEMO_NETWORK: NetworkStatus = {
  status: "Online",
  ssid: "HomeNet",
  down: "18.4",
  up: "4.2",
  ping: 11,
  // 24-bucket butterfly chart shaped like a realistic home-network day:
  // low activity overnight (0–6), morning rise (7–9), midday plateau,
  // afternoon peak (14–17), evening surge (19–22), quiet drop-off.
  traffic: [
    { down: 0.05, up: 0.02 }, // 0h
    { down: 0.03, up: 0.01 }, // 1h
    { down: 0.02, up: 0.01 }, // 2h
    { down: 0.02, up: 0.01 }, // 3h
    { down: 0.03, up: 0.01 }, // 4h
    { down: 0.04, up: 0.02 }, // 5h
    { down: 0.08, up: 0.03 }, // 6h
    { down: 0.22, up: 0.07 }, // 7h
    { down: 0.38, up: 0.12 }, // 8h
    { down: 0.45, up: 0.15 }, // 9h
    { down: 0.52, up: 0.18 }, // 10h
    { down: 0.6, up: 0.2 }, // 11h
    { down: 0.55, up: 0.17 }, // 12h
    { down: 0.48, up: 0.16 }, // 13h
    { down: 0.72, up: 0.24 }, // 14h
    { down: 0.85, up: 0.3 }, // 15h
    { down: 0.8, up: 0.28 }, // 16h
    { down: 0.75, up: 0.25 }, // 17h
    { down: 0.65, up: 0.22 }, // 18h
    { down: 0.9, up: 0.35 }, // 19h
    { down: 1.0, up: 0.4 }, // 20h — peak
    { down: 0.88, up: 0.33 }, // 21h
    { down: 0.62, up: 0.22 }, // 22h
    { down: 0.3, up: 0.1 }, // 23h
  ],
};

// ---------------------------------------------------------------------------
// Derive GB string from bytes
// ---------------------------------------------------------------------------

function bytesToGbString(bytes: number): string {
  return (bytes / 1e9).toFixed(1);
}

// ---------------------------------------------------------------------------
// Measure ping (best-effort; if fetch is too slow, return fallback)
// ---------------------------------------------------------------------------

async function measurePingMs(): Promise<number> {
  // We approximate "ping" as the round-trip latency to the UniFi controller
  // (which is on the LAN). A simple HEAD/OPTIONS to the base is enough.
  const start = Date.now();
  try {
    // AbortSignal with 2s — if the controller responds, we have our latency.
    await fetch(`${env.UNIFI_CONTROLLER_URL}/`, {
      method: "HEAD",
      signal: AbortSignal.timeout(2_000),
      // biome-ignore lint/suspicious/noExplicitAny: Bun-specific tls option
      tls: { rejectUnauthorized: false } as any,
    });
    return Date.now() - start;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Fetch network status from UniFi.
 * Returns DEMO_NETWORK when UniFi is not configured (integration is deferred — CC-32o).
 * Throws on unexpected runtime errors so the tile falls back to shimmer.
 */
export async function getNetworkStatus(clientOverride?: UnifiClient): Promise<NetworkStatus> {
  const client = clientOverride ?? new UnifiClient();
  const ssid = env.WIFI_SSID || "Home";

  if (!client.isConfigured()) {
    return DEMO_NETWORK;
  }

  const [wanStats, pingMs] = await Promise.all([client.getWanStats(), measurePingMs()]);

  if (!wanStats) {
    // Controller reachable but no gateway found — report Online with zeros.
    return {
      status: "Online",
      ssid,
      down: "0.0",
      up: "0.0",
      ping: pingMs,
      traffic: [],
    };
  }

  return {
    status: "Online",
    ssid,
    down: bytesToGbString(wanStats.rxBytes24h),
    up: bytesToGbString(wanStats.txBytes24h),
    ping: pingMs,
    traffic: [],
  };
}
