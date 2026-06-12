// Pure mapping layer: a WorkloadSpec -> the kubernetes resource arg objects
// (Deployment + Services + any NFS PersistentVolumes). No Pulumi, no I/O, so it
// is unit-testable in plain vitest. The ComponentResource wrapper (component.ts)
// feeds these args straight into @pulumi/kubernetes. Keeping the mapping pure and
// the Pulumi instantiation thin keeps a clean spec/render split.

import type {
  CronJobSpec,
  InitContainerSpec,
  SecretRef,
  VolumeSpec,
  WorkloadSpec,
} from "./spec.ts";

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
  subPath?: string;
}
interface PodVolume {
  name: string;
  secret?: { secretName: string; items?: { key: string; path: string }[] };
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
      spec: {
        containers: Container[];
        initContainers?: Container[];
        volumes: PodVolume[];
        imagePullSecrets?: { name: string }[];
        automountServiceAccountToken?: boolean;
      };
    };
  };
}
interface ServiceArgs {
  metadata: { name: string; labels: Record<string, string> };
  spec: {
    type: "ClusterIP" | "LoadBalancer";
    selector?: Record<string, string>;
    ports: { name: string; port: number; targetPort: number }[];
  };
}
// An ExternalName Service: a CNAME-style alias from an in-cluster name to an
// external DNS name. The consuming workload talks to the Service name and the
// port lives in its URL (e.g. http://ha:8123 -> CNAME homelab.tail8c014d.ts.net).
interface ExternalNameServiceArgs {
  metadata: { name: string; labels: Record<string, string> };
  spec: { type: "ExternalName"; externalName: string };
}
export interface RenderedExternalService {
  service: ExternalNameServiceArgs;
}
interface PersistentVolumeArgs {
  metadata: { name: string };
  spec: {
    capacity: Record<string, string>;
    accessModes: string[];
    mountOptions: string[];
    nfs: { server: string; path: string };
    storageClassName: string;
  };
}
// A PVC that statically binds to an NFS PV by name (storageClassName "" so the
// default provisioner doesn't try to dynamically provision it). The pod mounts
// the PVC, which binds to the PV the same render emits.
interface PersistentVolumeClaimArgs {
  metadata: { name: string };
  spec: {
    accessModes: string[];
    storageClassName: string;
    volumeName: string;
    resources: { requests: { storage: string } };
  };
}

export interface RenderedWorkload {
  deployment: DeploymentArgs;
  services: ServiceArgs[];
  persistentVolumes: PersistentVolumeArgs[];
  persistentVolumeClaims: PersistentVolumeClaimArgs[];
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
  // The Secret projected at /run/secrets; defaults to cc-secrets-<name> (ESO).
  secretName?: string;
  // Extra secrets mounted as files at a path (e.g. the portal TLS cert).
  // `items` projects/renames specific keys to file paths (e.g. a cert-manager
  // tls.crt -> the fullchain.pem filename nginx expects).
  extraSecretMounts?: {
    secretName: string;
    mountPath: string;
    items?: { key: string; path: string }[];
  }[];
}

function claimVolumeName(claimVolumeNames: Map<string, string>, claim: string, fallback: string) {
  const existing = claimVolumeNames.get(claim);
  if (existing) return existing;
  claimVolumeNames.set(claim, fallback);
  return fallback;
}

