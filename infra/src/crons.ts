// The scheduled jobs for the control-center k3s stack (www-j934.7): the Pulumi-era
// successor to bosun's cronJob() declarations in deploy.config.ts. Two are
// re-homed verbatim (portal-data-purge, map-extract) and one is NEW (pg-backup).
//
// Deliberately ABSENT vs deploy.config.ts (DESIGN.md §2):
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
import { ScheduledJob } from "./component.ts";
import type { CronJobSpec } from "./spec.ts";

// GHCR image ref (mutable :main tag; CI digest-pins at deploy). Mirrors services.ts.
const ghcr = (name: string) => `ghcr.io/0x63616c/control-center-${name}:main`;

const TZ = "America/Los_Angeles";

// The CNPG read-write Service the jobs connect to (www-j934.5). The api default
// host "postgres" was the Swarm service name and does NOT resolve in k3s.
const POSTGRES_HOST = "control-center-rw";
// The DB the app + the backup operate on (apps/api/src/env.ts default).
const DB_NAME = "control_center";
// CNPG's superuser/owner is "postgres" (cnpg.ts DB_OWNER).
const DB_OWNER = "postgres";

// The CNPG-managed basic-auth Secret (cnpg.ts PG_AUTH_SECRET): keys `username` +
// `password`. pg-backup mounts it as files and reads the password from there,
// rather than minting a duplicate ExternalSecret for the same credential.
const PG_AUTH_SECRET = "cc-postgres-auth";
const PG_AUTH_MOUNT = "/run/pgauth";

// The DS420+ exports ONLY /volume1/Homelab (not its subdirs); the backup lands in
// a subdir of that export via the NFS PV's subPath, written by the job into
// /backup. nfsvers=3 mount options are enforced by the render layer (v3-only NAS).
const NAS_EXPORT = "/volume1/Homelab";
const BACKUP_SUBPATH = "backups/postgres";
const BACKUP_MOUNT = "/backup";

// The nightly pg_dump → dated, gzipped artifact on the NAS. A custom-format dump
// would not gzip meaningfully, so this is a plain SQL dump piped through gzip to
// a DATED filename (control_center-YYYYMMDD.sql.gz), the Phase-3 acceptance
// artifact. PGPASSWORD is sourced from the mounted CNPG secret (never an env
// literal, never logged); the dump runs against the CNPG rw Service.
const PG_BACKUP_COMMAND = [
  "sh",
  "-c",
  [
    `export PGPASSWORD="$(cat ${PG_AUTH_MOUNT}/password)"`,
    `out="${BACKUP_MOUNT}/${DB_NAME}-$(date +%Y%m%d).sql.gz"`,
    `pg_dump -h ${POSTGRES_HOST} -U ${DB_OWNER} -d ${DB_NAME} | gzip -c > "$out"`,
    'echo "wrote $out"',
  ].join(" && "),
];

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
      env: { TZ, POSTGRES_HOST },
    },

    // Tesla-map basemap provisioner (www-gma). Range-extracts the SoCal region from
    // the Protomaps daily planet build into the `maps` local-path PVC the web
    // service serves /maps/*.pmtiles from. Driven MANUALLY via
    // `kubectl create job --from=cronjob/map-extract`, so it ships SUSPENDED; the
    // rare schedule stays only as the declarative record of the recipe (bbox/
    // maxzoom/build date in one place). go-pmtiles is distroless with the pmtiles
    // binary as entrypoint, so command is the bare `extract` subcommand. Bump the
    // build date when re-provisioning (Protomaps retains ~7 days of builds).
    {
      name: "map-extract",
      image: "ghcr.io/protomaps/go-pmtiles:v1.30.3",
      schedule: "0 5 1 1 *",
      suspend: true,
      command: [
        "extract",
        "https://build.protomaps.com/20260604.pmtiles",
        "/out/socal.pmtiles",
        "--bbox=-121.0,32.4,-114.0,35.9",
        "--maxzoom=15",
      ],
      volumes: [{ mountPath: "/out", claim: "maps" }],
    },

    // NEW nightly logical backup to the NAS (RECON decision 5 / GOAL Phase 3).
    // Today there are NO Postgres backups (CNPG autobackup:false). This pg_dumps
    // the control_center DB and writes a DATED control_center-YYYYMMDD.sql.gz onto
    // an NFS PV pointed at the NAS backup path. The pg image major matches the
    // CNPG server (PG 17) so pg_dump version-checks pass. 01:00 LA, off-peak and
    // ahead of the 02:00 purge. The NFS PV carries the mandatory NFSv3 mount
    // options (render layer); the DS420+ is v3-only (DESIGN §5b).
    {
      name: "pg-backup",
      image: "ghcr.io/cloudnative-pg/postgresql:17",
      schedule: "0 1 * * *",
      command: PG_BACKUP_COMMAND,
      env: { TZ },
      extraSecretMounts: [{ secretName: PG_AUTH_SECRET, mountPath: PG_AUTH_MOUNT }],
      volumes: [
        {
          mountPath: BACKUP_MOUNT,
          nfs: { server: nasNfsServer, path: NAS_EXPORT },
          subPath: BACKUP_SUBPATH,
        },
      ],
    },
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
    (spec) => new ScheduledJob({ spec, provider, namespace }, { provider }),
  );
  return { jobs };
}
