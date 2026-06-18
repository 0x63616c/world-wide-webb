import { describe, expect, test } from "vitest";
import { SERVICE_SECRETS, type ServiceSecrets } from "../../../infra/src/secrets-map.ts";
import {
  controlCenterServiceSecretUsages,
  defineProduct,
  defineServiceSecretUsage,
  secretCatalog,
  serviceSecretMap,
  textYourExProductManifest,
} from "../src/index.ts";

describe("secret catalog and service usage", () => {
  test("models refs as 1Password Homelab item/field references, not values", () => {
    expect(secretCatalog.homeAssistant.token).toEqual({
      field: "credential",
      item: "Home Assistant Token",
      opPath: "op://Homelab/Home Assistant Token/credential",
      remoteRef: "Home Assistant Token/credential",
    });
  });

  test("derives service scoped secret mount metadata from product context", () => {
    const usage = defineServiceSecretUsage(defineProduct("control-center"), "api", {
      HA_TOKEN: secretCatalog.homeAssistant.token,
    });

    expect(usage).toMatchObject({
      mountPath: "/run/secrets",
      product: "control-center",
      service: "api",
      targetSecretName: "control-center-secrets-api",
    });
  });

  test("env-key coverage: platform secret usages and infra SERVICE_SECRETS agree on env names per service (CC-k8t7: values now vault keys not remoteRef)", () => {
    // SERVICE_SECRETS values are now vault keys (ITEM__FIELD), not 1P remoteRef.
    // Assert env-name set coverage only; value format changed in CC-k8t7.
    const tye = textYourExProductManifest().secretUsages;
    const tyePrefixed = Object.fromEntries(
      Object.entries(tye).map(([svc, usage]) => [`tye-${svc}`, usage]),
    );
    const allUsages = { ...controlCenterServiceSecretUsages(), ...tyePrefixed };
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
      ...textYourExProductManifest().secretUsages,
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
