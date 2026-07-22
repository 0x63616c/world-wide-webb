import { env } from "../env";
import type { UnifiClient } from "../integrations/unifi";
import { UnifiStatus, unifi } from "../integrations/unifi";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrafficBucket {
  /** Download bytes (raw; the chart normalizes for display). */
  down: number;
  /** Upload bytes (raw; the chart normalizes for display). */
  up: number;
}

export const NetworkConnectivity = {
  Online: "Online",
  Offline: "Offline",
} as const;
export type NetworkConnectivity = (typeof NetworkConnectivity)[keyof typeof NetworkConnectivity];

export interface NetworkStatus {
  status: NetworkConnectivity;
  ssid: string;
  /** 2 h download total in GB, formatted as a string (e.g. "1.4"). */
  down: string;
  /** 2 h upload total in GB, formatted as a string (e.g. "0.3"). */
  up: string;
  /** WAN internet latency in ms from the UniFi gateway's uptime monitor. */
  ping: number;
  /** 24 five-minute buckets for the butterfly chart, index 0 = oldest. */
  traffic: TrafficBucket[];
}

// ---------------------------------------------------------------------------
// DEMO_NETWORK , stable realistic payload shipped while UniFi is not configured.
// Lives in the backend only; frontend never fabricates data.
// ---------------------------------------------------------------------------

export const DEMO_NETWORK: NetworkStatus = {
  status: NetworkConnectivity.Online,
  ssid: "world-wide-webb",
  down: "18.4",
  up: "4.2",
  ping: 11,
  // 24-bucket butterfly chart shaped like a real home-network day. The
  // download/upload *ratio* shifts hour to hour so the two halves never mirror:
  // streaming is download-heavy, video calls are symmetric, cloud backups and
  // file shares are upload-heavy, and there are irregular spikes (game patch,
  // shared upload) rather than a smooth bell curve.
  traffic: [
    { down: 0.09, up: 0.04 }, // 0h , winding down
    { down: 0.06, up: 0.23 }, // 1h , overnight cloud backup starts (upload-heavy)
    { down: 0.05, up: 0.31 }, // 2h , backup peak
    { down: 0.04, up: 0.17 }, // 3h , backup tailing off
    { down: 0.03, up: 0.02 }, // 4h , quiet
    { down: 0.05, up: 0.02 }, // 5h , quiet
    { down: 0.13, up: 0.06 }, // 6h , phones wake + sync
    { down: 0.29, up: 0.05 }, // 7h , morning browse / news
    { down: 0.42, up: 0.39 }, // 8h , work video call (symmetric)
    { down: 0.47, up: 0.28 }, // 9h , call winding down + downloads
    { down: 0.58, up: 0.08 }, // 10h , package/app downloads
    { down: 0.44, up: 0.13 }, // 11h , steady work
    { down: 0.5, up: 0.06 }, // 12h , lunchtime streaming
    { down: 0.33, up: 0.45 }, // 13h , large file share out (upload-heavy)
    { down: 0.61, up: 0.09 }, // 14h , afternoon downloads
    { down: 0.96, up: 0.07 }, // 15h , game/app update download spike
    { down: 0.53, up: 0.4 }, // 16h , afternoon video call
    { down: 0.69, up: 0.05 }, // 17h , early streaming
    { down: 0.78, up: 0.04 }, // 18h , dinnertime streaming
    { down: 0.87, up: 0.06 }, // 19h , prime-time streaming
    { down: 1.0, up: 0.05 }, // 20h , peak 4K streaming
    { down: 0.81, up: 0.27 }, // 21h , streaming + nightly photo backup
    { down: 0.49, up: 0.11 }, // 22h , winding down
    { down: 0.23, up: 0.05 }, // 23h , light
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bytesToGbString(bytes: number): string {
  return (bytes / 1e9).toFixed(1);
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Fetch live network status from UniFi.
 * Falls back to DEMO_NETWORK when UNIFI_API_KEY is not configured.
 * Throws on unexpected runtime errors so the tile falls back to shimmer.
 */
export async function getNetworkStatus(clientOverride?: UnifiClient): Promise<NetworkStatus> {
  const client = clientOverride ?? unifi;

  if (!client.isConfigured()) {
    return DEMO_NETWORK;
  }

  const [buckets, health] = await Promise.all([client.getTrafficBuckets(), client.getWanHealth()]);

  const totalDown = buckets.reduce((sum, b) => sum + b.down, 0);
  const totalUp = buckets.reduce((sum, b) => sum + b.up, 0);

  return {
    status:
      health.status === UnifiStatus.Ok ? NetworkConnectivity.Online : NetworkConnectivity.Offline,
    ssid: env.WIFI_SSID || "Home",
    down: bytesToGbString(totalDown),
    up: bytesToGbString(totalUp),
    ping: health.wanLatencyMs ?? 0,
    traffic: buckets,
  };
}
