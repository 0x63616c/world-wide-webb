// Behaviour-preservation proof for the secrets single-declaration refactor.
//
// SERVICE_SECRETS / SERVICE_SECRET_TARGETS used to be hand-written in
// secrets-map.ts; they are now DERIVED from the @www/platform product manifest.
// This test pins the EXACT expected content as a golden snapshot, so any
// accidental change to env names, vault keys, target Secret names, or target
// namespaces fails loudly here. Updated deliberately by The Simplification,
// which deleted the UniFi/Wi-Fi/Spotify/APNs/Withings/GitHub-App/App-Store-
// Connect service secrets along with the features that read them. The deploy
// path (eso.ts creates native k8s Secrets from these maps) is unchanged only if
// these goldens keep matching.

import { describe, expect, test } from "vitest";
import { SERVICE_SECRET_TARGETS, SERVICE_SECRETS } from "../src/secrets-map.ts";

// The api/worker shared secret set (kept in lockstep, www-51hf.35). Pinned as a
// single literal so the golden below can't silently drift the two apart.
const SHARED_API_WORKER_SECRETS = {
  HA_TOKEN: "HOME_ASSISTANT_TOKEN__CREDENTIAL",
  POSTGRES_PASSWORD: "CONTROL_CENTER_POSTGRES__PASSWORD",
  HOME_LAT: "HOME_LOCATION__LAT",
  HOME_LON: "HOME_LOCATION__LON",
} as const;

// The exact SERVICE_SECRETS map every workload is expected to mount.
const GOLDEN_SERVICE_SECRETS: Record<string, Record<string, string>> = {
  api: SHARED_API_WORKER_SECRETS,
  worker: SHARED_API_WORKER_SECRETS,
  cloudflared: {
    TUNNEL_TOKEN: "CLOUDFLARE_TUNNEL_WORLD_WIDE_WEBB__CONNECTOR_TOKEN",
  },
};

// The exact SERVICE_SECRET_TARGETS map.
const GOLDEN_SERVICE_SECRET_TARGETS: Record<string, { namespaceName: string; secretName: string }> =
  {
    api: { namespaceName: "control-center", secretName: "control-center-secrets-api" },
    worker: { namespaceName: "control-center", secretName: "control-center-secrets-worker" },
    cloudflared: { namespaceName: "cloudflare", secretName: "cloudflare-secrets-cloudflared" },
  };

describe("secrets derivation (golden equivalence, single-declaration refactor)", () => {
  test("derived SERVICE_SECRETS EXACTLY equals the golden map", () => {
    expect(SERVICE_SECRETS).toEqual(GOLDEN_SERVICE_SECRETS);
  });

  test("derived SERVICE_SECRET_TARGETS EXACTLY equals the golden map", () => {
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
        // Flat SCREAMING_SNAKE vault key: no slash (vault.ts does a flat
        // lookup; ITEM__FIELD double-underscore is convention, not contract).
        expect(vaultKey).not.toMatch(/\//);
        expect(vaultKey).toMatch(/^[A-Z0-9_]+$/);
      }
    }
  });

  test("web/manage have no secrets and are absent", () => {
    expect("web" in SERVICE_SECRETS).toBe(false);
    expect("manage" in SERVICE_SECRETS).toBe(false);
    // Retired services keep their absence pinned so a revival is deliberate.
    expect("captive-portal" in SERVICE_SECRETS).toBe(false);
    expect("portal-data-purge" in SERVICE_SECRETS).toBe(false);
  });
});
