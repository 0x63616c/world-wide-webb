// Pure mapping layer: a WorkloadSpec -> the kubernetes resource arg objects
// (Deployment + Services + any NFS PersistentVolumes). No Pulumi, no I/O, so it
// is unit-testable in plain vitest. The ComponentResource wrapper (component.ts)
// feeds these args straight into @pulumi/kubernetes. Keeping the mapping pure and
// the Pulumi instantiation thin mirrors bosun's spec/reconcile split.

import type { CronJobSpec, SecretRef, VolumeSpec, WorkloadSpec } from "./spec.ts";

// Minimal structural types for the k8s arg objects we emit. We type only the
// fields the stack actually sets; @pulumi/kubernetes accepts these shapes.
interface EnvVar {
  name: string;
  value: string;
}
interface VolumeMount {
  name: string;
  mountPath: string;
  readOnly?: boolean;
}
interface PodVolume {
  name: string;
  secret?: { secretName: string };
  persistentVolumeClaim?: { claimName: string };
}
interface Container {
  name: string;
  image: string;
  command?: string[];
  env: EnvVar[];
  resources: {
    limits: Record<string, string>;
    requests: Record<string, string>;
  };
  volumeMounts: VolumeMount[];
}
interface DeploymentArgs {
  metadata: { name: string; labels: Record<string, string> };
  spec: {
    replicas: number;
    selector: { matchLabels: Record<string, string> };
    template: {
      metadata: { labels: Record<string, string> };
      spec: { containers: Container[]; volumes: PodVolume[] };
    };
  };
}
interface ServiceArgs {
  metadata: { name: string; labels: Record<string, string> };
  spec: {
    type: "ClusterIP" | "LoadBalancer";
    selector: Record<string, string>;
    ports: { name: string; port: number; targetPort: number }[];
  };
}
interface PersistentVolumeArgs {
  metadata: { name: string };
  spec: {
    capacity: Record<string, string>;
    accessModes: string[];
    mountOptions: string[];
    nfs: { server: string; path: string };
  };
}

export interface RenderedWorkload {
  deployment: DeploymentArgs;
  services: ServiceArgs[];
  persistentVolumes: PersistentVolumeArgs[];
}

// NFS mount options are mandatory for the Synology DS420+, which speaks ONLY
// NFSv3; a kubelet v4 default mount gets "Connection refused" (Phase 0b spike,
// DESIGN.md §5b). Every NFS PV the stack emits carries these.
const NFS_MOUNT_OPTIONS = ["nfsvers=3", "nolock", "tcp"];

// Parse a compose-style byte-suffix size ("512M", "1G") into MiB for arithmetic.
function sizeToMib(size: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([KMG])?i?B?$/i.exec(size.trim());
  if (!m) throw new Error(`unparseable memory size: ${size}`);
  const value = Number(m[1]);
  const unit = (m[2] ?? "M").toUpperCase();
  const mult = unit === "G" ? 1024 : unit === "K" ? 1 / 1024 : 1;
  return value * mult;
}

// Default a requests.memory below the hard limit so the 8GB node can schedule
// every workload (the limit is the ceiling, the request the scheduling floor).
// Half the limit, floored at 32Mi, is a conservative reservation.
function defaultRequestMemory(limit: string): string {
  const half = Math.max(32, Math.floor(sizeToMib(limit) / 2));
  return `${half}M`;
}

// The fields shared by a Deployment workload and a CronJob: the container + its
// pod volumes. Secrets ride a /run/secrets file mount (never env), NFS volumes
// emit a PV with the mandatory v3 mount options.
interface PodInputs {
  name: string;
  image: string;
  command?: string[];
  resources?: { memory?: string; reserveCpus?: string; reserveMemory?: string };
  secrets?: SecretRef[];
  env?: Record<string, string>;
  volumes?: VolumeSpec[];
}

