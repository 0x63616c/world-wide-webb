import { readFileSync } from "node:fs";
import { z } from "zod";

// In the Swarm the Postgres password arrives as a mounted docker secret file,
// never as a literal env var (so it stays out of the service spec and image).
// Build DATABASE_URL from that secret plus the POSTGRES_* service env. An
// explicit DATABASE_URL (local dev, tests, CI) always wins; when no secret is
// mounted (dev/test) we return undefined and the schema default applies.
export function databaseUrlFromSecret(
  src: Record<string, string | undefined> = process.env,
): string | undefined {
  if (src.DATABASE_URL) return src.DATABASE_URL;
  const pwFile = src.POSTGRES_PASSWORD_FILE ?? "/run/secrets/POSTGRES_PASSWORD";
  let password: string;
  try {
    password = readFileSync(pwFile, "utf-8").trim();
  } catch {
    return undefined;
  }
  if (!password) return undefined;
  const host = src.POSTGRES_HOST ?? "postgres";
  const port = src.POSTGRES_PORT ?? "5432";
  const user = src.POSTGRES_USER ?? "postgres";
  const name = src.POSTGRES_DB ?? "control_center";
  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:${port}/${name}`;
}

// Secret-backed config that the Swarm delivers as docker secret files mounted
// at /run/secrets/<NAME> (never as env vars, so values stay out of the service
// spec and image). Hydrate each into process.env so the rest of the app reads
// it via the schema below. An explicit env var always wins; a missing file
// (dev/test) is a no-op and the schema default applies. The bundled production
// image has no entrypoint shell, so this in-app loader is the only mapping.
const SECRET_FILE_ENV = ["HA_TOKEN", "UNIFI_API_KEY", "WIFI_SSID", "WIFI_PASSWORD"] as const;
export function hydrateSecretFiles(
  src: Record<string, string | undefined> = process.env,
  dir = "/run/secrets",
): void {
  for (const name of SECRET_FILE_ENV) {
    if (src[name]) continue;
    try {
      const value = readFileSync(`${dir}/${name}`, "utf-8").trim();
      if (value) src[name] = value;
    } catch {
      // secret not mounted (dev/test) — leave unset, schema default applies
    }
  }
}

hydrateSecretFiles();
const resolvedDatabaseUrl = databaseUrlFromSecret();
if (resolvedDatabaseUrl) process.env.DATABASE_URL = resolvedDatabaseUrl;

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

  // The house thermostat entity. HA exposes multiple climate.* entities (e.g. the
  // Tesla's climate.evee_climate); the Climate tile must target the real wall
  // thermostat, not the alphabetical-first entity. See bd memory
  // ha-evee-is-tesla-not-home-climate.
  CLIMATE_ENTITY_ID: z.string().default("climate.home"),

  // UniFi network controller. All optional with safe defaults.
  UNIFI_API_KEY: z.string().default(""),
  UNIFI_CONTROLLER_URL: z.string().url().default("https://192.168.0.1"),
  UNIFI_SITE_ID: z.string().default("default"),

  // Guest Wi-Fi credentials shown on the network tile QR. Optional.
  WIFI_SSID: z.string().default(""),
  WIFI_PASSWORD: z.string().default(""),

  // Location — Home, Los Angeles. The map-pill place name is no longer
  // an env var; named places live in config/places.ts (CC-6gx).
  LAT: z.coerce.number().default(34.0537),
  LON: z.coerce.number().default(-118.2428),

  // Tesla entity prefix in Home Assistant (Tesla Fleet / tesla_custom integration
  // names every entity `<prefix>_*`, e.g. sensor.evee_battery_level). The car's
  // nickname is "Evee".
  TESLA_ENTITY_PREFIX: z.string().default("evee"),
});

export const env = envSchema.parse(process.env);
