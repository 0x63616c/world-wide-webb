import * as k8s from "@pulumi/kubernetes";
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

let cluster: typeof import("../src/cluster.ts");
let component: typeof import("../src/component.ts");

beforeAll(async () => {
  cluster = await import("../src/cluster.ts");
  component = await import("../src/component.ts");
});

function get<T>(r: pulumi.Resource, prop: string): Promise<T> {
  const out = (r as unknown as Record<string, pulumi.Output<T>>)[prop];
  return new Promise((resolve) => {
    out.apply((value) => {
      resolve(value);
      return value;
    });
  });
}

describe("cluster namespaces", () => {
  test("creates product-owned namespaces plus the platform namespace", async () => {
    const res = cluster.makeCluster("test-context");

    expect(Object.keys(res.namespaces).sort()).toEqual([
      "amp",
      "captive-portal",
      "control-center",
      "platform",
      "text-your-ex",
    ]);

    const controlCenterMeta = await get<{ name: string }>(
      res.namespaces["control-center"],
      "metadata",
    );
    const platformMeta = await get<{ name: string }>(res.namespaces.platform, "metadata");
    expect(controlCenterMeta.name).toBe("control-center");
    expect(platformMeta.name).toBe("platform");
  });
});

describe("Workload logical names", () => {
  test("keeps k8s metadata local while Pulumi uses the product-scoped logical name", async () => {
    const provider = new k8s.Provider("component-test", { context: "x" });
    const workload = new component.Workload({
      logicalName: "control-center-api",
      name: "api",
      namespace: "control-center",
      provider,
      image: "ghcr.io/0x63616c/www-control-center-api:main",
      replicas: 1,
      ports: [{ containerPort: 4201, expose: "cluster" }],
    });

    const deploymentMeta = await get<{ name: string; namespace: string }>(
      workload.deployment,
      "metadata",
    );
    const urn = await get<string>(workload, "urn");

    expect(deploymentMeta).toMatchObject({ name: "api", namespace: "control-center" });
    expect(urn).toContain("control-center-api");
  });
});
