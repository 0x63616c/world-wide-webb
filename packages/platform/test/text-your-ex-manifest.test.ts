import { describe, expect, test } from "vitest";
import { textYourExProductManifest } from "../src/index.ts";

describe("Text Your Ex platform representation", () => {
  test("uses local postgres names while retaining the legacy cluster for rollback", () => {
    const manifest = textYourExProductManifest();

    expect(manifest.database).toMatchObject({
      authSecretName: "postgres-auth",
      clusterName: "postgres",
      databaseName: "text_your_ex",
      owner: "postgres",
      readServiceName: "postgres-r",
      roServiceName: "postgres-ro",
      rwServiceName: "postgres-rw",
      size: "2Gi",
      storageClass: "local-path",
    });
    expect(manifest.retainedLegacyDatabases).toHaveLength(1);
    expect(manifest.retainedLegacyDatabases[0]).toMatchObject({
      authSecretName: "tye-postgres-auth",
      clusterName: "text-your-ex",
      readServiceName: "text-your-ex-r",
      roServiceName: "text-your-ex-ro",
      rwServiceName: "text-your-ex-rw",
      size: "2Gi",
    });
    expect(manifest.backup).toMatchObject({
      authSecretName: "postgres-auth",
      databaseName: "text_your_ex",
      filenamePrefix: "text_your_ex-",
      name: "tye-pg-backup",
      nasSubPath: "backups/world-wide-webb/text-your-ex/postgres",
      required: true,
      serviceHost: "postgres-rw",
    });
  });
});
