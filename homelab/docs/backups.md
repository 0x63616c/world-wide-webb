# Backups and recovery

Homelab owns shared backup scheduling, operation locks, service snapshots and NAS
publication. Control Center owns its SQLite/media format. Application image
publication must not reinstall or replace the shared backup jobs.

## Installed authority and evidence

On November 9, read-only inspection of the mini's installed launchd definitions
confirmed these `_containers` jobs:

- `org.nixos.homelab-backup`: full assigned-service snapshot at 04:15.
- `org.nixos.homelab-control-center-hourly-backup`: Control Center at minute 0.
- `org.nixos.homelab-penpot-backup`: Penpot at 05:15.

These are local host times. The mini configuration enables `homelab.backups`;
the old description of this module as disabled is obsolete. Installed job
definitions prove scheduling, not a recent successful backup or restore. This
inspection could not read the private service backup directory without another
privileged authorization. Do not infer new NAS evidence from historical logs.

`homelab-backup-now` runs as `_containers` beneath `homelab-operation`. The
installed lock serializes snapshots with stateful host operations. The default
private root is `/var/lib/_containers/backups`; hourly and Penpot sets have their
own subdirectories. A 30 GiB admission floor is configurable, not a measured
maximum snapshot size. Existing recovery markers block subsequent snapshots
until interrupted stop/snapshot operations have been inspected.

## Snapshot and publication behavior

The current scripts save native Control Center SQLite and media, not a new
PostgreSQL dump. Full snapshots stop the app while copying consistent state.
Hourly snapshots use its online SQLite backup interface, including committed
WAL data, with separate media capture. Keep the original legacy database
archives; their historical format does not change the current snapshot format.

Other assigned services have their own snapshots: cold Home Assistant and
Bambuddy data/identity copies; a verified logical Hindsight dump plus a brief
stop for its Codex directory; Penpot PostgreSQL/assets/Valkey; and Beszel's
database and private identity. Golink's stopped-writer archive preserves its
SQLite links and tsnet identity together. Sunday Hindsight exports provide an additional
portable recovery path. Preserve actual image digests and service assignments.

The recovery archive includes Compose/configuration, image identities and
plaintext runtime credentials. Local sets require owner-only permissions and
must stay on the existing private NAS share. Never put payloads, archive
contents, credentials or database rows in Git or CI artifacts.

The NAS uploader pins the certificate before authentication, omits overwrite,
and downloads each uploaded payload to compare its SHA-256 and byte count. It
refreshes authentication once only for the explicit expired-session response;
ambiguous transport failures are not replayed automatically. Before local acceptance, the driver validates set completeness and service recovery.
After all uploaded payloads verify, the publisher sends `COMPLETE.json` and marks the
local set `NAS_VERIFIED`. Incomplete sets remain
for diagnosis. The code retains seven verified full sets, scoped hourly history
and eight first-of-week portable export archives; it never treats an incomplete
set as eligible for normal pruning.

## Local acceptance and asynchronous publication

Scheduled jobs and explicit `--local-only` commands capture locally. The
no-argument command retains synchronous NAS completion for older generation
executors and drains pending accepted sets before they can retire the publisher. `COMPLETE.json` lists
payload checksums; `LOCAL_VERIFIED.json` is written only after local set validation,
service recovery and fsync. Neither means NAS success. The separate
`org.nixos.homelab-backup-publisher` retries every minute, with one publisher lock
and a 15-minute process-group budget. It uploads/read-backs at most two payloads
concurrently and publishes remote completion last. Only then is `NAS_VERIFIED`
written. Ambiguous previous uploads are reconciled by checking existing remote
bytes; differing bytes are never overwritten.

Publication reads immutable accepted sets, not current release paths or live health.
An unavailable NAS retains pending sets across reboot/generation changes and does
not block ordinary application activation after local acceptance. Shared storage/VM
changes still wait for their own transaction's off-host point. Independent sets can
publish even if an older set fails. `publication-status.json` records pending count,
oldest capture and last scan failures; inspect it alongside launchd exit status.

Transaction-scoped sets live under `backups/deployment/` and the matching NAS
`/Homelab/backups/<host>/deployment/` namespace. They do not displace the seven full
sets or hourly/Penpot history. Keep seven verified local deployment sets plus all
pending and `PINNED` sets. Remote deployment sets expire by seven-day capture age,
with active recovery pins protected. Successful activation releases its pins;
interrupted transaction recovery must explicitly inspect them before release.
Full NAS sets remain append-only. Old completed archive formats remain readable.

Use `homelab-backup-now --scope deployment --services control-center --local-only`
for an explicit scoped local capture. Mutation commands run as `_containers` under
`homelab-operation`; the publisher alone uses its separate lock during transfer.
These sets declare their exact service coverage and cannot stand in for full-host
recovery. The verifier can require full-host scope with `--require-full`.

## Cloudflare state is a separate recovery requirement

The home OpenTofu state owner is `admin`, under
`/Users/admin/homelab-infra/cloudflare`, outside application storage. The service
backup code above does **not** include that directory. Do not give `_containers`
access to its passphrase or API token to bridge this gap. Local `state-backups`
made before applies are not an off-host backup.

The November 9 candidate passed a read-only plan against the existing encrypted
state: all 15 managed resources were no-ops. An independent encrypted file copy
also initialized as an isolated backend, rejected a deliberately wrong
passphrase and produced a no-change plan using the correct owner credentials.
The production state hash stayed unchanged. This first check established that
the copied state was usable; it did not test NAS or off-host key recovery.

A subsequent owner-authorized check uploaded an encrypted state/configuration
archive to a unique private NAS destination, downloaded the actual archive,
and verified all eight members against their saved hashes. The downloaded
state then initialized as another isolated backend, rejected the wrong
passphrase and produced a no-change plan. Production state remained unchanged.
This proves that one NAS copy restores with current owner credentials. It does
not establish automatic backup coverage or separately recovered credentials.

Before enabling the relocated automatic writer or retiring old recovery paths,
establish automatic owner-scoped encrypted state/configuration NAS backups and
repeat isolated restoration with separately recovered credentials.
Keep resource addresses, remote IDs and retained routes unchanged. Never upload
plaintext state, plans, decrypted provider output or passphrases.

## Read-only verification before restore

Obtain a complete set through the pinned NAS connection or another authenticated
recovery channel, including `COMPLETE.json`, into a private operator-owned
directory. A hash manifest proves integrity, not authenticity against someone
who can replace both payload and manifest. From the repository root:

```sh
python3 homelab/scripts/verify-backup.py /absolute/path/to/downloaded-set
```

The verifier reads only. It checks declared hashes/sizes, expected service
payloads, image identities and required recovery members; it rejects unsafe
archive headers, links, duplicate/unlisted payloads and incomplete configuration.
It does not extract credentials, validate their current authorization or start
services. `NAS_VERIFIED` alone is never a substitute for hashing the downloaded
files.

Next execute the [isolated restore rehearsal](restore-rehearsal.md) on fresh
storage with no production tailnet identity, device access or tunnel. Verify
database integrity, retained records/media and service behavior before retiring
an authority. A Nix rollback cannot undo an application database migration.
Record actual downloaded-set/restore evidence separately from synthetic tests
and installed schedules.
