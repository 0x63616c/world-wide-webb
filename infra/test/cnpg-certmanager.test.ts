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

// Mock vault with all postgres passwords used by CNPG (CC-k8t7).
const mockVault: Record<string, string> = {
  CONTROL_CENTER_POSTGRES__PASSWORD: "mock-cc-pw",
  CAPTIVE_PORTAL_POSTGRES__PASSWORD: "mock-cp-pw",
};

const testNamespaces = {
  "control-center": "control-center",
  "captive-portal": "captive-portal",
  platform: "platform",
} as const;

describe("installCnpg", () => {
  test("single-instance Cluster on local-path with the www-ke9a 768M cap, bridged credential", async () => {
    const res = cnpg.installCnpg({
      provider: provider(),
      namespaces: testNamespaces,
      operatorVersion: "1.29.1",
      vault: mockVault,
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
    // Bridged password: both refs point at the same native basic-auth secret.
    expect(spec.bootstrap.initdb.database).toBe("control_center");
    expect(spec.bootstrap.initdb.owner).toBe("postgres");
    expect(spec.bootstrap.initdb.secret.name).toBe(spec.superuserSecret.name);
  });

  test("the auth Secret is kubernetes.io/basic-auth with username=postgres (CC-k8t7)", async () => {
    const res = cnpg.installCnpg({
      provider: provider(),
      namespaces: testNamespaces,
      operatorVersion: "1.29.1",
      vault: mockVault,
    });
    const type = await get<string>(res.authSecret, "type");
    const stringData = await get<{ username: string }>(res.authSecret, "stringData");
    expect(type).toBe("kubernetes.io/basic-auth");
    expect(stringData.username).toBe("postgres");
  });

  test("installs product databases and retains legacy DBs during local-name migrations", async () => {
    const res = cnpg.installCnpg({
      provider: provider(),
      namespaces: testNamespaces,
      operatorVersion: "1.29.1",
      vault: mockVault,
    });

    expect(res.clusters).toHaveLength(3);
    expect(res.authSecrets).toHaveLength(3);

    const clusterSpecs = await Promise.all(
      res.clusters.map((cluster) =>
        get<{
          instances: number;
          bootstrap: { initdb: { database: string } };
          storage: { size: string; storageClass: string };
          resources: { limits: { memory: string }; requests: { cpu: string; memory: string } };
          superuserSecret: { name: string };
        }>(cluster, "spec"),
      ),
    );
    expect(clusterSpecs.map((spec) => spec.bootstrap.initdb.database).sort()).toEqual([
      "captive_portal",
      "captive_portal",
      "control_center",
    ]);
    expect(
      clusterSpecs.find(
        (spec) =>
          spec.bootstrap.initdb.database === "captive_portal" &&
          spec.superuserSecret.name === "postgres-auth",
      ),
    ).toMatchObject({
      instances: 1,
      storage: { size: "2Gi" },
      resources: { limits: { memory: "768Mi" }, requests: { cpu: "500m", memory: "384Mi" } },
      superuserSecret: { name: "postgres-auth" },
    });
    expect(
      clusterSpecs.find(
        (spec) =>
          spec.bootstrap.initdb.database === "captive_portal" &&
          spec.superuserSecret.name === "captive-portal-postgres-auth",
      ),
    ).toBeDefined();
  });

  test("creates product database resources in their owning namespaces", async () => {
    const res = cnpg.installCnpg({
      provider: provider(),
      namespaces: testNamespaces,
      operatorVersion: "1.29.1",
      vault: mockVault,
    });

    const clusterMetadata = await Promise.all(
      res.clusters.map((cluster) => get<{ name: string; namespace: string }>(cluster, "metadata")),
    );
    const secretMetadata = await Promise.all(
      res.authSecrets.map((secret) => get<{ name: string; namespace: string }>(secret, "metadata")),
    );

    expect(clusterMetadata.find((m) => m.name === "control-center")?.namespace).toBe(
      "control-center",
    );
    expect(
      clusterMetadata.find((m) => m.name === "postgres" && m.namespace === "captive-portal"),
    ).toBeDefined();
    expect(clusterMetadata.find((m) => m.name === "captive-portal")?.namespace).toBe(
      "captive-portal",
    );
    expect(
      secretMetadata.find((m) => m.name === "postgres-auth" && m.namespace === "captive-portal"),
    ).toBeDefined();
    expect(secretMetadata.find((m) => m.name === "captive-portal-postgres-auth")?.namespace).toBe(
      "captive-portal",
    );
  });
});

describe("installCertManager", () => {
  test("the CF-token Secret lives in the cert-manager namespace, not the app ns", async () => {
    const res = cm.installCertManager({
      provider: provider(),
      namespace: "control-center",
      version: "v1.20.2",
      vault: { CLOUDFLARE_API__CREDENTIAL: "test-token" },
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
      vault: { CLOUDFLARE_API__CREDENTIAL: "test-token" },
    });
    const spec = await get<{
      acme: { email?: string; solvers: { dns01: { cloudflare: unknown } }[] };
    }>(res.issuer, "spec");
    expect(spec.acme.solvers[0].dns01.cloudflare).toBeDefined();
    expect(spec.acme.email).toBeUndefined();
  });

  test("the portal Certificate covers the legacy and nested app.cp LAN hosts", async () => {
    const res = cm.installCertManager({
      provider: provider(),
      namespace: "captive-portal",
      version: "v1.20.2",
      vault: { CLOUDFLARE_API__CREDENTIAL: "test-token" },
    });
    const meta = await get<{ namespace: string }>(res.certificate, "metadata");
    const spec = await get<{ dnsNames: string[]; secretName: string }>(res.certificate, "spec");
    expect(meta.namespace).toBe("captive-portal");
    expect(spec.dnsNames).toEqual(["captive-portal.worldwidewebb.co", "app--cp.worldwidewebb.co"]);
    expect(spec.secretName).toBe("captive-portal-tls");
  });
});
