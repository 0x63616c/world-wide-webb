# Backup migration status

The existing mini backup remains authoritative and has not been changed or run
by this repository work. Its schedule, snapshots and NAS verification must stay
in place until the replacement completes an isolated restore test.

## Preserved NAS uploader

`scripts/nas-upload.py` is imported from `world-wide-webb` at
`3368a603cd162caac37e558f4fe88bcafe115b37`. GitHub main was rechecked at
`a53015e758e347cc1c664e258e89c99679a43204`; the backup, upload and test scripts
are unchanged between those revisions. The homelab adaptation adds separate
`homelab-macbook` and `homelab-mac-mini` destination namespaces while retaining
legacy `mac-mini` compatibility.

It pins the NAS certificate before sending credentials, uploads without allowing
overwrite, downloads each uploaded file to compare SHA-256 and byte count, and
refreshes an expired session once only for the explicit authentication rejection.
It does not replay ambiguous transport failures, delete remote files, purge old
NAS snapshots or send alerts. Credentials are read from a private JSON file.

Tests cover certificate rejection before authentication, bounded session refresh,
non-replayed upload errors, destination validation, read-back checksum/size
mismatches and omission of overwrite. No test contacts the real NAS.

## Disabled nightly job

The existing script stops the Control Center app while dumping PostgreSQL and
copying media, cold-copies HA configuration and Bambuddy data/studio/Tailscale
state, and invokes Hindsight's existing online PostgreSQL backup. It records
image identities, verifies restarted services, uploads every payload with
read-back verification, then uploads a completion manifest. Only verified local
sets are eligible for retention cleanup; incomplete sets remain for diagnosis.

The disabled `homelab.backups.enable` module runs as `_containers` at 04:15,
selects services assigned to the host and holds `homelab-operation` for the
whole snapshot/upload cycle. It retains seven verified local sets and preserves
failed sets. A 30 GiB free-space admission gate is configurable; this is not a
measured upper bound on snapshot size and does not guarantee against disk
exhaustion. Capacity measurement and an in-progress storage limit remain needed. The data and secret
archives are sensitive: local directories require owner-only permissions and
NAS destinations must remain on the existing encrypted share.

`scripts/snapshot.py` now implements host-service selection, image identity
capture, Control Center dump plus media snapshot, cold HA and Bambuddy copies,
and a verified Hindsight logical dump. Hindsight database credentials are read
inside its container from the same pg0 metadata used by the live backup script;
they are not passed to the host or placed in command arguments.

The draft takes a cold copy of Hindsight's ancillary Codex directory, adding a
brief Hindsight restart that the old online dump alone did not require. That
outage must be reviewed before enabling this schedule. Weekly portable bank exports are now ported: Sunday backups query bank IDs
through the existing embedded PostgreSQL metadata and use `hindsight-admin
export-bank` inside the container. Credentials remain there. Hashed filenames
and a private index preserve IDs without allowing them to become filesystem
paths. A failed export fails the backup set, and temporary container files are
removed even on failure. Eight verified weekly export archives are retained
separately from seven full snapshot sets, keeping the first verified export per
local ISO calendar week. Repeated Sunday deployments cannot displace older
weeks. This avoids eight weeks of full database copies. The live export job
still remains authoritative until target validation.

Before stopping a running service, a restart-required marker is written into
the snapshot set. Snapshot failures still attempt restart and health checks;
failed recovery or uncertain stop completion retains the marker. A client-side
stop timeout can leave a daemon-side request pending even after a successful
start and health probe, so it requires inspection. An already-stopped service is left untouched
and causes the snapshot to fail. The top-level driver detects old
restart markers before starting another backup and requires recovery inspection.
Five synthetic tests cover these failure paths and Hindsight command arguments.
The driver bundles Compose definitions, per-service runtime credentials and
image identities for recovery, uploads payloads with verification, then uploads
the completion manifest. Only a verified manifest permits local retention
cleanup. Six further tests cover completion ordering/failures and retention.

Immediately before publishing the completion manifest, the backup invokes the
shared Rust service health gate. Failed application, tunnel or Tailscale
readiness leaves the uploaded payloads incomplete and omits `NAS_VERIFIED`.
Per-container restart checks also reject missing mandatory Docker health.

Do not enable a backup daemon merely because the uploader tests pass. NAS credential provisioning, verified restore procedures, on-target Hindsight
export checks, host-wide updater recovery and on-target capacity checks remain
unfinished. The compiled scheduled job has not been activated or run. A Nix generation rollback cannot undo an application database
migration; application data recovery needs its own tested procedure.

## Read-only verification before restore

Download an entire set, including `COMPLETE.json`, into a private operator-owned
directory. Obtain it through the pinned NAS connection or another authenticated
channel; a hash manifest verifies integrity, not authenticity against someone
who can replace both the data and its manifest.

Run from the reviewed repository on a machine with Python 3:

```sh
python3 scripts/verify-backup.py /absolute/path/to/downloaded-set
```

The verifier reads files only. It requires the declared payload sizes and hashes,
rejects duplicate/unlisted payloads, reads host/service metadata without
extracting the recovery archive, and checks required files for every recorded
service. It rejects empty payloads, requires image records for the assigned
containers and checks that saved Compose/configuration and credential files are
present. It does not parse credentials or establish that they are valid.
Recovery-bundle traversal entries, links and duplicate paths are rejected. A local
`NAS_VERIFIED` marker is not required when checking a downloaded set and is never
trusted as a substitute for hashing. Backup creation now also runs this check
before uploading the completion manifest.

Passing this command does not prove that PostgreSQL can restore, SQLite is
healthy, credentials are still valid, or applications work. The next stage is
an isolated restore into fresh volumes/VMs with no production Tailscale identity,
LAN automations or tunnel enabled. Check database integrity and service behavior
there, then document the exact evidence before approving a production cutover.
Automated restore/extraction and that on-target rehearsal remain unfinished.
See the [service-by-service rehearsal](restore-rehearsal.md) for the actual
snapshot formats, isolation requirements and Hindsight initialization gap.
