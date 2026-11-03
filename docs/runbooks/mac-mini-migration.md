# Mac mini migration

Status: preparation in progress, 2026-11-03. Talos remains production.

## Requirements

- Keep Hindsight and Bambuddy and preserve their data.
- Move the existing Home Assistant configuration, integrations, dashboards,
  automations and recorder history. A planned HA outage is permitted.
- Deploy successful main releases automatically to the mini using hosted CI.
- Retire Talos only after service checks, a release, rollback, backup restore,
  and mini reboot verification pass.
- Remove old runners after migrating their workflows. The user also approved
  removal of the unused OrbStack Kubernetes cluster and old host processes;
  identify dependencies before stopping them.

## Verified preparation

The mini is an M2 with 8 GiB RAM and approximately 29 GiB available disk.
Hindsight and Bambuddy are running in OrbStack. Five runner launch agents are
active; OrbStack Kubernetes has only CoreDNS and local-path provisioner pods.

Hindsight's existing backup script produced `hindsight-20261103-054926.dump`.
It was copied off the mini to the operator machine's restricted migration
backup directory. Both copies have SHA-256
`177470d2189cb1b2be4a3ee988afa43870cd63c9cf38281ea0872a56e307305a`.

A full `pg_restore --exit-on-error --no-owner --no-acl` succeeded into a
separate PostgreSQL 18 + pgvector container, with networking disabled and
only the dump mounted read-only. The restored database contains 31 banks,
4,558 memory units, 986 documents and 4,541 entities. This verifies database
restore, not a full Hindsight application recovery or external-file backup.
The test containers are stopped; live Hindsight and Bambuddy remained running.

Talos access was recovered using the existing Keychain credential and the
repository's secret wrapper to render gitignored client configuration.
A live census confirmed the api Deployment at one replica, worker/web/manage
at zero, Home Assistant running with two containers, two PostgreSQL instances,
two cloudflared replicas and the observability stack. HA configuration is on
the `home-assistant/ha-config` PVC; both databases have local-lvm PVCs.

## Next gates

1. Back up HA configuration and both databases; preserve configuration secrets
   as opaque files without displaying their values. Rehearse restoration.
2. Add production Compose and an ARM64 release/deploy path; preserve existing
   app-cycle ownership until cutover. Keep Hindsight/Bambuddy separate.
3. Verify HA discovery and device callbacks on the mini, using a controlled
   outage to avoid duplicate automation instances.
4. Freeze writers for the final copy, move tunnel routing, verify all clients,
   then prove deployment, rollback and restart recovery.
5. Retire Talos only after the above evidence is recorded.

## Live Home Assistant storage correction

The deployment definitions provision PostgreSQL, but the running HA config
has no recorder override. Its actual recorder is `/config/home-assistant_v2.db`
with WAL files. Both databases on the HA PostgreSQL server are empty defaults.
Do not migrate this empty PostgreSQL instance as if it contained HA history.

A rehearsal archive of the complete `/config` directory is saved on the
operator machine with restrictive permissions. Because HA was running, use
the separate SQLite online-backup snapshot for a consistent recorder restore,
not the raw database/WAL files in that archive. The snapshot passed SQLite
integrity checking and contains 265,230 states and 147,108 events. At cutover,
stop HA before taking the final full configuration copy.

The Control Center PostgreSQL database is approximately 457 MB; a custom-format
rehearsal dump and a media archive are saved off the gaming PC. Restore testing
for Control Center is still pending.

## Compose preparation

`deploy/mini/compose.yaml` isolates Control Center under its own Compose project,
with persistent PostgreSQL 18 and media directories, file-mounted secrets,
health checks, bounded logs and graceful shutdown. It requires an explicit
worker-cycle setting to keep rehearsal instances from duplicating enforcers.
The file passed `docker compose config --quiet` on the mini. No services have
been started from it; release automation and runtime verification remain pending.
