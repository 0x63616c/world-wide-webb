> Historical reference from before the native/Rust reset. Current operations and source locations are
> defined by `CODEBASE_OVERVIEW.md` and `docs/runbooks/native-rust-cutover.md` at the repository root.

# Native Swift / Rust cutover

This runbook describes the remaining production transition; it does not certify that it has occurred.
The authoritative acceptance record is `docs/plans/native-rust-progress.md`. Keep private data outside Git.
Calum accepts downtime and replacement of stateless infrastructure; database and Photo Booth preservation
are mandatory. Retain original PostgreSQL dumps, full media and encrypted recovery archives.

## Local publication gate

Finish the implementation and local tests, then one independent final review and its fixes. Keep everything
local until that gate passes. Verify `tools/check` areas, production iPad build/unit tests and real retained
feature interactions. Exercise iPhone/Duo and Mac last. Record privacy-safe screenshots/video; preserve
physical-iPad or deployment checks as explicitly outstanding until they actually run.

The current typed PanelKit client remains; `tools/check integration` proves actual Rust read/mutation and
Photo Booth upload/list/download. `tools/test_state_backend.py` proves encrypted state, native locking,
wrong-key failure and backup recovery without production resources. Hosted CI must prove the real Docker
image before release; a local host without Docker cannot certify that step.

## Prepare production ownership

1. Coordinate all secret access through one primary-agent PTY, with history and tracing disabled. Pass required
   fields directly to commands without printing values. `tools/provision_runtime.py` renders private runtime
   files outside Git and retains an existing installation token on rerun. Per-device enrollment requires an
   explicitly provisioned Cloudflare token pair. Do not reuse a credential formerly embedded in app builds.
2. Preserve existing runtime flags, especially the verified bedroom input configuration. Set the existing HA
   origin, explicit worker ownership, data/media directories and private secret directory in runtime.env.
   Do not activate an unverified physical switch binding. Compose mounts the entire SQLite directory.
3. Export Pulumi recovery state privately through supported tooling; disable its writer. Inventory existing
   resource IDs and retained HA, Hindsight, Bambuddy and DSM routes. Install pinned OpenTofu on the mini.
4. Bootstrap `~/homelab-infra/cloudflare` with private production variables and `secrets/STATE_PASSPHRASE`
   and `secrets/CF_API_TOKEN`, all owner-only. Import retained resources into enforced encrypted state at
   `cloudflare.tfstate`; review the full plan privately. Keep encrypted state recovery copies and the recovery
   key in the approved secret system. Verify NAS read-back and restore before enabling automatic applies.
5. Provision API DNS/Access and privately enrolled device credentials. Verify TLS, authenticated reads/writes
   and background alarms. Retain the legacy app hostname until the native client works, then retire it and
   revoke the formerly bundled service credential. Unrelated service routes and tunnel identity must survive.

## Final database freeze and cutover

1. Use `deploy/mini/cutover-backup.py --help` to take the final stopped-writer PostgreSQL dump and full media/
   runtime archive while holding the deployment lock. Verify the backup and NAS read-back. The stopped old
   writer remains stopped through errors until explicit acceptance or rollback; never race writers.
2. Restore this final dump in an isolated PostgreSQL instance. Export with `tools/data_migration.py export`
   over a local Unix socket, using a read-only repeatable-read snapshot. Import into a NEW SQLite target
   with a separate raw archive using its `import` subcommand. Never overwrite the existing rehearsal or source.
3. Accept only exact schema/type/row/value reconciliation, integrity and foreign-key checks, preserved IDs and
   complete Photo Booth reference/file resolution. Reconcile the final media manifest against the frozen source.
   Preserve all source tables in the raw archive, including retired data. Missing old wake images are not a blocker.
4. Stage the accepted database/media without replacing originals; write the release script's required
   `.sqlite-import-verified.json` marker only after final acceptance. Release the cutover lock deliberately
   for the serialized release step, keeping the old app writer stopped.
5. Publish the drafted GitHub project/issues and one candidate PR. Required CI must pass at the current head;
   fix forward without bypass. Merge deliberately, allowing tested-main image deployment to stage matching
   operations code. The release script validates the existing database, snapshots it with SQLite's backup API,
   checks immutable image identity, starts Rust and publishes its accepted pointer only after health/revision checks.
6. Verify worker ownership, retained integrations, exact data/media preservation, Swift client operations and
   Apple processing/TestFlight metadata. Stop the app's old PostgreSQL container after acceptance, retaining
   its data and dumps. Independent service databases remain untouched.

## Recovery and evidence

`recover.sh` validates and starts an accepted immutable Rust image; it does not reverse schema changes.
Inspect migrations before image rollback. To return to the old stack, first stop Rust, restore a known-consistent
old database/media/runtime snapshot and verify the old image before re-enabling its single writer. Do not run
old PostgreSQL writers against an earlier stale snapshot or discard new writes without reconciliation.

`backup.py` defaults to SQLite; explicit PostgreSQL mode exists for retained recovery archives. It backs up
independent services, app media/runtime and encrypted OpenTofu state, uploads to NAS and reads back SHA-256.
Preserve the existing 04:15 LaunchAgent; installed scripts live under `~/homelab-backups`. Demonstrate a fresh
post-cutover SQLite/media/state restore before closing tracking issues.

Measure comparable CPU/RSS and database/media sizes against the recorded baseline, with the same workload
and sampling interval. Distinguish logical database bytes, on-disk allocation and compressed archives. Report
actual results; no resource savings are assumed from language or database choice.