function buildPod(p: PodInputs): {
  container: Container;
  podVolumes: PodVolume[];
  persistentVolumes: PersistentVolumeArgs[];
} {
  const limits: Record<string, string> = {};
  const requests: Record<string, string> = {};
  if (p.resources?.memory) {
    limits.memory = p.resources.memory;
    requests.memory = p.resources.reserveMemory ?? defaultRequestMemory(p.resources.memory);
  }
  if (p.resources?.reserveCpus) {
    requests.cpu = p.resources.reserveCpus;
  }

  const env: EnvVar[] = Object.entries(p.env ?? {}).map(([name, value]) => ({ name, value }));

  const volumeMounts: VolumeMount[] = [];
  const podVolumes: PodVolume[] = [];
  const persistentVolumes: PersistentVolumeArgs[] = [];

  // Secrets: one k8s Secret per object (named after it), synced by an
  // ExternalSecret, projected as files under /run/secrets so values never appear
  // in the pod spec and images keep reading the same paths (DESIGN.md §3).
  if (p.secrets && p.secrets.length > 0) {
    volumeMounts.push({ name: "secrets", mountPath: "/run/secrets", readOnly: true });
    podVolumes.push({ name: "secrets", secret: { secretName: p.name } });
  }

  for (const [i, vol] of (p.volumes ?? []).entries()) {
    const volName = `vol-${i}`;
    volumeMounts.push({ name: volName, mountPath: vol.mountPath, readOnly: vol.readOnly });
    if (vol.nfs) {
      const pvName = `${p.name}-${volName}`;
      persistentVolumes.push({
        metadata: { name: pvName },
        spec: {
          capacity: { storage: "1Gi" },
          accessModes: ["ReadWriteMany"],
          mountOptions: NFS_MOUNT_OPTIONS,
          nfs: { server: vol.nfs.server, path: vol.nfs.path },
        },
      });
      podVolumes.push({ name: volName, persistentVolumeClaim: { claimName: pvName } });
    } else if (vol.claim) {
      podVolumes.push({ name: volName, persistentVolumeClaim: { claimName: vol.claim } });
    }
  }

  const container: Container = {
    name: p.name,
    image: p.image,
    ...(p.command ? { command: p.command } : {}),
    env,
    resources: { limits, requests },
    volumeMounts,
  };

  return { container, podVolumes, persistentVolumes };
}

export function renderWorkload(w: WorkloadSpec): RenderedWorkload {
  const labels = { app: w.name };

  const { container, podVolumes, persistentVolumes } = buildPod(w);

  const deployment: DeploymentArgs = {
    metadata: { name: w.name, labels },
    spec: {
      replicas: w.replicas,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: { containers: [container], volumes: podVolumes },
      },
    },
  };

  // --- Services: group exposed ports by type into one Service ---
  const services: ServiceArgs[] = [];
  const exposed = (w.ports ?? []).filter((p) => p.expose !== "none");
  if (exposed.length > 0) {
    // A workload exposes one Service; "lan" (LoadBalancer) wins over "cluster"
    // if mixed, since a LAN-exposed workload is reached from off-cluster.
    const type = exposed.some((p) => p.expose === "lan") ? "LoadBalancer" : "ClusterIP";
    services.push({
      metadata: { name: w.name, labels },
      spec: {
        type,
        selector: labels,
        ports: exposed.map((p) => ({
          name: `p${p.containerPort}`,
          port: p.containerPort,
          targetPort: p.containerPort,
        })),
      },
    });
  }

  return { deployment, services, persistentVolumes };
}

interface CronJobArgs {
  metadata: { name: string; labels: Record<string, string> };
  spec: {
    schedule: string;
    suspend: boolean;
    concurrencyPolicy: "Forbid";
    successfulJobsHistoryLimit: number;
    failedJobsHistoryLimit: number;
    jobTemplate: {
      spec: {
        template: {
          metadata: { labels: Record<string, string> };
          spec: { containers: Container[]; volumes: PodVolume[]; restartPolicy: "Never" };
        };
      };
    };
  };
}

export interface RenderedCronJob {
  cronJob: CronJobArgs;
  persistentVolumes: PersistentVolumeArgs[];
}

export function renderCronJob(c: CronJobSpec): RenderedCronJob {
  const labels = { app: c.name };
  const { container, podVolumes, persistentVolumes } = buildPod(c);

  const cronJob: CronJobArgs = {
    metadata: { name: c.name, labels },
    spec: {
      schedule: c.schedule,
      // Manual-only jobs (map-extract) ship suspended; the schedule stays the
      // declarative record and `kubectl create job --from=cronjob/...` runs it.
      suspend: c.suspend ?? false,
      // One-shot semantics: never overlap runs, never restart a failed run.
      concurrencyPolicy: "Forbid",
      successfulJobsHistoryLimit: 3,
      failedJobsHistoryLimit: 1,
      jobTemplate: {
        spec: {
          template: {
            metadata: { labels },
            spec: { containers: [container], volumes: podVolumes, restartPolicy: "Never" },
          },
        },
      },
    },
  };

  return { cronJob, persistentVolumes };
}
