/**
 * The tv (Apple TV) feature's own config slice (Track C, Wave 6). Reads the
 * already-hydrated `process.env` and validates just the keys this feature
 * needs, same defaults as apps/api/src/env.ts so import never throws before
 * real values are wired (mirror features/ac/config.ts).
 */
import { z } from "zod";

export const config = z
  .object({
    HA_URL: z.string().url().default("http://homeassistant.local:8123"),
    HA_TOKEN: z.string().default(""),
  })
  .parse(process.env);
