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
  test("worker mirrors api minus the Resend keys (lockstep, www-51hf.35)", () => {
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
});

describe("SERVICE_SECRETS: tye-api (www-jtp0)", () => {
  test("tye-api entry present with POSTGRES_PASSWORD pointing at the TYE 1P item", () => {
    expect("tye-api" in map.SERVICE_SECRETS).toBe(true);
    expect(map.SERVICE_SECRETS["tye-api"].POSTGRES_PASSWORD).toBe("text-your-ex Postgres/password");
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

  test("tye-api ExternalSecret targets cc-secrets-tye-api with POSTGRES_PASSWORD (www-jtp0)", async () => {
    const provider = new (await import("@pulumi/kubernetes")).Provider("test2", { context: "x" });
    const res = eso.installEso({ provider, appNamespace: "control-center", chartVersion: "2.6.0" });

    // Resolve all specs and find the one whose target Secret is cc-secrets-tye-api.
    const allSpecs = await Promise.all(
      res.externalSecrets.map((es) =>
        get<{
          target: { name: string };
          data: { secretKey: string; remoteRef: { key: string } }[];
        }>(es, "spec"),
      ),
    );
    const tyeSpec = allSpecs.find((s) => s.target.name === "cc-secrets-tye-api");
    expect(tyeSpec).toBeDefined();
    expect(tyeSpec?.data).toHaveLength(1);
    expect(tyeSpec?.data[0].secretKey).toBe("POSTGRES_PASSWORD");
    expect(tyeSpec?.data[0].remoteRef.key).toBe("text-your-ex Postgres/password");
  });
});
