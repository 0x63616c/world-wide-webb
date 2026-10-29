// The scheduled jobs for the control-center Talos stack (www-j934.7): the cronJob()
// declarations for the cluster. Only infra-level work remains here: the pg/HA
// backups. Every retention purge
// migrated to App-owned Worker cycles declared from feature facets (issue
// #260) — the whole generated-cron seam (crons.gen.ts + `bun cron.js <name>`)
// is deleted.
//
// Deliberately ABSENT vs the prior scheduler set (DESIGN.md §2):
//  - docker-image-prune: kubelet image GC replaces it (high 85% / low 80%); an
//    external `docker image prune` breaks kubelet's image accounting (RECON
//    decision 7), so NO image-prune CronJob exists on k3s.
//  - portal-cert-renew: the acme.sh cron is retired; cert-manager owns the portal
//    TLS Certificate + its renewal window (www-j934.5), nothing to schedule here.
//
// Each cron is a CronJobSpec fed to the ScheduledJob component (component.ts),
// which renders the k8s CronJob with one-shot semantics (Forbid + Never). The
// pure declaration lives here; the Pulumi instantiation is the thin wrapper.

import * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";
import { controlCenterProductManifest, type DatabaseBackup } from "@www/platform";
import type { InfraNamespaceName } from "./cluster.ts";
import type { CronJobSpec, VolumeSpec } from "./component.ts";
import { ScheduledJob } from "./component.ts";

export type OwnedCronJobSpec = CronJobSpec & { namespaceName: InfraNamespaceName };

const TZ = "America/Los_Angeles";

/**
 * Wall-clock cap on one backup Job (#790, #793). A pod that can't mount its
 * target (the NAS offline) used to sit in ContainerCreating for 11 days, and
 * under concurrencyPolicy: Forbid that one wedged run blocked every later run.
 * With a deadline the Job fails after 30 minutes, kube-controller-manager
 * deletes its pod, and the next scheduled run gets a fresh attempt. A healthy
 * dump takes well under a minute.
 */
export const PG_BACKUP_ACTIVE_DEADLINE_SECONDS = 1800;

// The CNPG image Dockerfile explicitly sets USER 26 (postgres). fsGroup lets
// kubelet make a fresh local-lvm filesystem group-writable before starting it.
// Keep the same identity on NFS; its server-side directory ACL must allow GID 26
// (NFS root squash means kubelet cannot repair a NAS directory's permissions).
const PG_BACKUP_SECURITY_CONTEXT = {
  runAsUser: 26,
  runAsGroup: 26,
  runAsNonRoot: true,
  fsGroup: 26,
  fsGroupChangePolicy: "OnRootMismatch",
} as const;

/** Publish only a complete gzip stream containing a finished plain-format SQL dump. */
function verifiedDump(dump: string, minimumSqlBytes: number): string[] {
  return [
    'tmp="$out.partial"',
    `trap 'rm -f "$tmp"' EXIT`,
    `${dump} | gzip -c > "$tmp"`,
    'gzip -t "$tmp"',
    // Read the whole stream: head/grep -q would SIGPIPE gzip under pipefail.
    'bytes=$(gzip -dc "$tmp" | wc -c)',
    `[ "$bytes" -ge ${minimumSqlBytes} ] || { echo "SQL dump smaller than ${minimumSqlBytes} bytes" >&2; exit 1; }`,
    // awk consumes every line, avoiding SIGPIPE even for large dumps under pipefail.
    // pg_dump >= 17.6/18 appends `\unrestrict <key>` after the completion comment
    // (CVE-2025-8714), so only comment separators, blank lines and that one
    // meta-command may follow the trailer.
    `gzip -dc "$tmp" | awk '$0 == "-- PostgreSQL database dump complete" { done = 1; next } done && !($0 == "" || $0 == "--" || $0 ~ /^\\\\unrestrict [A-Za-z0-9]+$/) { done = 0 } END { exit(!done) }' || { echo "SQL dump missing final completion trailer" >&2; exit 1; }`,
    'mv -f "$tmp" "$out"',
    'echo "verified $out ($bytes SQL bytes)"',
  ];
}

/**
 * Local fallback target for pg-backups while the NAS is switched off
 * (wwwinfra:nasEnabled=false, #793). A local-lvm PVC on the node SSD, one per
 * backup namespace. It sits on the same disk as the database, so it guards
 * against logical damage (a bad migration, a dropped table), not disk loss.
 * Copy the dumps to the NAS once it is back.
 */
export const PG_BACKUP_FALLBACK_CLAIM = "pg-backup-fallback";
export const PG_BACKUP_FALLBACK_SIZE = "5Gi";
/** Fallback dumps older than this many days are pruned, so the PVC can't fill. */
const PG_BACKUP_FALLBACK_KEEP_DAYS = 3;

