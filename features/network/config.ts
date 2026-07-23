/**
 * The network feature's own config slice (Track C, W0). Reads the already-
 * hydrated process.env (apps/api's env.ts runs docker-secret hydration before
 * any feature is imported) and validates just the keys this feature needs.
 * Never reaches into apps/api's `env`. Safe defaults so importing the branded
 * facets during codegen never throws before real values are wired.
 */
import { z } from "zod";

export const config = z
  .object({
    WIFI_SSID: z.string().default(""),
    WIFI_GUEST_SSID: z.string().default(""),
    WIFI_PASSWORD: z.string().default(""),
    UNIFI_API_KEY: z.string().default(""),
    UNIFI_CONTROLLER_URL: z.string().url().default("https://192.168.0.1"),
    UNIFI_SITE_ID: z.string().default("default"),
  })
  .parse(process.env);
