// The per-service secret inventory, transcribed from deploy.config.ts (the
// source of truth for what each service mounts at /run/secrets/<NAME>). ESO
// turns each entry into an ExternalSecret that syncs the 1P field into a native
// k8s Secret, mounted byte-identically to today's docker secrets so env.ts is
// unchanged (CC-j934.4).
//
// Keep this in lockstep with deploy.config.ts until bosun is removed (Phase 6);
// after that, this map (or a successor in packages/core) becomes the sole truth.
// Each value is the `op://Homelab/<here>` suffix: "<Item>/<field>".

/** A service's secret env-name -> 1P "Item/field" suffix (under op://Homelab). */
export type ServiceSecrets = Record<string, string>;

// api: full set incl. Resend (the only service that emails).
const apiSecrets: ServiceSecrets = {
  HA_TOKEN: "Home Assistant Token/credential",
  UNIFI_API_KEY: "UniFi/local_api_key",
  WIFI_SSID: "WiFi Guest Credentials/ssid",
  WIFI_PASSWORD: "WiFi Guest Credentials/password",
  POSTGRES_PASSWORD: "Control Center Postgres/password",
  HOME_LAT: "Home Location/lat",
  HOME_LON: "Home Location/lon",
  HOME_PLACE_NAME: "Home Location/place_name",
  HOME_RADIUS_MILES: "Home Location/radius_miles",
  SPOTIFY_CLIENT_ID: "Spotify/client_id",
  SPOTIFY_CLIENT_SECRET: "Spotify/client_secret",
  SPOTIFY_REFRESH_TOKEN: "Spotify/refresh_token",
  RESEND_API_KEY: "Resend/credential",
  RESEND_FROM: "Resend/from-address",
};

// worker: mirrors api minus Resend (deploy-config.test.ts asserts the overlap
// stays in lockstep, CC-51hf.35).
const { RESEND_API_KEY: _r1, RESEND_FROM: _r2, ...workerSecrets } = apiSecrets;

/**
 * @public - the secret inventory per k8s workload. Consumed by eso.ts to emit
 * one ExternalSecret per service; the test asserts it matches deploy.config.ts.
 * web / storybook / captive-portal have NO secrets (absent here on purpose).
 */
export const SERVICE_SECRETS: Record<string, ServiceSecrets> = {
  api: apiSecrets,
  worker: workerSecrets,
  "media-worker": {
    POSTGRES_PASSWORD: "Control Center Postgres/password",
    OPENROUTER_API_KEY: "OpenRouter/credential",
  },
  drizzle: {
    MASTERPASS: "Drizzle Gateway/masterpass",
    POSTGRES_PASSWORD: "Control Center Postgres/password",
  },
  cloudflared: {
    TUNNEL_TOKEN: "Cloudflare Tunnel evee-webhooks/connector_token",
  },
  // The portal-data-purge CronJob (CC-j934.7) runs the api image's purge.js and
  // builds DATABASE_URL from the mounted POSTGRES_PASSWORD; it needs that one
  // secret synced into cc-secrets-portal-data-purge (the CronJob's default mount).
  "portal-data-purge": {
    POSTGRES_PASSWORD: "Control Center Postgres/password",
  },
};