function buildPod(p: PodInputs): {
  container: Container;
  podVolumes: PodVolume[];
  persistentVolumes: PersistentVolumeArgs[];
  persistentVolumeClaims: PersistentVolumeClaimArgs[];
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
  const persistentVolumeClaims: PersistentVolumeClaimArgs[] = [];
  const claimVolumeNames = new Map<string, string>();

  // Secrets: the ESO-synced Secret (cc-secrets-<name> by default), projected as
  // files under /run/secrets so values never appear in the pod spec and images
  // keep reading the same paths (DESIGN.md §3 / www-j934.4).
  if (p.secrets && p.secrets.length > 0) {
    volumeMounts.push({ name: "secrets", mountPath: "/run/secrets", readOnly: true });
    podVolumes.push({
      name: "secrets",
      secret: { secretName: p.secretName ?? `cc-secrets-${p.name}` },
    });
  }

  // Extra secrets mounted as files at their own path (e.g. the portal's
  // cert-manager TLS Secret for nginx). Distinct from the /run/secrets rail.
  for (const [i, m] of (p.extraSecretMounts ?? []).entries()) {
    const volName = `xsec-${i}`;
    volumeMounts.push({ name: volName, mountPath: m.mountPath, readOnly: true });
    podVolumes.push({
      name: volName,
      secret: { secretName: m.secretName, ...(m.items ? { items: m.items } : {}) },
    });
  }

  for (const [i, vol] of (p.volumes ?? []).entries()) {
    const fallbackVolName = `vol-${i}`;
    const volName = vol.claim
      ? claimVolumeName(claimVolumeNames, vol.claim, fallbackVolName)
      : fallbackVolName;
    volumeMounts.push({
      name: volName,
      mountPath: vol.mountPath,
      readOnly: vol.readOnly,
      ...(vol.subPath ? { subPath: vol.subPath } : {}),
    });
    if (vol.nfs) {
      const pvName = `${p.name}-${volName}`;
      // A statically-bound PV + PVC pair (storageClassName "" so the default
      // provisioner stays out of it; the PVC binds to this exact PV by name).
      persistentVolumes.push({
        metadata: { name: pvName },
        spec: {
          capacity: { storage: "1Gi" },
          accessModes: ["ReadWriteMany"],
          mountOptions: NFS_MOUNT_OPTIONS,
          nfs: { server: vol.nfs.server, path: vol.nfs.path },
          storageClassName: "",
        },
      });
      persistentVolumeClaims.push({
        metadata: { name: pvName },
        spec: {
          accessModes: ["ReadWriteMany"],
          storageClassName: "",
          volumeName: pvName,
          resources: { requests: { storage: "1Gi" } },
        },
      });
      podVolumes.push({ name: volName, persistentVolumeClaim: { claimName: pvName } });
    } else if (vol.claim) {
      if (volName === fallbackVolName) {
        podVolumes.push({ name: volName, persistentVolumeClaim: { claimName: vol.claim } });
      }
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

  return { container, podVolumes, persistentVolumes, persistentVolumeClaims };
}

// Map an InitContainerSpec to a Container + its pod volumes. When an init
// container mounts the SAME claim as the main container, reuse that pod volume:
// Kubernetes applies readOnly/subPath at the VolumeMount level, and rendering two
// pod volumes for one local-path claim wedges the OrbStack/k3s pod sandbox.
function buildInitContainer(
  ic: InitContainerSpec,
  idx: number,
  claimVolumeNames: Map<string, string>,
): { container: Container; podVolumes: PodVolume[] } {
  const volumeMounts: VolumeMount[] = [];
  const podVolumes: PodVolume[] = [];
  for (const [j, vol] of (ic.volumes ?? []).entries()) {
    if (!vol.claim) {
      throw new Error(`initContainer ${ic.name}: only claim-named PVC volumes are supported`);
    }
    const fallbackVolName = `init${idx}-vol-${j}`;
    const volName = claimVolumeName(claimVolumeNames, vol.claim, fallbackVolName);
    volumeMounts.push({
      name: volName,
      mountPath: vol.mountPath,
      ...(vol.readOnly ? { readOnly: true } : {}),
      ...(vol.subPath ? { subPath: vol.subPath } : {}),
    });
    if (volName === fallbackVolName) {
      podVolumes.push({ name: volName, persistentVolumeClaim: { claimName: vol.claim } });
    }
  }
  return {
    container: {
      name: ic.name,
      image: ic.image,
      ...(ic.command ? { command: ic.command } : {}),
      env: Object.entries(ic.env ?? {}).map(([name, value]) => ({ name, value })),
      resources: { limits: {}, requests: {} },
      volumeMounts,
    },
    podVolumes,
  };
}

export function renderWorkload(w: WorkloadSpec): RenderedWorkload {
  const labels = { app: w.name };

  const { container, podVolumes, persistentVolumes, persistentVolumeClaims } = buildPod(w);
  const claimVolumeNames = new Map(
    podVolumes.flatMap((v) =>
      v.persistentVolumeClaim ? [[v.persistentVolumeClaim.claimName, v.name] as const] : [],
    ),
  );

  const inits = (w.initContainers ?? []).map((ic, i) =>
    buildInitContainer(ic, i, claimVolumeNames),
  );

  const deployment: DeploymentArgs = {
    metadata: { name: w.name, labels },
    spec: {
      replicas: w.replicas,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          containers: [container],
          ...(inits.length > 0 ? { initContainers: inits.map((i) => i.container) } : {}),
          volumes: [...podVolumes, ...inits.flatMap((i) => i.podVolumes)],
          ...(w.imagePullSecrets && w.imagePullSecrets.length > 0
            ? { imagePullSecrets: w.imagePullSecrets.map((name) => ({ name })) }
            : {}),
          // App pods don't call the k8s API; disabling the serviceaccount token
          // automount avoids its projection at /var/run/secrets/kubernetes.io,
          // which collides with our read-only /run/secrets mount (/var/run ->
          // /run symlink makes /run/secrets read-only, blocking the SA mountpoint
          // → ContainerCannotRun). www-j934.6.
          automountServiceAccountToken: false,
        },
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

  return { deployment, services, persistentVolumes, persistentVolumeClaims };
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
          spec: {
            containers: Container[];
            volumes: PodVolume[];
            restartPolicy: "Never";
            automountServiceAccountToken: boolean;
            imagePullSecrets?: { name: string }[];
          };
        };
      };
    };
  };
}

