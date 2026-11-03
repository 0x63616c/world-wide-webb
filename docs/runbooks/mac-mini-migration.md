# Mac mini migration

Status: preparation in progress, 2026-11-03. Talos remains production.

The first real mini release succeeded in workflow run `41652354784`, deploying
commit `11bae6356377b7f937cd9a59be93bdb52129f9bd` at digest
`sha256:d87d36f2bbd4b93269fcb494a69ecc96c0275fe7ae8dc3094a8a930d95739940`.
The live mini reported that exact SHA, database ok and cycles disabled.
Hindsight and Bambuddy did not restart during the release. PR #883 subsequently
merged as `cc5eae86924e830cc4d328920fe8a8fc5844c59b`; no origin overrides were
enabled. Its main CI run `41653290807` and mini release `41654412541` both
succeeded. The mini accepted digest
`sha256:3a96b627e6358cc932e2b4e25708a5737f035c046cffeab375fe659a363bdb48`.

Live compatible rollback and return were verified against the rehearsal DB:
`recover.sh previous` restored `11bae635...`, then `recover.sh recovery-from`
returned to `cc5eae86...`. Both passed database health, build SHA and disabled
cycle checks. CI generation remained `4966`; two pre-recovery database dumps
were created. PostgreSQL, Hindsight and Bambuddy were not restarted. No app
code, schema or migration files changed between these commits; this does not
prove recovery from an incompatible schema migration.

The approved obsolete `com.evee.signal-cli` launch agent is disabled and stopped;
its plist and data are retained. Port 8080 no longer has a listener. The current
app and infra source contain no Signal references. Local GitHub runners remain:
Voxelite still depends on self-hosted rendering and release jobs.

PR #882 merged as `11bae6356377b7f937cd9a59be93bdb52129f9bd` after all
required checks passed. `MINI_DEPLOY_ENABLED=true` now permits main-triggered
rehearsal releases. The mini still uses the restored rehearsal database with
`WORKER_CYCLES=off`; production ownership has not moved. Its GHCR login and
vault-backed deployment SSH access have been verified. The first main CI run
is `41651565297`; release success remains to be verified.

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

The unused OrbStack cluster was stopped with `orb stop k8s`; `k8s.enable`
now reads false. This unexpectedly restarted the Docker engine's containers.
After restart, Hindsight API and UI returned HTTP 200, Bambuddy and studio
were healthy, and Control Center reported database ok and cycles disabled.
Cluster data was preserved. This is not a substitute for the planned macOS
reboot check.

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

Hindsight's separate `codex-home` bind mount is also archived on the mini and
copied to the restricted off-host backup directory. Both copies have SHA-256
`6c3c9e5470e5908e393c68ec13536e6b7eaea6c1d2f108310452a869553051a6`.
No production data or volumes have been removed.

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
rehearsal dump and a media archive are saved off the gaming PC. The dump restored
successfully into the mini's isolated PostgreSQL 18 instance (15 public tables).

## Compose preparation

`deploy/mini/compose.yaml` isolates Control Center under its own Compose project,
with persistent PostgreSQL 18 and media directories, file-mounted secrets,
health checks, bounded logs and graceful shutdown. It requires an explicit
worker-cycle setting to keep rehearsal instances from duplicating enforcers.
The file passed `docker compose config --quiet` on the mini. PostgreSQL and the
native ARM64 rehearsal app are now healthy. `/healthz` reports database `ok`
and cycles disabled; `health.buildHash` reports `eb438685`. Both panel and
manage host routes return HTTP 200. Production traffic remains on Talos.
This proves basic runtime readiness, not complete integration correctness.

## Home Assistant cutover preparation

The running HA release is 2026.7.4. Its exact multi-architecture image index
also contains ARM64, and is pinned in `deploy/mini/home-assistant.compose.yaml`.
Keep this version for migration; upgrades are a separate operation.
The proposed container has its own project and restored configuration directory.
Use it on a Linux VM with verified LAN networking, not directly in OrbStack
without resolving the discovery failure below. Never run both copies with live
integrations enabled.

