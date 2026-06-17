// The per-service secret inventory: the source of truth for what each service
// mounts at /run/secrets/<NAME>. Each value is a VAULT_KEY in secrets/vault.yaml
// (ITEM__FIELD format). vault.ts reads the vault and creates a native k8s Secret
// per service (CC-k8t7: migrated from ESO+1Password to SOPS+age).

/** A service's secret env-name -> VAULT_KEY in secrets/vault.yaml. */
export type ServiceSecrets = Record<string, string>;

// api: full secret set. Resend was removed when the captive portal went
// password-only (www-p9hx); the 1Password "Resend" item is kept for audit but
// no longer synced to any workload.
const apiSecrets: ServiceSecrets = {
  HA_TOKEN: "HOME_ASSISTANT_TOKEN__CREDENTIAL",
  UNIFI_API_KEY: "UNIFI__LOCAL_API_KEY",
  WIFI_SSID: "WIFI_GUEST_CREDENTIALS__SSID",
  WIFI_PASSWORD: "WIFI_GUEST_CREDENTIALS__PASSWORD",
  POSTGRES_PASSWORD: "CONTROL_CENTER_POSTGRES__PASSWORD",
  HOME_LAT: "HOME_LOCATION__LAT",
  HOME_LON: "HOME_LOCATION__LON",
  HOME_PLACE_NAME: "HOME_LOCATION__PLACE_NAME",
  HOME_RADIUS_MILES: "HOME_LOCATION__RADIUS_MILES",
  SPOTIFY_CLIENT_ID: "SPOTIFY__CLIENT_ID",
  SPOTIFY_CLIENT_SECRET: "SPOTIFY__CLIENT_SECRET",
  SPOTIFY_REFRESH_TOKEN: "SPOTIFY__REFRESH_TOKEN",
};

// worker: identical to api (the api/worker secret sets are kept in lockstep;
// deploy-config.test.ts asserts the overlap, www-51hf.35).
const workerSecrets: ServiceSecrets = { ...apiSecrets };

/**
 * @public - the secret inventory per k8s workload. Consumed by secrets.ts to
 * emit one native k8s Secret per service; the test asserts it matches deploy.config.ts.
 * web / storybook / captive-portal have NO secrets (absent here on purpose).
 */
export const SERVICE_SECRETS: Record<string, ServiceSecrets> = {
  api: apiSecrets,
  worker: workerSecrets,
  "media-worker": {
    POSTGRES_PASSWORD: "CONTROL_CENTER_POSTGRES__PASSWORD",
    OPENROUTER_API_KEY: "OPENROUTER__CREDENTIAL",
  },
  drizzle: {
    MASTERPASS: "DRIZZLE_GATEWAY__MASTERPASS",
    POSTGRES_PASSWORD: "CONTROL_CENTER_POSTGRES__PASSWORD",
  },
  cloudflared: {
    TUNNEL_TOKEN: "CLOUDFLARE_TUNNEL_EVEE_WEBHOOKS__CONNECTOR_TOKEN",
  },
  // The portal-data-purge CronJob (www-j934.7) runs the api image's purge.js and
  // builds DATABASE_URL from the mounted POSTGRES_PASSWORD; it needs that one
  // secret synced into cc-secrets-portal-data-purge (the CronJob's default mount).
  "portal-data-purge": {
    POSTGRES_PASSWORD: "CONTROL_CENTER_POSTGRES__PASSWORD",
  },
  // tye-api reads /run/secrets/POSTGRES_PASSWORD (POSTGRES_PASSWORD_FILE default)
  // to build its DATABASE_URL pointing at the text-your-ex CNPG cluster (text-your-ex-rw).
  // vault key: TEXT_YOUR_EX_POSTGRES__PASSWORD
  "tye-api": {
    POSTGRES_PASSWORD: "TEXT_YOUR_EX_POSTGRES__PASSWORD",
  },
};
