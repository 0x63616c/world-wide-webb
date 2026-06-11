// Pure, typed declaration vocabulary for the control-center k8s stack. This is
// the Pulumi-era successor to bosun's `service()` / `cronJob()` builders
// (packages/bosun/src/spec.ts): a workload is declared in ONE typed place, and
// the mapping layer (render.ts) turns a declaration into the kubernetes resource
// args. No I/O, no Pulumi calls here, so the shapes evaluate identically in a
// unit test and at `pulumi up` time.
//
// Resource caps carry over the www-ke9a values verbatim: `memory` is the HARD
// limit (k8s `limits.memory`); `reserveCpus`/`reserveMemory` become k8s
// `requests` (the scheduling floor). The mapping layer defaults `requests.memory`
// below the limit so the 8GB node schedules every workload.

/** A secret made available to a workload as a file at /run/secrets/<NAME>. */
export interface SecretRef {
  // Name as it appears in the container, and the file under /run/secrets.
  name: string;
  // 1Password reference resolved by External Secrets, NOT here (e.g.
  // "op://Homelab/Item/field"). Pure data; never a value.
  ref: string;
}

/** Container resource caps (www-ke9a). Mirrors bosun's ResourceSpec. */
export interface ResourceSpec {
  // Hard memory limit -> k8s limits.memory (e.g. "96M", "768M", "1G").
  memory?: string;
  // CPU reservation -> k8s requests.cpu (e.g. "0.5"). Soft scheduling floor.
  reserveCpus?: string;
  // Memory reservation -> k8s requests.memory. Defaults below the limit.
  reserveMemory?: string;
}

/** A container port the workload listens on. */
export interface PortSpec {
  // Container port number (e.g. 4201).
  containerPort: number;
  // How the port is exposed:
  //  - "cluster": a ClusterIP Service (internal only)
  //  - "lan": a LoadBalancer Service (OrbStack expose_services -> LAN, §5a)
  //  - "none": no Service (the workload reaches out but serves no traffic)
  expose: "cluster" | "lan" | "none";
}

/** A volume mount. Either a named PVC or an NFS PV (the DS420+ is NFSv3-only). */
export interface VolumeSpec {
  // Mount path inside the container.
  mountPath: string;
  // A local-path PVC by claim name...
  claim?: string;
  // ...or an NFS export. nfsvers=3 is mandatory (DS420+ speaks only v3); the
  // mapping layer emits mountOptions [nfsvers=3, nolock, tcp] for these.
  nfs?: { server: string; path: string };
  // Read-only mount (default false).
  readOnly?: boolean;
}

/** A declared workload: the single typed place a service is described. */
export interface WorkloadSpec {
  // Stable name (k8s object name + label selector).
  name: string;
  // Container image, fully qualified (GHCR ref or upstream).
  image: string;
  // Replica count. cloudflared runs 2 (HA); media-worker 1; most 1.
  replicas: number;
  // Resource caps (www-ke9a). Optional; mapping defaults requests sanely.
  resources?: ResourceSpec;
  // Secrets mounted at /run/secrets/<NAME> via External Secrets.
  secrets?: SecretRef[];
  // Plain (non-secret) environment variables.
  env?: Record<string, string>;
  // Container command override (argv). Optional.
  command?: string[];
  // Ports + how each is exposed.
  ports?: PortSpec[];
  // Volume mounts (PVC or NFS).
  volumes?: VolumeSpec[];
}

/**
 * A scheduled one-shot job (the cronJob() half of the vocabulary, succeeding
 * bosun's cronJob() from deploy.config.ts). Maps to a k8s CronJob with one-shot
 * semantics (restartPolicy Never, concurrencyPolicy Forbid).
 */
export interface CronJobSpec {
  // Stable name (k8s object name).
  name: string;
  // Container image, fully qualified.
  image: string;
  // Standard 5-field cron ("min hour dom mon dow"), in TZ from `env.TZ`.
  schedule: string;
  // Command override (argv).
  command?: string[];
  // Secrets mounted at /run/secrets/<NAME> via External Secrets.
  secrets?: SecretRef[];
  // Plain (non-secret) environment variables.
  env?: Record<string, string>;
  // Resource caps (www-ke9a).
  resources?: ResourceSpec;
  // Volume mounts (PVC or NFS), e.g. the map-extract / pg-backup output volumes.
  volumes?: VolumeSpec[];
  // Suspend the schedule (for manual-only jobs driven by `kubectl create job
  // --from=cronjob/...`, e.g. map-extract). Default false.
  suspend?: boolean;
}