/** Where the NAS is and whether to mount it at all. */
export interface NasTarget {
  server: string;
  /** false while the NAS is down: back up to the local fallback PVC instead. */
  enabled: boolean;
}

function backupVolume(
  nas: NasTarget,
  mountPath: string,
  nasExportPath: string,
  nasSubPath: string,
): VolumeSpec {
  const nfsVolume: VolumeSpec = {
    mountPath,
    nfs: { server: nas.server, path: nasExportPath },
    subPath: nasSubPath,
  };
  // NAS off: detached keeps the NFS PV/PVC declared (a pod wedged on the dead
  // mount still pins that PVC, so deleting it would hang the deploy) and mounts
  // the local fallback claim instead.
  return nas.enabled
    ? nfsVolume
    : { ...nfsVolume, detached: true, claim: PG_BACKUP_FALLBACK_CLAIM };
}

/** Prune line appended to the dump script in fallback mode only. */
function fallbackPrune(nas: NasTarget, mountPath: string): string[] {
  if (nas.enabled) return [];
  return [
    `find ${mountPath} -maxdepth 1 -name '*.sql.gz' -mtime +${PG_BACKUP_FALLBACK_KEEP_DAYS - 1} -delete`,
  ];
}

/**
 * @public - the local-lvm fallback PVC a backup CronJob mounts while the NAS is
 * switched off. skipAwait: local-lvm is WaitForFirstConsumer, so the claim stays
 * Pending until the next scheduled run, and an awaited apply would hang on it.
 */
export function pgBackupFallbackClaim(
  namespace: pulumi.Input<string>,
  logicalName: string,
  opts: pulumi.CustomResourceOptions,
): k8s.core.v1.PersistentVolumeClaim {
  return new k8s.core.v1.PersistentVolumeClaim(
    logicalName,
    {
      metadata: {
        name: PG_BACKUP_FALLBACK_CLAIM,
        namespace,
        annotations: { "pulumi.com/skipAwait": "true" },
      },
      spec: {
        accessModes: ["ReadWriteOnce"],
        storageClassName: "local-lvm",
        resources: { requests: { storage: PG_BACKUP_FALLBACK_SIZE } },
      },
    },
    opts,
  );
}

function postgresBackupCommand(backup: DatabaseBackup, nas: NasTarget): string[] {
  return [
    // bash, NOT sh: the image's /bin/sh is dash, which lacks `set -o pipefail`
    // (the cloudnative-pg image is Debian-based and ships bash).
    "bash",
    "-c",
    [
      // pipefail is REQUIRED: pg_dump pipes into gzip, so without it a pg_dump
      // failure (e.g. a server-version mismatch) is masked by gzip's success and
      // the job writes a broken/empty artifact while reporting Complete. With
      // pipefail (+ errexit) the failed dump fails the job, so a bad backup is
      // never silently "successful".
      "set -eo pipefail",
      `export PGPASSWORD="$(cat ${backup.authMountPath}/password)"`,
      `out="${backup.backupMountPath}/${backup.filenamePrefix}$(date +${backup.dateFormat}).sql.gz"`,
      ...verifiedDump(
        `pg_dump -h ${backup.serviceHost} -U ${backup.owner} -d ${backup.databaseName}`,
        1024,
      ),
      ...fallbackPrune(nas, backup.backupMountPath),
    ].join("\n"),
  ];
}

/**
 * @public - adapts the platform product backup intent into the infra CronJob
 * vocabulary while keeping renderCronJob responsible for k8s object details.
 */
export function postgresBackupCronSpec(
  backup: DatabaseBackup,
  nasNfsServer: string,
  nasEnabled = true,
): OwnedCronJobSpec {
  const nas: NasTarget = { server: nasNfsServer, enabled: nasEnabled };
  return {
    name: backup.name,
    // This adapter stays generic over any product's backup — the real deploy
    // path feeds it only product backups with namespaces.
    namespaceName: backup.product,
    image: backup.image,
    schedule: backup.schedule,
    command: postgresBackupCommand(backup, nas),
    env: { TZ },
    activeDeadlineSeconds: PG_BACKUP_ACTIVE_DEADLINE_SECONDS,
    backoffLimit: 1,
    securityContext: PG_BACKUP_SECURITY_CONTEXT,
    extraSecretMounts: [{ secretName: backup.authSecretName, mountPath: backup.authMountPath }],
    volumes: [backupVolume(nas, backup.backupMountPath, backup.nasExportPath, backup.nasSubPath)],
  };
}

// The shared NAS backup root every product's backups live under (mirrors
// @www/platform's homelabTarget.nas , not imported directly because
// home-assistant is deliberately NOT a @www/platform ProductSlug (Task 4: its
// CNPG cluster is self-contained in homeassistant.ts, not the closed
// ProductDatabase/DatabaseBackup union). Kept as a literal string constant
// here so it can't silently drift from the platform value without a reviewer
// noticing the duplication.
const NAS_BACKUP_ROOT = "backups/world-wide-webb";

