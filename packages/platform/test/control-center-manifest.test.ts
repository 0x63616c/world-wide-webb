import { describe, expect, test } from "vitest";
import { cronSpecs } from "../../../infra/src/crons.ts";
import { SERVICE_SECRETS } from "../../../infra/src/secrets-map.ts";
import { serviceSpecs } from "../../../infra/src/services.ts";
import { controlCenterProductManifest, serviceSecretMap } from "../src/index.ts";

const baseServiceOptions = {
  cloudflaredReplicas: 2,
  drizzleReplicas: 0,
  mediaWorkerReplicas: 0,
  nasNfsServer: "192.168.0.218",
  storybookReplicas: 0,
};

// Workloads owned by other products, excluded from the Control Center manifest
// comparison: amp (amp-app) and text-your-ex (tye-api, tye-frontend).
const separateProductWorkloads = new Set(["amp-app", "tye-api", "tye-frontend"]);

describe("Control Center platform representation", () => {
  test("declares Control Center app identity and target app surface", () => {
    const manifest = controlCenterProductManifest();

    expect(manifest.product.slug).toBe("control-center");
    expect(manifest.app.exposure.hostname).toBe("app.cc.worldwidewebb.co");
    expect(manifest.app.legacyHostname).toBe("dashboard.worldwidewebb.co");
  });

  test("declares every current Control Center workload without renaming it", () => {
    const manifest = controlCenterProductManifest();
    const currentNames = serviceSpecs(baseServiceOptions)
      .filter((service) => !separateProductWorkloads.has(service.name))
      .map((service) => service.name)
      .sort();
    const manifestNames = Object.values(manifest.services)
      .map((service) => service.workloadName)
      .sort();

    expect(manifestNames).toEqual(currentNames);
  });

  test("keeps current GHCR and external image behavior representable", () => {
    const manifest = controlCenterProductManifest();
    const currentImages = Object.fromEntries(
      serviceSpecs(baseServiceOptions).map((service) => [service.name, service.image]),
    );

    expect(manifest.services.api.image).toBe(currentImages.api);
    expect(manifest.services.web.image).toBe(currentImages.web);
    expect(manifest.services.cloudflared.image).toBe(currentImages.cloudflared);
  });

  test("keeps current service secret usage exactly representable", () => {
    const manifest = controlCenterProductManifest();

    expect(serviceSecretMap(manifest.secretUsages)).toEqual(SERVICE_SECRETS);
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
