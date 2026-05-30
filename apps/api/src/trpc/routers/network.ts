import { z } from "zod";
import { getNetworkStatus } from "../../services/network-service";
import { publicProcedure, router } from "../init";

const trafficBucketSchema = z.object({
  down: z.number().describe("Download relative value for the butterfly chart"),
  up: z.number().describe("Upload relative value for the butterfly chart"),
});

const networkStatusSchema = z.object({
  status: z.enum(["Online", "Offline"]).describe("WAN connectivity status"),
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
});
