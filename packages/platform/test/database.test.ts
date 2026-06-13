import { describe, expect, test } from "vitest";
import { defineProduct, defineProductDatabase, homelabTarget } from "../src/index.ts";

describe("product CNPG database primitive", () => {
  test("renders current Control Center CNPG identity without behavior change", () => {
    const database = defineProductDatabase(defineProduct("control-center"), homelabTarget, {
      authSecretName: "cc-postgres-auth",
      size: "5Gi",
    });

    expect(database).toMatchObject({
      authSecretName: "cc-postgres-auth",
      clusterName: "control-center",
      databaseName: "control_center",
      owner: "postgres",
      rwServiceName: "control-center-rw",
      size: "5Gi",
      storageClass: "local-path",
      target: "homelab",
      resources: {
        limits: { memory: "768Mi" },
        requests: { cpu: "500m", memory: "384Mi" },
      },
    });
  });

  test("derives per-product defaults from product identity", () => {
    const database = defineProductDatabase(defineProduct("text-your-ex"), homelabTarget, {
      size: "5Gi",
    });

    expect(database.databaseName).toBe("text_your_ex");
    expect(database.authSecretName).toBe("text-your-ex-postgres-auth");
    expect(database.rwServiceName).toBe("text-your-ex-rw");
  });

  test("marks database-owned auth separately from service secret usage", () => {
    const database = defineProductDatabase(defineProduct("control-center"), homelabTarget, {
      authSecretName: "cc-postgres-auth",
      size: "5Gi",
    });

    expect(database.auth.kind).toBe("database-owned-basic-auth");
    expect(database.auth.secretName).toBe("cc-postgres-auth");
  });
});