export interface RenderedCronJob {
  cronJob: CronJobArgs;
  persistentVolumes: PersistentVolumeArgs[];
  persistentVolumeClaims: PersistentVolumeClaimArgs[];
}

export function renderCronJob(c: CronJobSpec): RenderedCronJob {
  const labels = { app: c.name };
  const { container, podVolumes, persistentVolumes, persistentVolumeClaims } = buildPod(c);

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
            spec: {
              containers: [container],
              volumes: podVolumes,
              restartPolicy: "Never",
              // Cron pods don't call the k8s API; disabling the serviceaccount
              // token automount avoids its projection at
              // /var/run/secrets/kubernetes.io, which collides with the
              // read-only /run/secrets mount (/var/run -> /run symlink makes
              // /run/secrets read-only, blocking the SA mountpoint ->
              // ContainerCannotRun). Mirrors renderWorkload (www-j934.6 / .7).
              automountServiceAccountToken: false,
              ...(c.imagePullSecrets && c.imagePullSecrets.length > 0
                ? { imagePullSecrets: c.imagePullSecrets.map((name) => ({ name })) }
                : {}),
            },
          },
        },
      },
    },
  };

  return { cronJob, persistentVolumes, persistentVolumeClaims };
}

/**
 * An ExternalName Service: a CNAME-style alias from an in-cluster name to an
 * external DNS host. The api/worker reach Home Assistant via `ha` (HA_URL
 * http://ha:8123), which CNAMEs to the host's tailscale FQDN.
 *
 * WHY the tailnet FQDN, not the host LAN IP or host.orb.internal (www-j934.17):
 * OrbStack k8s pods CANNOT reach the home LAN (192.168.0.0/24) or raw host
 * ports via host.orb.internal (structural: the flannel plane has no route to
 * the LAN; #342). But pods DO have internet egress via the Mac's stack, and the
 * Mac routes its OWN tailscale IP locally (utun) to its 0.0.0.0-bound socats, so
 * `<host>.<tailnet>.ts.net:8123` is delivered straight to the existing HA socat.
 * The tailnet FQDN resolves in-cluster (CoreDNS upstream) and is stable +
 * already-core infra, so it lives in this one ExternalName, not scattered in env.
 */
export function renderExternalService(name: string, externalName: string): RenderedExternalService {
  return {
    service: {
      metadata: { name, labels: { app: name } },
      spec: { type: "ExternalName", externalName },
    },
  };
}
