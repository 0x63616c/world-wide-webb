import { describe, expect, test } from "vitest";
import { renderExternalService, renderWorkload } from "../src/render.ts";
import { serviceSpecs } from "../src/services.ts";
import type { WorkloadSpec } from "../src/spec.ts";

// The mapping layer is pure: a WorkloadSpec -> the kubernetes resource ARG
// objects (Deployment + Services), with no Pulumi instantiation. This is the
// unit-testable core of the ComponentResource vocabulary (the thin Pulumi
// wrapper in component.ts just feeds these args to @pulumi/kubernetes).

const api: WorkloadSpec = {
  name: "api",
  image: "ghcr.io/0x63616c/control-center-api:main",
  replicas: 1,
  resources: { memory: "512M", reserveCpus: "0.5" },
  secrets: [{ name: "POSTGRES_PASSWORD", ref: "op://Homelab/Control Center Postgres/password" }],
  env: { NODE_ENV: "production", TZ: "America/Los_Angeles" },
  ports: [{ containerPort: 4201, expose: "cluster" }],
};

describe("renderWorkload", () => {
  test("maps the CC-ke9a memory cap to limits.memory and a smaller requests.memory", () => {
    const r = renderWorkload(api);
    const container = r.deployment.spec.template.spec.containers[0];
    expect(container.resources.limits.memory).toBe("512M");
    // requests.memory must be set (scheduling floor) and not exceed the limit.
    expect(container.resources.requests.memory).toBeDefined();
    expect(container.resources.requests.memory).not.toBe("512M");
  });

  test("maps reserveCpus to requests.cpu", () => {
    const r = renderWorkload(api);
    const container = r.deployment.spec.template.spec.containers[0];
    expect(container.resources.requests.cpu).toBe("0.5");
  });

  test("mounts each secret as a file under /run/secrets/<NAME> from one ExternalSecret-backed Secret", () => {
    const r = renderWorkload(api);
    const container = r.deployment.spec.template.spec.containers[0];
    const mount = container.volumeMounts.find((m) => m.mountPath === "/run/secrets");
    expect(mount).toBeDefined();
    expect(mount?.readOnly).toBe(true);
    // The secret rides a projected/secret volume, not env, so values never land
    // in the pod spec.
    const vol = r.deployment.spec.template.spec.volumes.find((v) => v.name === mount?.name);
    // Defaults to the ESO-synced Secret name cc-secrets-<name> (CC-j934.4).
    expect(vol?.secret?.secretName).toBe("cc-secrets-api");
  });

  test("plain env is passed through as env vars (no secret values)", () => {
    const r = renderWorkload(api);
    const container = r.deployment.spec.template.spec.containers[0];
    const names = container.env.map((e: { name: string }) => e.name);
    expect(names).toContain("NODE_ENV");
    expect(names).toContain("TZ");
    // A secret name must NOT appear as a plain env var (it's a file mount).
    expect(names).not.toContain("POSTGRES_PASSWORD");
  });

  test("expose:cluster yields a ClusterIP Service on the container port", () => {
    const r = renderWorkload(api);
    expect(r.services).toHaveLength(1);
    expect(r.services[0].spec.type).toBe("ClusterIP");
    expect(r.services[0].spec.ports[0].port).toBe(4201);
  });

  test("expose:lan yields a LoadBalancer Service (OrbStack LAN expose, §5a)", () => {
    const portal: WorkloadSpec = {
      name: "captive-portal",
      image: "ghcr.io/0x63616c/control-center-captive-portal:main",
      replicas: 1,
      ports: [
        { containerPort: 443, expose: "lan" },
        { containerPort: 80, expose: "lan" },
      ],
    };
    const r = renderWorkload(portal);
    expect(r.services).toHaveLength(1);
    expect(r.services[0].spec.type).toBe("LoadBalancer");
    const ports = r.services[0].spec.ports
      .map((p: { port: number }) => p.port)
      .sort((a, b) => a - b);
    expect(ports).toEqual([80, 443]);
  });

  test("expose:none yields no Service", () => {
    const worker: WorkloadSpec = {
      name: "worker",
      image: "ghcr.io/0x63616c/control-center-worker:main",
      replicas: 1,
    };
    expect(renderWorkload(worker).services).toHaveLength(0);
  });

  test("an NFS volume emits mountOptions [nfsvers=3, nolock, tcp] (DS420+ is NFSv3-only, §5b)", () => {
    const media: WorkloadSpec = {
      name: "media-worker",
      image: "ghcr.io/0x63616c/control-center-media-worker:main",
      replicas: 1,
      volumes: [
        {
          mountPath: "/app/media",
          nfs: { server: "192.168.0.218", path: "/volume1/Homelab/media" },
        },
      ],
    };
    const r = renderWorkload(media);
    expect(r.persistentVolumes).toHaveLength(1);
    const pv = r.persistentVolumes[0];
    expect(pv.spec.mountOptions).toEqual(["nfsvers=3", "nolock", "tcp"]);
    expect(pv.spec.nfs.server).toBe("192.168.0.218");
    expect(pv.spec.nfs.path).toBe("/volume1/Homelab/media");
  });

  test("replicas are honored (cloudflared HA = 2)", () => {
    const cf: WorkloadSpec = {
      name: "cloudflared",
      image: "cloudflare/cloudflared:2025.10.1",
      replicas: 2,
    };
    expect(renderWorkload(cf).deployment.spec.replicas).toBe(2);
  });
});

