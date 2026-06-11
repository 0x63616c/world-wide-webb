import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as pulumi from "@pulumi/pulumi";
import { beforeAll, describe, expect, test } from "vitest";

pulumi.runtime.setMocks({
  newResource(args: pulumi.runtime.MockResourceArgs) {
    return { id: `${args.name}-id`, state: args.inputs };
  },
  call() {
    return {};
  },
});

let eso: typeof import("../src/eso.ts");
let map: typeof import("../src/secrets-map.ts");
beforeAll(async () => {
  eso = await import("../src/eso.ts");
  map = await import("../src/secrets-map.ts");
});

function get<T>(r: pulumi.Resource, prop: string): Promise<T> {
  const out = (r as unknown as Record<string, pulumi.Output<T>>)[prop];
  return new Promise((resolve) => {
    out.apply((v) => {
      resolve(v);
      return v;
    });
  });
}

describe("SERVICE_SECRETS", () => {
  test("worker mirrors api minus the Resend keys (lockstep, CC-51hf.35)", () => {
    const api = Object.keys(map.SERVICE_SECRETS.api).sort();
    const worker = Object.keys(map.SERVICE_SECRETS.worker).sort();
    expect(api).toContain("RESEND_API_KEY");
    expect(api).toContain("RESEND_FROM");
    expect(worker).not.toContain("RESEND_API_KEY");
    expect(worker).not.toContain("RESEND_FROM");
    // Every non-Resend api key is present in worker, identical ref.
    for (const [k, v] of Object.entries(map.SERVICE_SECRETS.api)) {
      if (k.startsWith("RESEND_")) continue;
      expect(map.SERVICE_SECRETS.worker[k]).toBe(v);
    }
  });

  test("services with no secrets are absent (web/storybook/captive-portal)", () => {
    expect("web" in map.SERVICE_SECRETS).toBe(false);
    expect("storybook" in map.SERVICE_SECRETS).toBe(false);
    expect("captive-portal" in map.SERVICE_SECRETS).toBe(false);
  });

  test("every ref is an Item/field suffix (no leading op:// or vault, no value)", () => {
    for (const secrets of Object.values(map.SERVICE_SECRETS)) {
      for (const ref of Object.values(secrets)) {
        expect(ref).toMatch(/^[^/]+\/[^/]+$/);
        expect(ref.startsWith("op://")).toBe(false);
      }
    }
  });

  test("stays in lockstep with deploy.config.ts (every mapped ref appears there)", () => {
    // Guard against drift: deploy.config.ts is the source of truth until bosun
    // is removed. Each "Item/field" ref must still be present in that file.
    const cfg = readFileSync(join(__dirname, "../../deploy.config.ts"), "utf8");
    for (const secrets of Object.values(map.SERVICE_SECRETS)) {
      for (const ref of Object.values(secrets)) {
        expect(cfg.includes(`"${ref}"`)).toBe(true);
      }
    }
  });
});

describe("installEso", () => {
  test("emits one ExternalSecret per service, each with matching data entries", async () => {
    const provider = new (await import("@pulumi/kubernetes")).Provider("test", { context: "x" });
    const res = eso.installEso({ provider, appNamespace: "control-center", chartVersion: "2.6.0" });
    expect(res.externalSecrets).toHaveLength(Object.keys(map.SERVICE_SECRETS).length);

    // The api ExternalSecret carries all 14 api refs as data[].remoteRef.key.
    const apiEs = res.externalSecrets[0];
    const spec = await get<{
      refreshInterval: string;
      data: { secretKey: string; remoteRef: { key: string } }[];
    }>(apiEs, "spec");
    const apiCount = Object.keys(map.SERVICE_SECRETS.api).length;
    expect(spec.data).toHaveLength(apiCount);
    const keys = spec.data.map((d) => d.remoteRef.key);
    expect(keys).toContain("Home Assistant Token/credential");
    expect(keys).toContain("Resend/from-address");
    // refreshInterval set so rotations propagate without a redeploy (AC).
    expect(spec.refreshInterval).toBe("1h");
  });
});
