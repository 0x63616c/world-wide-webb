import { describe, expect, test } from "vitest";
import { SERVICE_SECRETS, type ServiceSecrets } from "../../../infra/src/secrets-map.ts";
import {
  captivePortalProductManifest,
  controlCenterServiceSecretUsages,
  defineProduct,
  defineServiceSecretUsage,
  secretCatalog,
  serviceSecretMap,
} from "../src/index.ts";

describe("secret catalog and service usage", () => {
  test("models secrets by their SOPS vault key, keeping 1Password item/field as provenance", () => {
    expect(secretCatalog.homeAssistant.token).toEqual({
      field: "credential",
      item: "Home Assistant Token",
      vaultKey: "HOME_ASSISTANT_TOKEN__CREDENTIAL",
    });
  });

  test("derives service scoped secret mount metadata from product context", () => {
    const usage = defineServiceSecretUsage(defineProduct("control-center"), "api", {
      HA_TOKEN: secretCatalog.homeAssistant.token,
    });

    expect(usage).toMatchObject({
      mountPath: "/run/secrets",
      namespaceName: "control-center",
      product: "control-center",
      service: "api",
      targetSecretName: "control-center-secrets-api",
    });
  });

  test("env-key coverage: platform secret usages and infra SERVICE_SECRETS agree on env names per service (CC-k8t7: values now vault keys not remoteRef)", () => {
    // SERVICE_SECRETS values are now vault keys (ITEM__FIELD), not 1P remoteRef.
    // Assert env-name set coverage only; value format changed in CC-k8t7.
    const captivePortal = captivePortalProductManifest().secretUsages;
    const captivePortalPrefixed = Object.fromEntries(
      Object.entries(captivePortal).map(([svc, usage]) => [`captive-portal-${svc}`, usage]),
    );
    const allUsages = { ...controlCenterServiceSecretUsages(), ...captivePortalPrefixed };
    const platformMap = serviceSecretMap(allUsages);
    const infraSecretMap = SERVICE_SECRETS as Record<string, ServiceSecrets>;
    for (const [service, platformSecrets] of Object.entries(platformMap)) {
      const infraKeys = Object.keys(infraSecretMap[service] ?? {}).sort();
      const platformKeys = Object.keys(platformSecrets).sort();
      expect(infraKeys).toEqual(platformKeys);
    }
  });

  test("keeps services with no declared secrets absent", () => {
    const secrets = serviceSecretMap(controlCenterServiceSecretUsages());

    expect("web" in secrets).toBe(false);
    expect("storybook" in secrets).toBe(false);
    expect("captive-portal" in secrets).toBe(false);
  });

  test("product service usages no longer use cc-secrets compatibility names", () => {
    const usages = {
      ...controlCenterServiceSecretUsages(),
      ...captivePortalProductManifest().secretUsages,
    };

    expect(controlCenterServiceSecretUsages().api.targetSecretName).toBe(
      "control-center-secrets-api",
    );
    expect(controlCenterServiceSecretUsages().cloudflared.targetSecretName).toBe(
      "platform-secrets-cloudflared",
    );
    for (const usage of Object.values(usages)) {
      expect(usage.targetSecretName).not.toMatch(/^cc-secrets-/);
    }
  });
});
