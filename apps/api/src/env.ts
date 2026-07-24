import { databaseUrlFromSecret, hydrateSecretFiles } from "@www/platform/env";
import { z } from "zod";

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

  // Renpho scale weight sensor (renpho_fitness_scale_ble via BT proxy). Override
  // if the integration names the entity differently after first pairing.
  HA_WEIGHT_ENTITY_ID: z.string().default("sensor.renpho_scale_weight"),

  // UniFi network controller. All optional with safe defaults.
  UNIFI_API_KEY: z.string().default(""),
  UNIFI_CONTROLLER_URL: z.string().url().default("https://192.168.0.1"),
  UNIFI_SITE_ID: z.string().default("default"),

  // Wi-Fi: WIFI_SSID is the MAIN network name shown on the Network tile;
  // WIFI_GUEST_SSID + WIFI_PASSWORD are the guest network credentials that feed
  // the Guest tile's join QR (never rendered as text). All optional.
  WIFI_SSID: z.string().default(""),
  WIFI_PASSWORD: z.string().default(""),
  WIFI_GUEST_SSID: z.string().default(""),

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

  // Where the worker stores downloaded audio/video/thumb files on the host.
  // Delivered from 1Password via the docker-secret rail (same pattern as HOME_*).
  MEDIA_STORAGE_DIR: z.string().default("/mnt/media"),

  // YouTube ingest master switch, OFF while YouTube gates this egress IP.
  //
  // Every player client returns LOGIN_REQUIRED for essentially any video from
  // our IP, so each claimed job fails in ~1s, burns all 5 attempts through
  // backoff, and lands at `failed`. Off, the poller enqueues nothing and no
  // worker claims the type, so queued rows simply park until this flips back.
  //
  // A flag rather than deleted code: the block is IP reputation, which decays,
  // and the fix (cookies from a throwaway account, a different egress, or
  // waiting it out) is unresolved. Re-enabling should be one env change, not a
  // revert of the whole ingest path.
  YOUTUBE_INGEST_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),

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

  // GitHub PAT for the worker's github-actions deploy poller (Deploys tile).
  // Optional , empty string disables the poll so api/worker boot without it.
  // Named GITHUB_ACTIONS_TOKEN, deliberately NOT GITHUB_TOKEN , that name is
  // the Actions built-in and reserved (docs/secrets-sops-migration/GOAL.md).
  // Only the worker uses it; the api never calls GitHub.
  GITHUB_ACTIONS_TOKEN: z.string().default(""),
  // The repo the deploy poller watches. Not secret.
  GITHUB_REPO: z.string().default("0x63616c/world-wide-webb"),

  // go2rtc, the in-cluster RTSP -> MJPEG bridge for the Camera tile. It holds
  // the camera's RTSP credentials in its own mounted config Secret, so nothing
  // secret rides these vars , they are plain, public-safe cluster coordinates
  // (a ClusterIP service DNS name, a stream name, a display label). The Camera
  // tile is deliberately independent of Home Assistant: go2rtc talks RTSP to
  // the camera directly, so the tile stays alive when HA is down.
  // Apple Push Notification service, for the Notification Center's push fan-out
  // to the iOS shell. Same .p8/ES256 key material shape as the ASC key above and
  // optional for the same reason , empty string means isApnsConfigured() is
  // false and the notify job no-ops, so api/worker boot without push configured.
  // APNS_BUNDLE_ID is the app's bundle identifier (the APNs topic); it is not
  // secret, so it defaults here instead of riding the secret rail.
  APNS_KEY_ID: z.string().default(""),
  APNS_TEAM_ID: z.string().default(""),
  APNS_KEY_CONTENT: z.string().default(""),
  APNS_BUNDLE_ID: z.string().default("co.worldwidewebb.theworkflowengine"),
  // APNs host. The shell app ships via TestFlight, and TestFlight builds carry a
  // PRODUCTION push entitlement , they are NOT sandbox. So this defaults to the
  // production host and only a local debug build (installed from Xcode) ever
  // needs to override it to api.sandbox.push.apple.com.
  APNS_HOST: z.string().default("https://api.push.apple.com"),

  GO2RTC_URL: z.string().url().default("http://go2rtc:1984"),
  CAMERA_STREAM_NAME: z.string().default("bedroom_mjpeg"),
  CAMERA_LABEL: z.string().default("Living Room Cam"),

  // Guest listener (ADR-0006): a second, portal-only Bun.serve bound to the LAN
  // captive-portal path. All optional , GUEST_PORT unset means the listener
  // never starts (the default: dev/test and any deploy that hasn't wired the
  // guest network yet). GUEST_TLS_DIR points at a cert-manager secret
  // projection (fullchain.pem + key.pem, same names the old nginx portal used);
  // when unset the guest listener runs plain HTTP. GUEST_STATIC_DIR is the
  // built guest web bundle (web/dist-portal/ in prod).
  GUEST_PORT: z.coerce.number().int().positive().optional(),
  GUEST_TLS_DIR: z.string().optional(),
  GUEST_STATIC_DIR: z.string().optional(),
  // The real LAN cutover (Task 4) needs the OS-detection companion on the
  // conventional plain-HTTP port 80 while the main (TLS) listener is on 443 ,
  // NOT "port + 1" (444), since the k8s Service's exposed port always equals
  // the container port (no remap in the infra WorkloadSpec). Optional: unset
  // keeps the old port+1 default (dev/test and the dark cluster-only
  // deployment, where the exact port number is arbitrary).
  GUEST_HTTP_PORT: z.coerce.number().int().positive().optional(),
});

export const env = envSchema.parse(process.env);
