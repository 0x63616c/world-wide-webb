import { describe, expect, test } from "vitest";
import { defineTarget, homelabTarget, implementedTargetNames, targetStatus } from "../src/index.ts";

describe("target model", () => {
  test("implements homelab as the only runtime target", () => {
    expect(implementedTargetNames).toEqual(["homelab"]);
    expect(defineTarget("homelab")).toEqual(homelabTarget);
  });

  test("carries homelab-owned platform constants", () => {
    expect(homelabTarget).toMatchObject({
      name: "homelab",
      domain: "worldwidewebb.co",
      timezone: "America/Los_Angeles",
      nas: {
        exportPath: "/volume1/Homelab",
        backupRootParts: ["backups", "world-wide-webb"],
      },
      capabilities: {
        certManager: true,
        cloudflareTunnel: true,
        cnpg: true,
        externalSecrets: true,
        k8s: true,
        nasBackups: true,
      },
    });
  });

  test("reports future targets as unsupported instead of silently accepting them", () => {
    expect(targetStatus("cloud")).toEqual({
      kind: "unsupported",
      name: "cloud",
      reason: "Only homelab k8s is implemented in this migration.",
    });
  });
});