OrbStack host networking exposes container ports on macOS localhost, but LAN
multicast discovery and device callbacks require separate verification. See
[OrbStack host networking](https://docs.orbstack.dev/docker/host-networking) and
[HA Sonos networking](https://www.home-assistant.io/integrations/sonos/#network-requirements).
Check existing integration availability before and after cutover, and verify
device-to-HA callbacks as well as HA-to-device requests. If LAN networking cannot
be made reliable, use a bridged HA VM on the mini before retiring Talos.

For the final copy, stop the old HA process cleanly and mount its retained PVC
in a temporary backup pod, then archive the entire configuration while no HA
writer is active. Keep the PVC and off-host backup. Restore on the mini with
the same image version, validate SQLite integrity, then start only the mini
instance. Verify existing login, dashboards, integrations, automations and
history before moving callers. If verification fails, stop the mini instance
before restarting the old one. A planned HA outage is explicitly permitted.

An identical SSDP discovery probe found eight responding devices from native
macOS and zero from an OrbStack host-network container. Direct OrbStack HA is
therefore not ready for cutover. The mini already has Colima, Lima, QEMU and
socket_vmnet installed, with no existing instances. Investigate a dedicated
bridged VM using its active LAN interface (`en1`) and prove discovery before
moving HA. Keep its memory/disk allocation within the mini's limited capacity.

A Colima `ha` profile has now been created with two CPUs, 2 GiB RAM, 8 GiB
root disk and 12 GiB data disk; it is stopped. Docker's default context remains
OrbStack. The bridge setup failed because sudo was unavailable. The existing
root-owned `homebrew.mxcl.socket_vmnet` launch daemon is configured for `en1`
but is not running. Its old log reports VMNET_FAILURE. The stored sudo password
was rejected; the user has been asked to restart that existing helper from
their terminal. Do not treat the current VM as LAN-ready.

The configuration archive and consistent SQLite snapshot have been restored
under `/Users/calum/home-assistant/rehearsal-config`. An isolated, network-disabled
ARM64 container verified database integrity and the same state/event counts.
The restored configuration and entity registry are present. HA was subsequently
started with networking disabled, and accepted the existing API credential at
`/api/config`, reporting version 2026.7.4. It was stopped after this check;
integration startup cannot be verified in that isolated mode.
The current Talos API baseline is 214 entities; all lights,
switches, climate entities, covers, locks and media players are available.
There are already 12 unavailable sensors and four unavailable event entities;
compare individual entities at cutover rather than treating these as new failures.

## Bambuddy backup

Bambuddy remains running on the mini. Its data volume has an off-host archive,
plus a separate SQLite online-backup snapshot to use instead of the archive's
live database/WAL files. The snapshot passes integrity checks both on the mini
and off-host and contains 91 user tables. SHA-256 matches on both hosts:

- `bambuddy-consistent.sqlite`: `94868a1dd08dd90ca9a25ff9969d0f219224511b024a0e9654a71c49bf1b60bd`
- `bambuddy-data.tar.gz`: `4dbee6daa2969e09e19bacc60ef8df54f3f98ab0e5c79dbd64d533519027015a`

This covers Bambuddy's primary data, not yet a complete restore rehearsal of
its companion studio service and Tailscale state.

## Release automation

The Cloudflare stack accepts `originOverrides`, a map from existing public
hostnames to HTTP(S) origins. Empty configuration preserves Talos routing.
Each override changes every matching route, including narrow API paths, while
preserving rule order and origin options. Unknown hosts, embedded credentials
and URL paths/query strings are rejected. This changes neither DNS nor Access.
At cutover, record the old origins, prepare the replacement connector while
stopped, stop the Talos connectors, apply verified mini origins, then start
the mini connector. Never run both connector sets against origins only one
set can reach. Restore the old origins and connector set if verification fails.

The `Deploy Mac mini` workflow follows successful push-triggered main CI runs.
It builds an ARM64 `www-control-center-mini` image from the tested SHA, then
uses existing vault-backed Tailscale and homelab SSH credentials. It requires
`MINI_DEPLOY_ENABLED=true` and `MINI_KNOWN_HOSTS` repository variables. Keep
the enable switch unset until provisioning and restoration are verified.

The host installation is `/Users/calum/www-control-center`, containing
`compose.yaml`, `release.sh`, and a private `runtime.env` with POSTGRES_IMAGE,
WWW_DATA_DIR, WWW_SECRETS_DIR, HA_URL and WORKER_CYCLES. Runtime paths must be
absolute; image values must be pinned before production. The app image is
supplied separately for each immutable release. Initial database provisioning
and restoration precede release execution. Rehearsal uses WORKER_CYCLES=off
and a separate restored database; it must not share the production database.

The command pulls before stopping the app, waits for readiness and checks the
expected build SHA and cycle ownership. It records accepted and previous image
files, serializes deployments and rejects older CI run numbers. Failure leaves
the accepted pointer unchanged and fails CI; it does not silently roll back
potentially incompatible database migrations. Explicit rollback must use a
known-compatible image (or a restored database), then pass the same checks.
Compose and the host script are installed deliberately during provisioning;
changes to either require synchronization before enabling a release that needs
them. Automated configuration upgrades remain future work.

For an explicit compatible application rollback, run
`bash recover.sh previous <expected-commit-sha> --database-compatible` in the
host installation. Confirm compatibility from the code and migration diff first;
this command does not reverse database migrations. It shares the release lock,
pulls and checks the expected image before stopping the app, dumps the database
with app writers stopped, replaces only `www`, verifies health/SHA/cycle ownership,
then updates the accepted image pointer. `recovery-from.env` records the image
being replaced; use target `recovery-from` and its expected SHA to return to it.
The highest accepted CI generation stays unchanged to reject stale jobs. A
failure after stopping the app requires operator recovery; it does not silently
restart an image whose database compatibility is unknown.

`bash scripts/test-mini-release.sh` covers mutable-image rejection, a missing
database, stale releases, health failure and lock contention. `actionlint`
validates the workflow. These checks do not establish live deployment success.

The existing vault-backed SSH identity was verified against the mini's tailnet
hostname. `MINI_KNOWN_HOSTS` is provisioned using the public host key obtained
through the existing trusted SSH connection. `MINI_DEPLOY_ENABLED` remains
enabled for the isolated rehearsal after PR #882 merged. At cutover set
`TALOS_DEPLOY_DISABLED=true` and wait for any already-running
Talos deployment to finish before freezing writers. That switch prevents future
CI runs from recreating old workloads; it does not stop an in-flight deployment.