describe("renderWorkload: CC-j934.6 extensions", () => {
  test("secretName defaults to cc-secrets-<name>, override honored", () => {
    const def = renderWorkload(api).deployment.spec.template.spec.volumes.find(
      (v) => v.name === "secrets",
    );
    expect(def?.secret?.secretName).toBe("cc-secrets-api");
    const over = renderWorkload({ ...api, secretName: "custom-secret" });
    const vol = over.deployment.spec.template.spec.volumes.find((v) => v.name === "secrets");
    expect(vol?.secret?.secretName).toBe("custom-secret");
  });

  test("imagePullSecrets land on the pod spec", () => {
    const r = renderWorkload({ ...api, imagePullSecrets: ["ghcr-pull"] });
    expect(r.deployment.spec.template.spec.imagePullSecrets).toEqual([{ name: "ghcr-pull" }]);
  });

  test("no imagePullSecrets field when none declared", () => {
    const r = renderWorkload(api);
    expect(r.deployment.spec.template.spec.imagePullSecrets).toBeUndefined();
  });

  test("extraSecretMounts mount a secret as files at their own path (portal TLS)", () => {
    const portal: WorkloadSpec = {
      name: "captive-portal",
      image: "ghcr.io/0x63616c/control-center-captive-portal:main",
      replicas: 1,
      resources: { memory: "64M" },
      extraSecretMounts: [{ secretName: "captive-portal-tls", mountPath: "/etc/tls" }],
      ports: [{ containerPort: 443, expose: "lan" }],
    };
    const r = renderWorkload(portal);
    const mount = r.deployment.spec.template.spec.containers[0].volumeMounts.find(
      (m) => m.mountPath === "/etc/tls",
    );
    expect(mount).toBeDefined();
    expect(mount?.readOnly).toBe(true);
    const vol = r.deployment.spec.template.spec.volumes.find((v) => v.name === mount?.name);
    expect(vol?.secret?.secretName).toBe("captive-portal-tls");
  });
});

describe("renderWorkload: NFS PV + PVC pair (CC-j934.6)", () => {
  test("an NFS volume emits a statically-bound PVC alongside the PV", () => {
    const mw: WorkloadSpec = {
      name: "media-worker",
      image: "ghcr.io/0x63616c/control-center-media-worker:main",
      replicas: 1,
      resources: { memory: "1G" },
      volumes: [
        {
          mountPath: "/app/media",
          nfs: { server: "192.168.0.218", path: "/volume1/Homelab/media" },
        },
      ],
    };
    const r = renderWorkload(mw);
    expect(r.persistentVolumes).toHaveLength(1);
    expect(r.persistentVolumeClaims).toHaveLength(1);
    // PVC binds to the PV by name, storageClassName "" (no dynamic provisioner).
    const pvc = r.persistentVolumeClaims[0];
    expect(pvc.spec.volumeName).toBe(r.persistentVolumes[0].metadata.name);
    expect(pvc.spec.storageClassName).toBe("");
    expect(r.persistentVolumes[0].spec.storageClassName).toBe("");
    // The pod mounts the PVC of the same name.
    const vol = r.deployment.spec.template.spec.volumes.find((v) => v.persistentVolumeClaim);
    expect(vol?.persistentVolumeClaim?.claimName).toBe(pvc.metadata.name);
  });
});

describe("renderExternalService (ExternalName CNAME to an off-cluster host)", () => {
  test("emits an ExternalName Service aliasing the in-cluster name to the external FQDN", () => {
    const r = renderExternalService("ha", "homelab.tail8c014d.ts.net");
    expect(r.service.spec.type).toBe("ExternalName");
    expect(r.service.spec.externalName).toBe("homelab.tail8c014d.ts.net");
    expect(r.service.metadata.name).toBe("ha");
  });
});

describe("serviceSpecs (media-worker NFS server is configurable, CC-j934.17)", () => {
  const mediaWorkerOf = (specs: WorkloadSpec[]) => specs.find((s) => s.name === "media-worker");

  test("threads nasNfsServer into the media-worker NFS volume", () => {
    const specs = serviceSpecs(1, "100.78.116.99");
    const vol = mediaWorkerOf(specs)?.volumes?.[0];
    expect(vol?.nfs?.server).toBe("100.78.116.99");
    expect(vol?.nfs?.path).toBe("/volume1/Homelab");
    expect(vol?.subPath).toBe("media");
  });

  test("media-worker replicas come from the mediaWorkerReplicas arg (parked at 0)", () => {
    expect(mediaWorkerOf(serviceSpecs(0, "192.168.0.218"))?.replicas).toBe(0);
    expect(mediaWorkerOf(serviceSpecs(1, "192.168.0.218"))?.replicas).toBe(1);
  });
});
