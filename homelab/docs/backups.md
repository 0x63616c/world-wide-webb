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
database and private identity. Sunday Hindsight exports provide an additional
portable recovery path. Preserve actual image digests and service assignments.

The recovery archive includes Compose/configuration, image identities and
plaintext runtime credentials. Local sets require owner-only permissions and
must stay on the existing private NAS share. Never put payloads, archive
contents, credentials or database rows in Git or CI artifacts.

The NAS uploader pins the certificate before authentication, omits overwrite,
and downloads each uploaded payload to compare its SHA-256 and byte count. It
refreshes authentication once only for the explicit expired-session response;
ambiguous transport failures are not replayed automatically. After all payloads
verify, the driver validates set completeness and service health, then publishes
`COMPLETE.json` and marks the local set `NAS_VERIFIED`. Incomplete sets remain
for diagnosis. The code retains seven verified full sets, scoped hourly history
and eight first-of-week portable export archives; it never treats an incomplete
set as eligible for normal pruning.

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
The production state hash stayed unchanged. This proves the copied state is
usable; it is **not** a NAS download/restore or off-host key recovery test.

Before enabling the relocated automatic writer or retiring old recovery paths,
add an owner-scoped encrypted state/configuration NAS backup, verify the actual
download, and repeat isolated restoration with separately recovered credentials.
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
