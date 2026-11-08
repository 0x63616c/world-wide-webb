# Control Center backup history

## Plan and retention

The hourly job captures the database and Photo Booth media without stopping the app.
Keep the latest snapshot in each of the last 24 available UTC hours and each of the
last seven available Pacific calendar days. On the NAS, also keep the latest snapshot
in every Pacific ISO week, indefinitely. One physical snapshot may satisfy several
retention roles; these counts are maxima rather than duplicated archives.

Measured November 7: database 371.9 MB, gzip 49.1 MB; media 175.5 MB. The recent hourly/daily
sets require at most about 7 GB; weekly history grows roughly 11.7 GB/year at today's sizes.
Actual gzip media size and overlapping roles reduce that estimate; new photos increase it.
NAS downtime keeps the recent local sets plus unuploaded weekly representatives, so
weekly recovery points are not silently discarded. A 5 GiB production reserve plus
estimated snapshot workspace stops new backups before they exhaust the disk.

The existing 04:15 full-service backup remains separate. It retains seven locally
verified sets plus two incomplete attempts regardless of NAS availability. Automated
pre-release SQLite copies keep the latest seven; pre-recovery copies keep three.
Incident, migration and manual archives are excluded from automatic expiration.
The existing full-service NAS archive remains append-only.

## Snapshot and verification

1. Acquire the hourly kernel-held lock. It releases after process death/reboot.
2. Obtain deployment ownership, without stealing another operation's lock. This job
   records its PID and boot session; only its own dead/previous-boot lock can be recovered.
3. Check Linux-local database storage and disk headroom. Remove only strict-matching
   abandoned `.hourly-YYYYMMDDTHHMMSSZ.sqlite` scratch artifacts from previous attempts.
4. Run `www-server database-snapshot` inside Linux. SQLite `VACUUM INTO` creates a
   consistent online copy including committed WAL data; no workers start in this CLI.
5. Copy the independent snapshot to private staging and remove the Linux scratch copy.
   Archive immutable media after the database snapshot, then release deployment ownership.
6. Compress and read back both payloads; check SQLite integrity/foreign keys, every indexed
   photo's presence and byte length, and gzip checksums. Write SHA-256 payload hashes and
   accepted image metadata into `COMPLETE.json`, then atomically accept the local directory.
7. Upload payloads and completion marker last. Download SHA-256 and byte counts for every
   uploaded file. Revalidate local manifests before upload; never overwrite differing remote
   bytes. Record `NAS_VERIFIED` only after all three files pass read-back verification.
8. Apply retention only inside `/Homelab/backups/mac-mini/control-center-history/`.
   An incomplete remote set is never a retention candidate. Weekly representatives never
   expire. A damaged older pending set does not block newer uploads; failures are recorded
   locally. A new verified upload permits normal expiration of obsolete hourly/daily
   copies while older failed sets remain visible; with no new verified upload, expiration
   is skipped. Weekly representatives are preserved in either case.

Photos are file-synced and their directory is synced before their DB index is committed.
Photo deletion is soft; files referenced by an earlier snapshot remain available. Files
captured after the database copy may be harmless extras in its media archive.

## Schedule and operation

Deployment installs `com.calum.control-center-hourly-backup` from `backup.py --install-hourly`.
It runs at each local hour (`StartCalendarInterval.Minute=0`) and once on initial load.
A new job waits up to 120 seconds for a deployment to finish; it does not stop the app.
The 04:15 full-service job retains its existing schedule. No new notifications are added.

- Local history: `~/homelab-backups/control-center-history/<UTC timestamp>/`.
- Logs: `~/homelab-backups/control-center-hourly.log` and `control-center-hourly-error.log`.
- Manual local capture: `/usr/bin/python3 ~/homelab-backups/backup.py --control-center-hourly --local-only`.
- Validate an accepted/downloaded set: `/usr/bin/python3 ~/homelab-backups/backup.py --verify-history <directory>`.

A full hour's existing snapshot is reused on a retry; pending NAS uploads still run.
NAS publication runs in a child process with a 15-minute wall-clock limit, so a stalled
NAS/backlog cannot block the next hourly local capture for hours. Local retention works during NAS failure. NAS file-service slowness is different from
an offline host: check ping, TCP and HTTP separately before concluding the NAS is down.

For restore, validate the complete manifest, decompress into a separate directory and
verify every photo first. Stop the single app writer, preserve its existing volume,
restore the accepted SQLite/media set into Linux-local storage, and check schema,
integrity, foreign keys, indexed photos, image compatibility and live health. Never
open live WAL files from macOS or automatically replace damaged data with an empty DB.

## Worker recovery

A one-second watchdog detects exited tasks and stale completed cycles (90 seconds for
normal workers, 660 seconds for five-minute weather ingestion). The bedroom WebSocket
records healthy pongs, so an idle physical switch is not treated as a dead worker.
Repeated storage failures also fail readiness. The server exits on a dead/stalled worker
or repeated worker storage failure so Docker's existing `unless-stopped` policy replaces
its single owner. Ordinary HA/weather errors finish cycles and remain visible as degraded
metrics without triggering dependency-outage restart loops. Shutdown waits five seconds
per worker before aborting a stuck task.

A corrupt/missing production database fails startup integrity/schema validation. There is
no automatic backup restore: silently rolling household state backward would lose writes.

## Remaining audit risks

The independent audit found no NAS filesystem mount on the mini. HA, Bambuddy, studio,
Penpot PostgreSQL/assets and Control Center SQLite use Linux-local volumes. Hindsight's
PostgreSQL still uses a macOS bind mount; no corruption was observed, but moving that
separate service's database requires coordinated backup/restore validation. Penpot's
independent local backup retention still depends on NAS success and should be bounded
separately. These services were not migrated or stopped as part of the Control Center fix.
