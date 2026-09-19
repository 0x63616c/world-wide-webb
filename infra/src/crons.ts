// The scheduled jobs for the control-center k3s stack (www-j934.7): the cronJob()
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

import type * as k8s from "@pulumi/kubernetes";
import type * as pulumi from "@pulumi/pulumi";
import { controlCenterProductManifest, type DatabaseBackup } from "@www/platform";
import type { InfraNamespaceName } from "./cluster.ts";
import type { CronJobSpec } from "./component.ts";
import { ScheduledJob } from "./component.ts";

export type OwnedCronJobSpec = CronJobSpec & { namespaceName: InfraNamespaceName };

const TZ = "America/Los_Angeles";

function postgresBackupCommand(backup: DatabaseBackup): string[] {
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
      `pg_dump -h ${backup.serviceHost} -U ${backup.owner} -d ${backup.databaseName} | gzip -c > "$out"`,
      'echo "wrote $out"',
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
): OwnedCronJobSpec {
  return {
    name: backup.name,
    // This adapter stays generic over any product's backup — the real deploy
    // path feeds it only product backups with namespaces.
    namespaceName: backup.product,
    image: backup.image,
    schedule: backup.schedule,
    command: postgresBackupCommand(backup),
    env: { TZ },
    extraSecretMounts: [{ secretName: backup.authSecretName, mountPath: backup.authMountPath }],
    volumes: [
      {
        mountPath: backup.backupMountPath,
        nfs: { server: nasNfsServer, path: backup.nasExportPath },
        subPath: backup.nasSubPath,
      },
    ],
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
}): CronJobSpec {
  const { nasNfsServer, serviceHost, databaseName, owner, authSecretName } = args;
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
        `pg_dump -h ${serviceHost} -U ${owner} -d ${databaseName} | gzip -c > "$out"`,
        'echo "wrote $out"',
      ].join("\n"),
    ],
    env: { TZ },
    extraSecretMounts: [{ secretName: authSecretName, mountPath: authMountPath }],
    volumes: [
      {
        mountPath: backupMountPath,
        nfs: { server: nasNfsServer, path: "/volume1/Homelab" },
        subPath: `${NAS_BACKUP_ROOT}/home-assistant/postgres`,
      },
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
export function cronSpecs(nasNfsServer: string): OwnedCronJobSpec[] {
  return [
    // Control Center stays on the compatibility backup path until that live path
    // migration gets explicit review. New product backups use the platform path.
    postgresBackupCronSpec(controlCenterBackup, nasNfsServer),
  ];
}

export interface CronsArgs {
  provider: k8s.Provider;
  namespaces: Readonly<Record<InfraNamespaceName, pulumi.Input<string>>>;
  // NFS server for the NAS backup PV; the NAS LAN IP by default. kubelet mounts
  // the PV from the node netns (reaches the LAN on home-server, DESIGN §5b); the
  // pod-egress no-route limit (§5c) does not apply to PV mounts. www-j934.17.
  nasNfsServer: string;
}

export interface CronsResources {
  jobs: ScheduledJob[];
}

/**
 * @public - instantiates a ScheduledJob per declared cron. Consumed by the
 * cluster program (program.ts); no other internal consumer in this ticket.
 */
export function deployCrons(args: CronsArgs): CronsResources {
  const { provider, namespaces, nasNfsServer } = args;
  const jobs = cronSpecs(nasNfsServer).map(
    ({ namespaceName, ...spec }) =>
      new ScheduledJob({ ...spec, provider, namespace: namespaces[namespaceName] }, { provider }),
  );
  return { jobs };
}