/**
 * @public - the `home_assistant` CNPG cluster's daily pg_dump, alongside
 * control-center's (Step 6b): keeps the backup pattern uniform across every
 * Postgres cluster in the stack even though this data is disposable (§0.1 ,
 * no recorder history is migrated from the mini). Talos-only: consumed by
 * homeassistant.ts.
 */
export function homeAssistantPgBackupCronSpec(args: {
  nasNfsServer: string;
  serviceHost: string;
  databaseName: string;
  owner: string;
  authSecretName: string;
  /** false while the NAS is down (#793): back up to the local fallback PVC. */
  nasEnabled?: boolean;
}): CronJobSpec {
  const { nasNfsServer, serviceHost, databaseName, owner, authSecretName } = args;
  const nas: NasTarget = { server: nasNfsServer, enabled: args.nasEnabled ?? true };
  const authMountPath = "/run/pgauth";
  const backupMountPath = "/backup";
  return {
    name: "home-assistant-pg-backup",
    // Same CNPG-provided pg_dump/pg_restore-compatible image as
    // control-center's backup, so both crons share one bash-based image (not
    // Debian's dash /bin/sh) for `set -o pipefail`.
    image: "ghcr.io/cloudnative-pg/postgresql:18",
    schedule: "0 1 * * *",
    command: [
      "bash",
      "-c",
      [
        "set -eo pipefail",
        `export PGPASSWORD="$(cat ${authMountPath}/password)"`,
        `out="${backupMountPath}/${databaseName}-$(date +%Y%m%d).sql.gz"`,
        // Empty DB until HA recorder cutover: its complete dump is about 720 bytes.
        ...verifiedDump(`pg_dump -h ${serviceHost} -U ${owner} -d ${databaseName}`, 512),
        ...fallbackPrune(nas, backupMountPath),
      ].join("\n"),
    ],
    env: { TZ },
    activeDeadlineSeconds: PG_BACKUP_ACTIVE_DEADLINE_SECONDS,
    backoffLimit: 1,
    securityContext: PG_BACKUP_SECURITY_CONTEXT,
    extraSecretMounts: [{ secretName: authSecretName, mountPath: authMountPath }],
    volumes: [
      backupVolume(
        nas,
        backupMountPath,
        "/volume1/Homelab",
        `${NAS_BACKUP_ROOT}/home-assistant/postgres`,
      ),
    ],
  };
}

const controlCenterManifest = controlCenterProductManifest();
const controlCenterBackup = controlCenterManifest.backup;

/**
 * @public - the declared CronJob set (pure data). nasNfsServer is threaded into
 * the pg-backup NFS PV the same way services.ts threads it into the worker
 * (www-j934.17); the NAS LAN IP by default. Consumed by deployCrons + the unit
 * tests; no other internal consumer.
 */
export function cronSpecs(nasNfsServer: string, nasEnabled = true): OwnedCronJobSpec[] {
  return [
    // Control Center stays on the compatibility backup path until that live path
    // migration gets explicit review. New product backups use the platform path.
    postgresBackupCronSpec(controlCenterBackup, nasNfsServer, nasEnabled),
  ];
}

export interface CronsArgs {
  provider: k8s.Provider;
  namespaces: Readonly<Record<InfraNamespaceName, pulumi.Input<string>>>;
  // NFS server for the NAS backup PV; the NAS LAN IP by default. kubelet mounts
  // the PV from the node netns (reaches the LAN on home-server, DESIGN §5b); the
  // pod-egress no-route limit (§5c) does not apply to PV mounts. www-j934.17.
  nasNfsServer: string;
  // wwwinfra:nasEnabled (#793). false: back up to the local fallback PVC
  // instead of mounting the NAS. Defaults to true.
  nasEnabled?: boolean;
}

export interface CronsResources {
  jobs: ScheduledJob[];
  fallbackClaims: k8s.core.v1.PersistentVolumeClaim[];
}

/**
 * @public - instantiates a ScheduledJob per declared cron. Consumed by the
 * cluster program (program.ts); no other internal consumer in this ticket.
 */
export function deployCrons(args: CronsArgs): CronsResources {
  const { provider, namespaces, nasNfsServer, nasEnabled = true } = args;
  const specs = cronSpecs(nasNfsServer, nasEnabled);
  const fallbackClaims = nasEnabled
    ? []
    : [...new Set(specs.map((s) => s.namespaceName))].map((ns) =>
        pgBackupFallbackClaim(namespaces[ns], `${ns}-${PG_BACKUP_FALLBACK_CLAIM}`, { provider }),
      );
  const jobs = specs.map(
    ({ namespaceName, ...spec }) =>
      new ScheduledJob(
        { ...spec, provider, namespace: namespaces[namespaceName] },
        { provider, dependsOn: fallbackClaims },
      ),
  );
  return { jobs, fallbackClaims };
}
