import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().default(4201),
  DATABASE_URL: z.string().url().default("postgresql://cc:cc@localhost:5432/controlcenter"),
  BUILD_HASH: z.string().default("dev"),

  // Home Assistant. HA_TOKEN is OPTIONAL (default "") so the api boots without
  // it; the HA client reports isConfigured() === false and tiles degrade to
  // placeholder data rather than crashing the server.
  HA_URL: z.string().url().default("http://homeassistant.local:8123"),
  HA_TOKEN: z.string().default(""),

  // UniFi network controller. All optional with safe defaults.
  UNIFI_API_KEY: z.string().default(""),
  UNIFI_CONTROLLER_URL: z.string().url().default("https://192.168.0.1"),
  UNIFI_SITE_ID: z.string().default("default"),

  // Guest Wi-Fi credentials shown on the network tile QR. Optional.
  WIFI_SSID: z.string().default(""),
  WIFI_PASSWORD: z.string().default(""),

  // Location — Home, Los Angeles.
  LAT: z.coerce.number().default(34.0537),
  LON: z.coerce.number().default(-118.2428),
  LOCATION_LABEL: z.string().default("Home"),

  // Tesla entity prefix in Home Assistant (Tesla Fleet / tesla_custom integration
  // names every entity `<prefix>_*`, e.g. sensor.evee_battery_level). The car's
  // nickname is "Evee".
  TESLA_ENTITY_PREFIX: z.string().default("evee"),
});

export const env = envSchema.parse(process.env);
