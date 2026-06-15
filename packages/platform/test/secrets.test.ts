import { describe, expect, test } from "vitest";
import { SERVICE_SECRETS } from "../../../infra/src/secrets-map.ts";
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

  test("can represent all deployed service secrets exactly (CC + TYE)", () => {
    // SERVICE_SECRETS covers every workload that has an ESO ExternalSecret.
    // Merge CC usages (keyed by service name) with TYE usages (prefixed tye-<service>
    // to avoid key collision with CC's own "api" key).
    const tye = textYourExProductManifest().secretUsages;
    const tyePrefixed = Object.fromEntries(
      Object.entries(tye).map(([svc, usage]) => [`tye-${svc}`, usage]),
    );
    const allUsages = { ...controlCenterServiceSecretUsages(), ...tyePrefixed };
    expect(serviceSecretMap(allUsages)).toEqual(SERVICE_SECRETS);
  });

  test("keeps services with no declared secrets absent", () => {
    const secrets = serviceSecretMap(controlCenterServiceSecretUsages());

    expect("web" in secrets).toBe(false);
    expect("storybook" in secrets).toBe(false);
    expect("captive-portal" in secrets).toBe(false);
  });

  test("supports current compatibility secret names without changing the future convention", () => {
    const usage = controlCenterServiceSecretUsages().api;

    expect(usage.targetSecretName).toBe("cc-secrets-api");
    expect(
      defineServiceSecretUsage(defineProduct("control-center"), "api", {
        HA_TOKEN: secretCatalog.homeAssistant.token,
      }).targetSecretName,
    ).toBe("control-center-secrets-api");
  });
});
