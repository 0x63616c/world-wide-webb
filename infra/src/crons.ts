// The scheduled jobs for the control-center k3s stack (www-j934.7): the cronJob()
// declarations for the cluster. Two are re-homed verbatim (portal-data-purge,
// map-extract) and one is NEW (pg-backup).
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
import {
  captivePortalProductManifest,
  controlCenterProductManifest,
  type DatabaseBackup,
} from "@repo/platform";
import type { CronJobSpec } from "./component.ts";
import { ScheduledJob } from "./component.ts";

// GHCR image ref (mutable :main tag; CI digest-pins at deploy). Mirrors services.ts.
const ghcr = (name: string) => `ghcr.io/0x63616c/control-center-${name}:main`;

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
      `out="${backup.backupMountPath}/${backup.filenamePrefix}$(date +${backup.commandFeatures.dateFormat}).sql.gz"`,
      `pg_dump -h ${backup.serviceHost} -U ${backup.owner} -d ${backup.databaseName} | gzip -c > "$out"`,
      'echo "wrote $out"',
    ].join("\n"),
  ];
}

/**
 * @public - adapts the platform product backup intent into the infra CronJob
 * vocabulary while keeping renderCronJob responsible for k8s object details.
 */
export function postgresBackupCronSpec(backup: DatabaseBackup, nasNfsServer: string): CronJobSpec {
  return {
    name: backup.name,
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

const controlCenterManifest = controlCenterProductManifest();
const controlCenterBackup = controlCenterManifest.backup;
const controlCenterPostgresHost = controlCenterManifest.database.rwServiceName;
const captivePortalBackup = captivePortalProductManifest().backup;

/**
 * @public - the declared CronJob set (pure data). nasNfsServer is threaded into
 * the pg-backup NFS PV the same way services.ts threads it into media-worker
 * (www-j934.17); the NAS LAN IP by default. Consumed by deployCrons + the unit
 * tests; no other internal consumer.
 */
export function cronSpecs(nasNfsServer: string): CronJobSpec[] {
  return [
    // Captive-portal data hygiene (www-q002.18): a daily one-shot running the api
    // IMAGE's bundled purge.js entrypoint (NOT a worker loop). Deletes consumed/
    // expired codes, stale attempts, and authorizations expired >90 days. Needs
    // only the Postgres password; POSTGRES_HOST points at the CNPG rw Service
    // because the api default "postgres" host doesn't resolve in k3s. 02:00 LA.
    {
      name: "portal-data-purge",
      image: ghcr("api"),
      schedule: "0 2 * * *",
      command: ["bun", "purge.js"],
      secrets: [{ name: "POSTGRES_PASSWORD", ref: "eso" }],
      env: { TZ, POSTGRES_HOST: controlCenterPostgresHost },
      // Carry the GHCR pull secret like the workloads do, rather than leaning
      // on package visibility staying public (www-hn1i).
      imagePullSecrets: ["ghcr-pull"],
    },

    // Tesla-map basemap refresher (www-gma → www-hn1i). Runs the in-repo
    // map-provision image in FORCE mode: resolve the newest Protomaps planet
    // build at runtime (their daily builds are deleted after ~7 days, so any
    // hardcoded date rots, the original suspended/manual recipe pinned one and
    // prod shipped with an empty maps PVC), extract the SoCal bbox, atomically
    // rename into the `maps` PVC the web service serves /maps/*.pmtiles from.
    // Monthly is plenty (street data drifts slowly); first-provision on a fresh
    // stack is the web pod's map-provision initContainer, NOT this cron. Ad-hoc
    // refresh: `kubectl create job --from=cronjob/map-extract <name>`.
    {
      name: "map-extract",
      image: ghcr("map-provision"),
      schedule: "23 5 3 * *",
      command: ["/provision.sh", "force"],
      env: { TZ },
      volumes: [{ mountPath: "/out", claim: "maps" }],
      // A NEW GHCR package is born private on first push; without the pull
      // secret the first scheduled run ImagePullBackOffs (www-hn1i).
      imagePullSecrets: ["ghcr-pull"],
    },

    // Control Center stays on the compatibility backup path until that live path
    // migration gets explicit review. New product backups use the platform path.
    postgresBackupCronSpec(controlCenterBackup, nasNfsServer),
    postgresBackupCronSpec(captivePortalBackup, nasNfsServer),
  ];
}

export interface CronsArgs {
  provider: k8s.Provider;
  namespace: pulumi.Input<string>;
  // NFS server for the NAS backup PV; the NAS LAN IP by default. kubelet mounts
  // the PV from the node netns (reaches the LAN on homelab, DESIGN §5b); the
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
  const { provider, namespace, nasNfsServer } = args;
  const jobs = cronSpecs(nasNfsServer).map(
    (spec) => new ScheduledJob({ ...spec, provider, namespace }, { provider }),
  );
  return { jobs };
}
