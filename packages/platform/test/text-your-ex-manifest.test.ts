import { describe, expect, test } from "vitest";
import { textYourExProductManifest } from "../src/index.ts";

describe("Text Your Ex platform representation", () => {
  test("keeps the live CNPG database on legacy names until migration cutover", () => {
    const manifest = textYourExProductManifest();

    expect(manifest.database).toMatchObject({
      authSecretName: "tye-postgres-auth",
      clusterName: "text-your-ex",
      databaseName: "text_your_ex",
      owner: "postgres",
      readServiceName: "text-your-ex-r",
      roServiceName: "text-your-ex-ro",
      rwServiceName: "text-your-ex-rw",
      size: "2Gi",
      storageClass: "local-path",
    });
    expect(manifest.backup).toMatchObject({
      authSecretName: "tye-postgres-auth",
      databaseName: "text_your_ex",
      filenamePrefix: "text_your_ex-",
      name: "tye-pg-backup",
      nasSubPath: "backups/world-wide-webb/text-your-ex/postgres",
      required: true,
      serviceHost: "text-your-ex-rw",
    });
  });
});
