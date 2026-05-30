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
 * Fetch network status from UniFi. Throws on error so the tile shows shimmer.
 */
export async function getNetworkStatus(clientOverride?: UnifiClient): Promise<NetworkStatus> {
  const client = clientOverride ?? new UnifiClient();
  const ssid = env.WIFI_SSID || "Home";

  if (!client.isConfigured()) {
    throw new Error("UniFi not configured");
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
