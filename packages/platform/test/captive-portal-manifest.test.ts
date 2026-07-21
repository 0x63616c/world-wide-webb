import { describe, expect, test } from "vitest";
import { captivePortalProductManifest } from "../src/index.ts";

describe("Captive Portal platform representation", () => {
  test("declares Captive Portal identity, LAN app surface, and internal API", () => {
    const manifest = captivePortalProductManifest();

    expect(manifest.product.slug).toBe("captive-portal");
    expect(manifest.product.namespace).toBe("captive-portal");
    expect(manifest.app.exposure).toMatchObject({
      kind: "captive-portal-web",
      hostname: "app--cp.worldwidewebb.co",
      policy: "captive",
    });
    expect(manifest.services.api.exposure).toMatchObject({
      kind: "internal-service",
      port: 4211,
    });
    expect(manifest.services.app.image).toBe("ghcr.io/0x63616c/www-captive-portal-portal:main");
    expect(manifest.services.api.image).toBe("ghcr.io/0x63616c/www-captive-portal-api:main");
  });

  test("declares a product-owned CNPG database and mandatory NAS backup", () => {
    const manifest = captivePortalProductManifest();

    expect(manifest.database).toMatchObject({
      authSecretName: "postgres-auth",
      clusterName: "postgres",
      databaseName: "captive_portal",
      owner: "postgres",
      readServiceName: "postgres-r",
      roServiceName: "postgres-ro",
      rwServiceName: "postgres-rw",
      size: "2Gi",
      storageClass: "local-path",
    });
    expect(manifest.retainedLegacyDatabases).toHaveLength(1);
    expect(manifest.retainedLegacyDatabases[0]).toMatchObject({
      authSecretName: "captive-portal-postgres-auth",
      clusterName: "captive-portal",
      readServiceName: "captive-portal-r",
      roServiceName: "captive-portal-ro",
      rwServiceName: "captive-portal-rw",
    });
    expect(manifest.backup).toMatchObject({
      authSecretName: "postgres-auth",
      databaseName: "captive_portal",
      filenamePrefix: "captive_portal-",
      name: "captive-portal-pg-backup",
      nasSubPath: "backups/world-wide-webb/captive-portal/postgres",
      required: true,
      serviceHost: "postgres-rw",
    });
  });

  test("declares product API secret access without reusing Control Center database credentials", () => {
    const manifest = captivePortalProductManifest();

    expect(manifest.secretUsages.api).toMatchObject({
      product: "captive-portal",
      service: "api",
      targetSecretName: "captive-portal-secrets-api",
    });
    expect(Object.keys(manifest.secretUsages.api.secrets).sort()).toEqual([
      "POSTGRES_PASSWORD",
      "UNIFI_API_KEY",
      "WIFI_PASSWORD",
      "WIFI_SSID",
    ]);
    expect(manifest.secretUsages.api.secrets.POSTGRES_PASSWORD.vaultKey).toBe(
      "CAPTIVE_PORTAL_POSTGRES__PASSWORD",
    );
  });
});
