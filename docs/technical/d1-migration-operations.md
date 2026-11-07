# D1 migration integrity and execution

Run `scripts/migrate-d1.py` instead of invoking raw migration apply against Folding databases. OpenTofu still owns database provisioning; Wrangler still executes each migration. The wrapper does not use a second database driver or maintain a separate success flag after applying SQL.

## Commands

Use the public generated Wrangler JSON from `scripts/generate-worker-config.py`. The wrapper verifies its account/database/environment identity, keeps only the database settings in its temporary Wrangler config, and addresses the actual database name rather than a mutable binding alias.

```sh
python3 scripts/migrate-d1.py prepare \
  --configuration /absolute/path/generated-staging.json --environment staging
python3 scripts/migrate-d1.py status \
  --configuration /absolute/path/generated-staging.json --environment staging
python3 scripts/migrate-d1.py apply \
  --configuration /absolute/path/generated-staging.json --environment staging
```

`prepare` performs no database operation. `status` performs read-only Wrangler queries. `apply` writes only through the pinned `wrangler d1 migrations apply` command. Production uses its separately generated configuration and `--environment production`.

Primary agent/CI only: use the existing authorized credential environment. The wrapper never calls 1Password, puts a token in arguments, or persists raw command output. Do not enable Wrangler debug logging. Serialize staging and production operations under their existing environment-specific concurrency locks with cancellation disabled.

For an isolated local rehearsal, append both `--local` and `--persist-to /absolute/path/disposable-state`. Never infer production transactional acceptance from local SQLite/Miniflare behavior.

`apply` requires exact committed migration bytes, no added/deleted migration files outside HEAD, and generated `WORKER_VERSION` matching HEAD. Commit the backend batch and regenerate bindings before running it. Numbered files must form the contiguous `0001_*.sql` onward sequence. Existing applied filenames, hashes, byte lengths and order cannot change. Add a forward migration instead.

## Atomic ledger design

The wrapper creates immutable per-attempt copies of each source file, leaving the repository migration files untouched. Each generated SQL migration:

1. Creates `folding_migration_checksums` if absent.
2. Inserts its own filename, ordinal, source-byte SHA-256, byte length and source commit under a database `CHECK` assertion. The assertion requires every preceding source/hash/name and both ledger counts to match the expected prefix.
3. Executes the original source SQL. Wrangler appends its own `d1_migrations` name insert to this same migration query.

There is no second “record success” call after applying SQL. The hash row, source DDL/DML and Wrangler row commit together under Wrangler's per-migration rollback contract. A changed prefix between wrapper preflight and apply fails inside the migration batch. Earlier successful migrations remain applied when a later one fails.

The wrapper rejects explicit transaction/savepoint/external-database commands and any source reference to its reserved ledger tables. It does not wrap files in assumed `BEGIN/COMMIT` statements. Current source `PRAGMA foreign_keys = ON` is preserved. Changes requiring unsupported constructs need a deliberate wrapper/contract update, not an undocumented bypass.

Before and after apply, the wrapper reads both ledgers and requires the exact source prefix/hash relationship. A legacy `d1_migrations` row without its source hash is an error; there is **no automatic baseline adoption**. Both provisioned remote databases were reported fresh before this implementation. Unexpected pre-existing history requires a separately reviewed reconciliation based on trusted historical artifacts.

## Resume and evidence

Each attempt writes under `build/migrations/<environment>/<UUID>/` unless an explicit unused `--output` is given:

- `manifest.json`: target database/account, commit, pinned Wrangler version and actual CLI/wrapper hashes, original source hashes and generated SQL hashes.
- `migrations/`: exact instrumented SQL supplied to Wrangler.
- `wrangler.json`: minimal public database config with absolute migration path.
- `result.json`: before/after durable counts and CLI exit code when readback completed.

Retain these restricted deployment artifacts with the release evidence. They contain schema/provenance, not tokens or user records. Do not publish broad database dumps or raw logs.

After an interrupted CLI, rerun the wrapper with the same committed sources and correct generated configuration. It reads durable state first; Wrangler skips names already committed, and the checksum fence checks their bytes. If the last migration committed despite response loss, it is not replayed. If a query failed, its hash row must not survive independently. A mismatch stops the run rather than guessing which side succeeded.

Concurrent ledger reads may conservatively stop if another deployment commits between reads. Retry only after the competing environment operation has finished. The SQL predecessor fence is additional protection, not a replacement for the deployment concurrency lock.

## Provider evidence and remaining acceptance

Inspected installed Wrangler **4.158.0**:

- `buildMigrationQuery` reads a file and appends the normal `d1_migrations` insert.
- `migrations apply` calls `executeSql` once per resulting query.
- Local execution uses D1 `batch`; remote command execution posts one SQL string through D1 `/query`.

[Cloudflare's Wrangler migration contract](https://developers.cloudflare.com/workers/wrangler/commands/d1/#d1-migrations-apply) explicitly says a failed migration rolls back while preceding successful migrations remain applied. [D1 batch documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) describes batch rollback. The [REST query reference](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/) does **not** independently establish general arbitrary multi-query atomicity, so this wrapper relies specifically on the pinned, documented Wrangler migration operation.

Implementation checks covered Python syntax/help and compilation/application of all twelve generated files in isolated SQLite. This is not remote D1 proof. Final acceptance still needs the real Wrangler/D1 fault rehearsal: failing trailing statement rolls back schema/hash/name together; response loss or killed CLI resumes without duplicate effects; concurrent altered-prefix attempt fails; changed/removed source fails before mutation; old/new Worker compatibility passes. Do not claim those checks have passed merely because the implementation exists.
