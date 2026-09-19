import { describe, expect, test } from "vitest";
import {
  defineDatabaseBackup,
  defineProduct,
  defineProductDatabase,
  homelabTarget,
} from "../src/index.ts";

describe("platform backup primitive", () => {
  test("renders current Control Center pg-backup compatibility output", () => {
    const database = defineProductDatabase(defineProduct("control-center"), homelabTarget, {
      authSecretName: "cc-postgres-auth",
      clusterName: "control-center",
      rwServiceName: "control-center-rw",
      size: "5Gi",
    });
    const backup = defineDatabaseBackup(database, homelabTarget, {
      name: "pg-backup",
      nasSubPathParts: ["backups", "postgres"],
      schedule: "0 1 * * *",
    });

    expect(backup).toMatchObject({
      authMountPath: "/run/pgauth",
      backupMountPath: "/backup",
      databaseName: "control_center",
      image: "ghcr.io/cloudnative-pg/postgresql:18",
      name: "pg-backup",
      nasExportPath: "/volume1/Homelab",
      nasSubPath: "backups/postgres",
      owner: "postgres",
      required: true,
      schedule: "0 1 * * *",
      serviceHost: "control-center-rw",
    });
  });

  test("preserves the pg_dump backup filename date format", () => {
    const database = defineProductDatabase(defineProduct("control-center"), homelabTarget, {
      authSecretName: "cc-postgres-auth",
      size: "5Gi",
    });
    const backup = defineDatabaseBackup(database, homelabTarget);

    expect(backup.dateFormat).toBe("%Y%m%d");
  });
});
