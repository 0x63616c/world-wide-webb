/**
 * The dogcam feature's own config slice (Track C, Wave 2). Reads the already-
 * hydrated process.env (apps/api's env.ts runs docker-secret hydration before
 * any feature is imported) and validates just the keys this feature needs.
 * Never reaches into apps/api's `env`. Safe defaults so importing the branded
 * facets during codegen never throws before real values are wired.
 *
 * HA_URL's default is copied verbatim from apps/api/src/env.ts to stay in
 * lockstep with the pre-fold singleton: both slices read the same hydrated
 * process.env, so if HA_URL is ever unset in some deploy context, this
 * feature's own HA client resolves the identical default apps/api's `ha`
 * singleton would, rather than silently disagreeing on the HA base URL.
 */
import { z } from "zod";

export const config = z
  .object({
    HA_URL: z.string().url().default("http://homeassistant.local:8123"),
    HA_TOKEN: z.string().default(""),
    GO2RTC_URL: z.string().url().default("http://go2rtc:1984"),
    CAMERA_STREAM_NAME: z.string().default("bedroom_mjpeg"),
    CAMERA_LABEL: z.string().default("Living Room Cam"),
  })
  .parse(process.env);
