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
are checked before upload. A power loss or killed backup process can leave a
lock behind: inspect processes and service state before removing a stale lock.

## Contents

- Control Center: consistent PostgreSQL dump, complete media directory, secrets,
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

Each file is streamed to a new NAS directory, downloaded again, and compared
by size and SHA-256. Existing files are not overwritten. `COMPLETE.json` is
uploaded last and lists all verified payloads. A directory without that marker
is incomplete. A local `NAS_VERIFIED` marker is written only after the remote
completion marker itself passes read-back verification. Keep seven completed
local sets; incomplete sets remain for investigation. NAS sets are not purged.
The job refuses to start below 5 GiB free disk. Review NAS capacity and retention
as backup volume grows.

## Install and operate

Copy backup.py and nas-upload.py to `/Users/calum/homelab-backups/`. Provision
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
calendar-triggered run is still pending. Subsequent runs also record the exact
container image IDs and repository digests in images.json. Failure-path tests cover restarting after a snapshot
exception, preserving previously stopped service state, and refusing to send
credentials to a server whose certificate does not match the pin.
