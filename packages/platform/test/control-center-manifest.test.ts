import { describe, expect, test } from "vitest";
import { cronSpecs } from "../../../infra/src/crons.ts";
import { SERVICE_SECRETS } from "../../../infra/src/secrets-map.ts";
import { controlCenterProductManifest, serviceSecretMap } from "../src/index.ts";

describe("Control Center platform representation", () => {
  test("declares Control Center app identity and target app surface", () => {
    const manifest = controlCenterProductManifest();

    expect(manifest.product.slug).toBe("control-center");
    expect(manifest.app.exposure.hostname).toBe("app--cc.worldwidewebb.co");
    expect(manifest.app.legacyHostname).toBe("dashboard.worldwidewebb.co");
  });

  test("declares every Control Center workload with namespace-local names", () => {
    const manifest = controlCenterProductManifest();
    const manifestNames = Object.values(manifest.services)
      .map((service) => service.workloadName)
      .sort();

    expect(manifestNames).toEqual([
      "api",
      "captive-portal",
      "cloudflared",
      "drizzle",
      "media-worker",
      "storybook",
      "web",
      "worker",
    ]);
  });

  test("declares full-slug GHCR image intent and keeps external images unchanged", () => {
    const manifest = controlCenterProductManifest();

    expect(manifest.services.api.image).toBe("ghcr.io/0x63616c/www-control-center-api:main");
    expect(manifest.services.web.image).toBe("ghcr.io/0x63616c/www-control-center-web:main");
    expect(manifest.services.cloudflared.image).toBe("cloudflare/cloudflared:2025.10.1");
  });

  test("keeps current service secret usage exactly representable (CC-k8t7: env names only, values now vault keys)", () => {
    const manifest = controlCenterProductManifest();
    // SERVICE_SECRETS values are now vault keys (CC-k8t7). Assert env-name set only.
    const ccMap = serviceSecretMap(manifest.secretUsages);
    for (const [service, platformSecrets] of Object.entries(ccMap)) {
      const infraKeys = Object.keys(SERVICE_SECRETS[service] ?? {}).sort();
      const platformKeys = Object.keys(platformSecrets).sort();
      expect(infraKeys).toEqual(platformKeys);
    }
  });

  test("keeps current database and backup behavior representable", () => {
    const manifest = controlCenterProductManifest();
    const backupCron = cronSpecs("192.168.0.218").find((cron) => cron.name === "pg-backup");

    expect(manifest.database).toMatchObject({
      authSecretName: "cc-postgres-auth",
      clusterName: "control-center",
      databaseName: "control_center",
      rwServiceName: "control-center-rw",
    });
    expect(manifest.backup).toMatchObject({
      name: backupCron?.name,
      schedule: backupCron?.schedule,
      databaseName: "control_center",
      serviceHost: "control-center-rw",
      nasSubPath: "backups/postgres",
    });
  });
});
