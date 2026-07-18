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
// HOME_* are not strictly secret (they are your own coordinates), but they are
// private and must stay out of the open-source repo, so they ride the same
// op-backed docker-secret rail as the real secrets , one place (1Password) for
// all private config (www-mqp).
const SECRET_FILE_ENV = [
  "HA_TOKEN",
  "UNIFI_API_KEY",
  "WIFI_SSID",
  "WIFI_PASSWORD",
  "HOME_LAT",
  "HOME_LON",
  "HOME_PLACE_NAME",
  "HOME_RADIUS_MILES",
  "OPENROUTER_API_KEY",
  "MEDIA_STORAGE_DIR",
  "SPOTIFY_CLIENT_ID",
  "SPOTIFY_CLIENT_SECRET",
  "SPOTIFY_REFRESH_TOKEN",
  "ASC_KEY_ID",
  "ASC_ISSUER_ID",
  "ASC_KEY_CONTENT",
] as const;
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
      // secret not mounted (dev/test) , leave unset, schema default applies
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

  // Home location. Real values are delivered from 1Password (Homelab vault item
  // "Home Location") via the op-backed secret rail above; these defaults are a
  // deliberately PUBLIC placeholder (LA City Hall) so the repo can be open-source
  // without leaking a home address. config/places.ts builds the home geofence
  // from these (www-mqp).
  HOME_LAT: z.coerce.number().default(34.0537),
  HOME_LON: z.coerce.number().default(-118.2428),
  HOME_PLACE_NAME: z.string().default("Home"),
  HOME_RADIUS_MILES: z.coerce.number().default(1),

  // Tesla entity prefix in Home Assistant (Tesla Fleet / tesla_custom integration
  // names every entity `<prefix>_*`, e.g. sensor.evee_battery_level). The car's
  // nickname is "Evee".
  TESLA_ENTITY_PREFIX: z.string().default("evee"),

  // OpenRouter API key for LLM-based metadata enrichment in the media pipeline.
  // Optional , empty string disables enrichment so the worker boots without it.
  OPENROUTER_API_KEY: z.string().default(""),

  // Where the media-worker stores downloaded audio/video/thumb files on the host.
  // Delivered from 1Password via the docker-secret rail (same pattern as HOME_*).
  MEDIA_STORAGE_DIR: z.string().default("/mnt/media"),

  // Spotify Web API credentials. Optional , empty string disables Spotify so
  // the api boots without them. The media router throws SpotifyError when
  // these are absent and a Spotify query is attempted (same pattern as HA_TOKEN).
  SPOTIFY_CLIENT_ID: z.string().default(""),
  SPOTIFY_CLIENT_SECRET: z.string().default(""),
  SPOTIFY_REFRESH_TOKEN: z.string().default(""),

  // App Store Connect API key for the asc-version-poll worker (detects newer
  // TestFlight builds of the wall-panel shell). Optional , empty string
  // disables the poll so api/worker boot without it (same pattern as HA_TOKEN).
  // ASC_APP_ID is the app's numeric ASC resource id , NOT secret (it is in the
  // public App Store URL), so it defaults here instead of riding the secret rail.
  ASC_KEY_ID: z.string().default(""),
  ASC_ISSUER_ID: z.string().default(""),
  ASC_KEY_CONTENT: z.string().default(""),
  ASC_APP_ID: z.string().default("6762095888"),

  // go2rtc, the in-cluster RTSP -> MJPEG bridge for the Camera tile. It holds
  // the camera's RTSP credentials in its own mounted config Secret, so nothing
  // secret rides these vars , they are plain, public-safe cluster coordinates
  // (a ClusterIP service DNS name, a stream name, a display label). The Camera
  // tile is deliberately independent of Home Assistant: go2rtc talks RTSP to
  // the camera directly, so the tile stays alive when HA is down.
  GO2RTC_URL: z.string().url().default("http://go2rtc:1984"),
  CAMERA_STREAM_NAME: z.string().default("bedroom_mjpeg"),
  CAMERA_LABEL: z.string().default("Living Room Cam"),
});

export const env = envSchema.parse(process.env);
