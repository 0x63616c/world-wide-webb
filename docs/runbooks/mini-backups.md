# Mac mini backups

`deploy/mini/backup.py` snapshots Control Center, Home Assistant, Bambuddy and
Hindsight, then uploads to `/Homelab/backups/mac-mini/<UTC timestamp>` through
Synology File Station. NFS is not required. The supplied LaunchAgent schedules
04:15 local time. There are no new notifications or health alerts.

Control Center, HA and Bambuddy are stopped individually during their snapshots
and restarted in `finally` handlers even if copying fails. Hindsight uses its
existing online PostgreSQL backup script without stopping its application.
The app backup holds the same lock as deployments and rollback. An occupied
lock makes the backup fail without interrupting the release. Stopped services
are checked before upload. `LOCAL_VERIFIED` records that local snapshots completed and
services recovered, independently of NAS availability. `--local-only` performs that
work without contacting the NAS. A failed NAS upload retains the local set and
returns failure without stopping or changing the recovered app. A power loss or killed backup process can leave a
lock behind: inspect processes and service state before removing a stale lock.

## SQLite storage boundary

The live database and its WAL/SHM files live only in the external Docker volume
`www-control-center-sqlite` on the mini's Linux VM disk. It must use the local driver
with no driver options; a bind, NFS or SMB volume is rejected. Media remains on the
mini's SSD. Neither live SQLite nor media depends on the NAS.

Do not open a live SQLite file from macOS through OrbStack's Finder/NFS volume view.
SQLite shared memory and locks must stay on one OS. Preflight runs `www-server
database-check` inside Linux. After stopping the writer under `deploy.lock`,
`sqlite_snapshot.py --container` copies the complete database directory with `docker cp` into a
private temporary directory. Only that stopped copy is opened by macOS SQLite to
produce an integrity/foreign-key-checked backup. The running-writer guard rejects
accidental live copies. Production refuses to create an empty missing database.

To restore, stop the writer and preserve its entire volume first. Validate the
backup separately, copy the accepted database into the existing volume using a
Linux container, restore UID/GID 501:20 and owner-only permissions, and verify
integrity, foreign keys, media references and health before returning to service.
Never seed an empty volume automatically or open the live volume from macOS.

Hourly database-and-photo history has separate 24-hour/7-day/indefinite-weekly retention; see
[Control Center history](control-center-history.md).

## Contents

- Control Center: consistent SQLite backup (PostgreSQL only for explicit legacy archive mode), complete media directory, secrets,
  runtime configuration, accepted image and release/recovery scripts.
- HA: complete cold `/config` archive (SQLite database, WAL, integrations,
  credentials, dashboards and automations), Compose and host startup files.
- Bambuddy: cold data archive, studio data, Tailscale identity, Compose and scripts.
- Hindsight: online PostgreSQL dump, separate codex-home files, startup scripts,
  runtime environment and credential files. The existing script's local dump
  retention is unchanged.
- Cloudflare connector credentials and Compose, plus HA/Hindsight launch agents,
  Colima configuration and socket_vmnet helper definition.

These archives contain secrets. Local directories use mode 700 and files use
the process's restrictive umask. The destination is the existing encrypted
Homelab NAS share. Do not commit archives or the private NAS credential JSON.

## Transfer and retention

`nas-upload.py` pins the NAS server certificate before sending credentials.
Configuration has `host`, optional `port` (default 5001), `certificate_sha256`,
`username` and `password`; provision it privately from the existing vault into
`/Users/calum/homelab-backups/nas-credentials.json`, mode 600. A changed server
certificate causes failure until its replacement is deliberately verified and
the pin updated. The uploader never prints credentials or session IDs.

An upload rejected with DSM session error 119 refreshes authentication and
retries once. Other API errors and ambiguous network failures are not retried;
existing destination files are still never overwritten. Tests cover successful
session refresh, repeated rejection, and refusal to replay other errors.

Each file is streamed to a new NAS directory, downloaded again, and compared
by size and SHA-256. Existing files are not overwritten. `COMPLETE.json` is
uploaded last and lists all verified payloads. A directory without that marker
is incomplete. A local `NAS_VERIFIED` marker is written only after the remote
completion marker itself passes read-back verification. Keep seven locally verified
sets and the two latest incomplete attempts, even during NAS failure. NAS sets are not purged.
The job refuses to start below 5 GiB free disk. Review NAS capacity and retention
as backup volume grows.

## Install and operate

Copy backup.py, nas-upload.py, sqlite_snapshot.py to `/Users/calum/homelab-backups/`. Provision
the private credential file and run `/usr/bin/python3
/Users/calum/homelab-backups/backup.py` once before loading the LaunchAgent.
Copy `com.calum.homelab-backup.plist` to `~/Library/LaunchAgents/` and load it
with `launchctl bootstrap gui/$(id -u) <plist path>`. launchd records exit status;
stdout/stderr go to backup.log and backup-error.log in that directory. No
notification channel is configured.

Before restoring, read COMPLETE.json, download the required files, and verify
their SHA-256 values. Restore into separate databases/volumes first; never
overwrite live Hindsight data to test a backup. HA and Bambuddy cold archives
must be extracted with ownership preserved. Hindsight requires both the database
and codex-home archive plus its runtime configuration. Use the retained pinned
service images and verify application access before switching to restored data.

## Verification

The migration's production database, HA archive, Hindsight dump and Bambuddy
data/SQLite/studio/Tailscale backups were uploaded to
`/Homelab/backups/mac-mini/migration-20261103-0840` and each passed full read-back
SHA-256 verification. The complete manual run `20261103T164110Z` uploaded 13 archives and its
completion manifest with successful read-back verification. All snapshotted
services recovered. The 04:15 LaunchAgent is installed and loaded; its first
calendar-triggered run passed on November 4 (evidence below). Subsequent runs also record the exact
container image IDs and repository digests in images.json. Failure-path tests cover restarting after a snapshot
exception, preserving previously stopped service state, and refusing to send
credentials to a server whose certificate does not match the pin.

After the full Mac reboot, launchd run `20261103T171024Z` exited zero. All 14
payloads and COMPLETE.json passed NAS read-back verification; the completion
manifest SHA-256 is
`f4f57824279c4f6d385e7fe279482320e9abcd33dcc0a45719349f30d6a52854`.
This was a manual launchctl kickstart of the installed job, not its first
04:15 calendar trigger. An earlier run received session error 119 and retained
its local snapshots; the bounded session-refresh fix was installed before
the successful run. All snapshotted services recovered.

The first unattended 04:15 PST run on November 4 produced
`20261104T121502Z`, completing at 04:17:24. At the scheduled follow-up,
launchd reported three runs (up from two manual runs), last exit zero and no
running backup process. No kickstart or manual backup was performed for this
verification. All 14 payloads (270,272,630 bytes) and `COMPLETE.json` passed
NAS read-back SHA-256 verification; the manifest and all 14 verification
receipts agree. The completion manifest SHA-256 is
`93f89f1b92dd5b44110535cfb4d4bce5d19a4755fb4acf85b1a6d780e01ae982`.
The local `NAS_VERIFIED` marker was written at 04:17. The installed backup and
uploader scripts match the committed sources; the marker is written only after
every payload and the remote completion manifest pass read-back verification.
The app/database and snapshotted containers recovered; HA returned HTTP 200,
and all nine app cycles reported zero consecutive failures. The old error 119
in the append-only error log belongs to the earlier failed manual run, not this
successful calendar run.
