import { z } from "zod";
import { env } from "../../env";
import { getNetworkStatus, NetworkConnectivity } from "../../services/network-service";
import { publicProcedure, router } from "../init";

/**
 * Escape a value for a WIFI: QR payload , backslash, semicolon, comma, colon
 * and double-quote are structural in the format and must be backslash-escaped.
 */
function escapeWifiQrValue(value: string): string {
  return value.replace(/([\\;,:"])/g, "\\$1");
}

/**
 * The full WIFI: join payload, or "" when no SSID is configured. Pure so the
 * escaping is unit-testable; the router feeds it the env values. The
 * SSID/password exist ONLY inside this payload , no endpoint exposes them as
 * display fields (design call 2026-07-19: guest network details never render
 * as text on the board).
 */
export function buildWifiQrPayload(ssid: string, password: string): string {
  if (!ssid) return "";
  if (!password) return `WIFI:T:nopass;S:${escapeWifiQrValue(ssid)};;`;
  return `WIFI:T:WPA;S:${escapeWifiQrValue(ssid)};P:${escapeWifiQrValue(password)};;`;
}

const trafficBucketSchema = z.object({
  down: z.number().describe("Download relative value for the butterfly chart"),
  up: z.number().describe("Upload relative value for the butterfly chart"),
});

const networkStatusSchema = z.object({
  status: z
    .enum([NetworkConnectivity.Online, NetworkConnectivity.Offline])
    .describe("WAN connectivity status"),
  ssid: z.string().describe("Primary Wi-Fi SSID from env WIFI_SSID"),
  down: z.string().describe("24 h WAN download in GB (e.g. '12.4')"),
  up: z.string().describe("24 h WAN upload in GB (e.g. '3.1')"),
  ping: z.number().int().describe("Round-trip latency to gateway in ms"),
  traffic: z
    .array(trafficBucketSchema)
    .describe(
      "Hourly buckets for the mirrored butterfly chart (index 0 = oldest); 24 when live, 0 when not yet available",
    ),
});

export const networkRouter = router({
  status: publicProcedure
    .input(z.object({}).optional())
    .output(networkStatusSchema)
    .query(async () => {
      const result = await getNetworkStatus();
      // Ensure ping is always an integer for the output schema.
      return { ...result, ping: Math.round(result.ping) };
    }),
  guestWifiQr: publicProcedure
    .input(z.object({}).optional())
    .output(
      z.object({
        qr: z.string().describe("WIFI: join payload for the guest network, '' when unconfigured"),
      }),
    )
    .query(() => ({ qr: buildWifiQrPayload(env.WIFI_GUEST_SSID, env.WIFI_PASSWORD) })),
});
