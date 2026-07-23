/**
 * tRPC `network` facet (Track C, W0). The Network tile's stats surface plus the
 * guest-network QR payload. Reaches the tRPC runtime ONLY through
 * @app-kit/server and UniFi ONLY through the feature's own service — never
 * apps/api. Codegen collects the top-level key `network` off `api._def.record`.
 */
import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { z } from "zod";
import { config } from "./config";
import { getNetworkStatus, NetworkConnectivity } from "./service";

/** Escape a value for a WIFI: QR payload — backslash, semicolon, comma, colon
 * and double-quote are structural and must be backslash-escaped. */
function escapeWifiQrValue(value: string): string {
  return value.replace(/([\\;,:"])/g, "\\$1");
}

/** The full WIFI: join payload, or "" when no SSID is configured. Pure so the
 * escaping is unit-testable. SSID/password exist ONLY inside this payload. */
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
  ssid: z.string().describe("Primary Wi-Fi SSID from config WIFI_SSID"),
  down: z.string().describe("24 h WAN download in GB (e.g. '12.4')"),
  up: z.string().describe("24 h WAN upload in GB (e.g. '3.1')"),
  ping: z.number().int().describe("Round-trip latency to gateway in ms"),
  traffic: z
    .array(trafficBucketSchema)
    .describe(
      "Hourly buckets for the mirrored butterfly chart; 24 when live, 0 when not yet available",
    ),
});

const networkRouter = router({
  status: publicProcedure
    .input(z.object({}).optional())
    .output(networkStatusSchema)
    .query(async () => {
      const result = await getNetworkStatus();
      return { ...result, ping: Math.round(result.ping) };
    }),
  guestWifiQr: publicProcedure
    .input(z.object({}).optional())
    .output(
      z.object({
        qr: z.string().describe("WIFI: join payload for the guest network, '' when unconfigured"),
      }),
    )
    .query(() => ({ qr: buildWifiQrPayload(config.WIFI_GUEST_SSID, config.WIFI_PASSWORD) })),
});

/** The branded `api` facet — single top-level key `network`. */
export const api = defineApi(router({ network: networkRouter }));
