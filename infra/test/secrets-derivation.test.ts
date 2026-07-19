// Behaviour-preservation proof for the secrets single-declaration refactor.
//
// SERVICE_SECRETS / SERVICE_SECRET_TARGETS used to be hand-written in
// secrets-map.ts; they are now DERIVED from the @www/platform product manifest.
// This test pins the EXACT previous hand-written content as a golden snapshot, so
// any accidental change to env names, vault keys, target Secret names, or target
// namespaces fails loudly here. The deploy path (eso.ts creates native k8s
// Secrets from these maps) is unchanged only if these goldens keep matching.

import { describe, expect, test } from "vitest";
import { SERVICE_SECRET_TARGETS, SERVICE_SECRETS } from "../src/secrets-map.ts";

// The api/worker shared secret set (kept in lockstep, www-51hf.35). Pinned as a
// single literal so the golden below can't silently drift the two apart.
const SHARED_API_WORKER_SECRETS = {
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
  ASC_KEY_ID: "APP_STORE_CONNECT_API__KEY_ID",
  ASC_ISSUER_ID: "APP_STORE_CONNECT_API__ISSUER_ID",
  ASC_KEY_CONTENT: "APP_STORE_CONNECT_API__P8_CONTENT",
  GITHUB_ACTIONS_TOKEN: "GITHUB_PERSONAL_ACCESS_TOKEN__TOKEN",
} as const;

// The exact SERVICE_SECRETS map as it was hand-maintained before the derivation.
const GOLDEN_SERVICE_SECRETS: Record<string, Record<string, string>> = {
  api: SHARED_API_WORKER_SECRETS,
  worker: SHARED_API_WORKER_SECRETS,
  "media-worker": {
    POSTGRES_PASSWORD: "CONTROL_CENTER_POSTGRES__PASSWORD",
    OPENROUTER_API_KEY: "OPENROUTER__CREDENTIAL",
    APNS_KEY_ID: "APNS_AUTH_KEY__KEY_ID",
    APNS_TEAM_ID: "APNS_AUTH_KEY__TEAM_ID",
    APNS_KEY_CONTENT: "APNS_AUTH_KEY__P8_CONTENT",
  },
  drizzle: {
    MASTERPASS: "DRIZZLE_GATEWAY__MASTERPASS",
    POSTGRES_PASSWORD: "CONTROL_CENTER_POSTGRES__PASSWORD",
  },
  cloudflared: {
    TUNNEL_TOKEN: "CLOUDFLARE_TUNNEL_EVEE_WEBHOOKS__CONNECTOR_TOKEN",
  },
  "portal-data-purge": {
    POSTGRES_PASSWORD: "CONTROL_CENTER_POSTGRES__PASSWORD",
  },
  "captive-portal-api": {
    POSTGRES_PASSWORD: "CAPTIVE_PORTAL_POSTGRES__PASSWORD",
    UNIFI_API_KEY: "UNIFI__LOCAL_API_KEY",
    WIFI_PASSWORD: "WIFI_GUEST_CREDENTIALS__PASSWORD",
    WIFI_SSID: "WIFI_GUEST_CREDENTIALS__SSID",
  },
};

// The exact SERVICE_SECRET_TARGETS map as it was hand-maintained before.
const GOLDEN_SERVICE_SECRET_TARGETS: Record<string, { namespaceName: string; secretName: string }> =
  {
    api: { namespaceName: "control-center", secretName: "control-center-secrets-api" },
    worker: { namespaceName: "control-center", secretName: "control-center-secrets-worker" },
    "media-worker": {
      namespaceName: "control-center",
      secretName: "control-center-secrets-media-worker",
    },
    drizzle: { namespaceName: "control-center", secretName: "control-center-secrets-drizzle" },
    cloudflared: { namespaceName: "platform", secretName: "platform-secrets-cloudflared" },
    "portal-data-purge": {
      namespaceName: "control-center",
      secretName: "control-center-secrets-portal-data-purge",
    },
    "captive-portal-api": {
      namespaceName: "captive-portal",
      secretName: "captive-portal-secrets-api",
    },
  };

describe("secrets derivation (golden equivalence, single-declaration refactor)", () => {
  test("derived SERVICE_SECRETS EXACTLY equals the previous hand-written map", () => {
    expect(SERVICE_SECRETS).toEqual(GOLDEN_SERVICE_SECRETS);
  });

  test("derived SERVICE_SECRET_TARGETS EXACTLY equals the previous hand-written map", () => {
    expect(SERVICE_SECRET_TARGETS).toEqual(GOLDEN_SERVICE_SECRET_TARGETS);
  });

  test("the two maps cover exactly the same service keys", () => {
    expect(Object.keys(SERVICE_SECRETS).sort()).toEqual(Object.keys(SERVICE_SECRET_TARGETS).sort());
  });

  test("api/worker secret sets stay in lockstep (www-51hf.35)", () => {
    expect(SERVICE_SECRETS.worker).toEqual(SERVICE_SECRETS.api);
  });

  test("every mounted env name resolves to a VAULT_KEY (ITEM__FIELD, no op:// slash form)", () => {
    for (const secrets of Object.values(SERVICE_SECRETS)) {
      for (const vaultKey of Object.values(secrets)) {
        expect(vaultKey).not.toMatch(/\//);
        expect(vaultKey).toMatch(/__/);
        expect(vaultKey).toBe(vaultKey.toUpperCase());
      }
    }
  });

  test("web/storybook/captive-portal(app) have no secrets and are absent", () => {
    expect("web" in SERVICE_SECRETS).toBe(false);
    expect("storybook" in SERVICE_SECRETS).toBe(false);
    expect("captive-portal" in SERVICE_SECRETS).toBe(false);
  });
});
