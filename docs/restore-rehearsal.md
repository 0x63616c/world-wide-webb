# Restore rehearsal

Status: the synthetic Hindsight database rehearsal passes in hosted CI; no real
backup has been restored. Keep the mini and its backup job authoritative until a
downloaded backup has passed this rehearsal. No rehearsal containers have been
started on either home machine.

Use one disposable Linux VM with its own Docker daemon and fresh storage. A new
Compose project on a production daemon is insufficient: the saved definitions
include fixed container names, external volumes and HA host networking. Preload
the recorded image digests, then block external networking before supplying
restored data or credentials. Verify that isolation before starting applications.
Expose any rehearsal UI only through the operator's local connection.

Keep the downloaded set and working directory private. Run the
[read-only verifier](backups.md#read-only-verification-before-restore), then
record the set identity and manifest hash. A successful result establishes
completeness and integrity checks, not application recovery. The recovery bundle
contains plaintext credentials; neither its contents nor database rows belong
in a PR or CI artifact.

## Restore one service at a time

| Service | Saved state | Rehearsal and evidence |
| --- | --- | --- |
| Control Center | PostgreSQL custom-format dump and media archive | Initialize fresh PostgreSQL using the recorded image. With the app stopped, restore into a fresh `control_center` database using `pg_restore --exit-on-error`, then restore media. Start the recorded app with workers off and external networking blocked. Check database health, source revision, representative records and a referenced media file. |
| Home Assistant | Cold `/config` archive | Preserve `.storage`, SQLite files and their sidecars. Check database integrity before startup. Use an isolated rehearsal definition with the image's normal startup, without production host networking or the `ha0` bridge wait. Check configuration loading, local UI, entities and history. Restored automations must have no path to real devices. |
| Bambuddy | App data, studio API data and separate Tailscale state | Restore app/studio data into fresh volumes with original ownership. Start only the app and studio API, with no path to the printer. Check database integrity, archived prints/files and slicer readiness; the slicer requires amd64 support (emulation on ARM). Keep the production Tailscale archive offline and never start its sidecar during rehearsal. |
| Hindsight | Logical PostgreSQL dump and separate Codex directory | Initialize and restore the embedded database as described below before starting the application. Check banks and representative memories through local read-only operations. Keep provider access blocked. Weekly bank exports are an additional recovery path, not proof that the full dump restores. |
| Cloudflared | Saved configuration, token and image identity | Check that recovery inputs are present. Do not start the production connector in rehearsal; origin routing is checked during the separately approved cutover. |

Service data archives need a reviewed extraction step into fresh storage that
rejects escaping paths and unsafe links and preserves required container
ownership. The current verifier inspects recovery-bundle headers, but does not
authorize extraction of service archives. Do not extract them as host root.
Discover actual SQLite filenames from the selected set rather than assuming
paths. These extraction and application checks remain to be executed.

## Hindsight's logical dump is not a `.pg0` directory

The Compose bind mount expects `/home/hindsight/.pg0`, while the backup contains
`hindsight.dump`. Copying the dump to that directory does not restore it.

Read-only OCI inspection resolved the pinned image index
`sha256:a88678c038b0e4340822b02a5efc566c56d8176b5bffa731bc433fd37f978e4c`
to ARM64 manifest
`sha256:0be688fa345092f6d88687330a6e9da012673652c5894787bef5527cc0082e30`.
Its labels identify Hindsight 1.0.0 at
[`39c65ffe`](https://github.com/vectorize-io/hindsight/tree/39c65ffe2f140d0c84cee58566cad8900c5b9908).
The [locked dependencies](https://github.com/vectorize-io/hindsight/blob/39c65ffe2f140d0c84cee58566cad8900c5b9908/uv.lock)
select pg0-embedded 0.15.2; that release's
[version definitions](https://github.com/vectorize-io/pg0/blob/29191fbf00f218d09f271c33c3d8ec5525c3c4ab/versions.env)
specify PostgreSQL 18.1.0 and pgvector 0.8.5.

The source supports the following sequence. CI verifies its database mechanics
with synthetic data; the production dump and application checks remain outstanding:

1. Override the pinned image's normal command, run as its UID 1000, mount the
   dump read-only and provide fresh writable `.pg0` storage with no external
   network. Start only pg0 through its Python wrapper, not the Hindsight app.
2. Initialize the instance using the
   [application's pg0 settings](https://github.com/vectorize-io/hindsight/blob/39c65ffe2f140d0c84cee58566cad8900c5b9908/hindsight-api-slim/hindsight_api/pg0.py).
   Check the historical dump's server version, owners and ACL requirements;
   do not silently discard ownership errors or assume defaults fit every set.
3. Read the new instance metadata inside the container and invoke its matching
   `pg_restore --exit-on-error` against the fresh database. Keep credentials
   inside the container. Account for the bundled installation's library path.
4. Verify representative database contents and stop pg0 cleanly, including on
   failure. Restore the Codex archive separately, then start the normal pinned
   application while isolation remains enforced.

The [pg0 Python wrapper](https://github.com/vectorize-io/pg0/blob/29191fbf00f218d09f271c33c3d8ec5525c3c4ab/sdk/python/pg0/__init__.py)
captures CLI output; the native CLI prints connection information. Do not relay
that output or exception payloads. CI now verifies offline initialization,
extension restore and library loading. Normal application startup remains unverified.

## Synthetic database check

The Rust helper now provides `homelab-host rehearse-hindsight-restore --dump PATH`
for use inside that isolated pinned image. It requires a non-root owner and an
empty private `.pg0` directory; it never overwrites an existing database or
automatically retries a failed attempt. It restores through stdin using typed
instance metadata, suppresses database diagnostics and requires confirmed
shutdown. A shutdown failure instructs the operator to stop the disposable
container. The initialization credential is the image's public rehearsal default,
not a production secret supplied by the operator.

Run the disposable container with Docker's `--init`: pg0 starts PostgreSQL as
a detached process and requires it to disappear after shutdown. An ordinary
test/helper process running as PID 1 does not reap those orphaned children.

The targeted [Hindsight recovery workflow](../.github/workflows/hindsight-recovery.yml)
builds the Linux helper and runs a real synthetic database test in the pinned
ARM64 image. The container has no external network, receives only read-only test
binaries, and has CPU, memory and process limits. It receives no host credentials
or real backup data. Standard Linux ARM64 hosted runners are
[available to private repositories](https://github.blog/changelog/2026-01-29-arm64-standard-runners-are-now-available-in-private-repositories/).

The test covers dump/restore, Unicode rows, sequence state, pgvector data,
persistence after restart, existing-state refusal and corrupt dumps.
[Run 41791613360](https://github.com/0x63616c/homelab/actions/runs/41791613360)
passed at `a6aa0ed`: one real database test, zero ignored. This does
not establish compatibility with historical production dumps, Hindsight schema
migrations, provider calls or normal application startup. PostgreSQL restoration
executes SQL from the dump: only use backups obtained through the authenticated
recovery path. This operation is not a sandbox for an untrusted dump.

## Evidence required before cutover

Record the backup set and manifest hash, image digests, restore results,
integrity checks, representative application reads and measured storage usage.
Record isolation checks and confirm rehearsal instances are stopped. Keep
sensitive evidence outside Git and include only a redacted result summary.

A successful isolated rehearsal permits planning a cutover. It does not prove
printer access, HA discovery, tailnet identity handoff or Cloudflare routing;
those need explicit checks after stopping the old instance and transferring
deployment ownership. The mini cannot be erased until the migrated services,
headless reboot, independent operation and replacement backup/restore path have
all been verified.
