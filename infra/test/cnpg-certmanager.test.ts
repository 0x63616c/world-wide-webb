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

let cnpg: typeof import("../src/cnpg.ts");
let cm: typeof import("../src/certmanager.ts");
beforeAll(async () => {
  cnpg = await import("../src/cnpg.ts");
  cm = await import("../src/certmanager.ts");
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

const provider = () => new k8s.Provider("test", { context: "x" });

describe("installCnpg", () => {
  test("single-instance Cluster on local-path with the www-ke9a 768M cap, bridged credential", async () => {
    const res = cnpg.installCnpg({
      provider: provider(),
      namespace: "control-center",
      operatorVersion: "1.29.1",
    });
    const spec = await get<{
      instances: number;
      storage: { storageClass: string };
      resources: { limits: { memory: string }; requests: { memory: string; cpu: string } };
      bootstrap: { initdb: { database: string; owner: string; secret: { name: string } } };
      superuserSecret: { name: string };
    }>(res.cluster, "spec");
    expect(spec.instances).toBe(1);
    expect(spec.storage.storageClass).toBe("local-path");
    expect(spec.resources.limits.memory).toBe("768Mi");
    expect(spec.resources.requests.cpu).toBe("500m");
    // Adopt the bridged password (NOT a generated one): both refs point at the
    // same ESO-synced basic-auth secret, and the DB/owner match the app.
    expect(spec.bootstrap.initdb.database).toBe("control_center");
    expect(spec.bootstrap.initdb.owner).toBe("postgres");
    expect(spec.bootstrap.initdb.secret.name).toBe(spec.superuserSecret.name);
  });

  test("the auth ExternalSecret builds a kubernetes.io/basic-auth secret", async () => {
    const res = cnpg.installCnpg({
      provider: provider(),
      namespace: "control-center",
      operatorVersion: "1.29.1",
    });
    const spec = await get<{
      target: { template: { type: string; data: Record<string, string> } };
    }>(res.authSecret, "spec");
    expect(spec.target.template.type).toBe("kubernetes.io/basic-auth");
    expect(spec.target.template.data.username).toBe("postgres");
  });
});

describe("installCertManager", () => {
  test("the CF-token ExternalSecret lives in the cert-manager namespace, not the app ns", async () => {
    const res = cm.installCertManager({
      provider: provider(),
      namespace: "control-center",
      version: "v1.20.2",
    });
    const meta = await get<{ namespace: string }>(res.cfTokenSecret, "metadata");
    // ClusterIssuer solver reads its token from the controller's namespace.
    expect(meta.namespace).toBe("cert-manager");
  });

  test("the ClusterIssuer is DNS-01 via Cloudflare, no email when unset", async () => {
    const res = cm.installCertManager({
      provider: provider(),
      namespace: "control-center",
      version: "v1.20.2",
    });
    const spec = await get<{
      acme: { email?: string; solvers: { dns01: { cloudflare: unknown } }[] };
    }>(res.issuer, "spec");
    expect(spec.acme.solvers[0].dns01.cloudflare).toBeDefined();
    expect(spec.acme.email).toBeUndefined();
  });

  test("the portal Certificate is for the LAN portal host", async () => {
    const res = cm.installCertManager({
      provider: provider(),
      namespace: "control-center",
      version: "v1.20.2",
    });
    const spec = await get<{ dnsNames: string[]; secretName: string }>(res.certificate, "spec");
    expect(spec.dnsNames).toContain("captive-portal.worldwidewebb.co");
    expect(spec.secretName).toBe("captive-portal-tls");
  });
});
