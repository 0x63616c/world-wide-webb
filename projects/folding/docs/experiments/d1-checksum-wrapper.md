# D1 checksum migration wrapper — 2026-11-07

Added `scripts/migrate-d1.py` and the deployment runbook. Original SQL migrations are untouched. The wrapper generates per-file checksum/predecessor guards in the same migration SQL request that pinned Wrangler executes with its ordinary migration-name insert; it reads both durable ledgers before/after and refuses unchecksummed legacy history or changed applied sources. Config/environment/database identities, committed SQL and exact Worker commit are required for apply. No implicit repair/reset/baseline adoption or manual SQL transaction wrapper is added.

Implementation checks: Python syntax/help passed; twelve instrumented migration files parsed/applied in an isolated in-memory SQLite database. Inspected actual Wrangler 4.158.0 implementation and official per-migration rollback documentation. No local Wrangler migration run, remote D1 request/write, credential lookup, kill/concurrency fault test or old-Worker compatibility test was performed. Those remain final acceptance work.

The primary agent confirmed both provisioned remote D1 databases were fresh. The backend owner confirmed no transaction commands, ledger mutations or external side effects are planned in current migrations. Newly authored backend files remain owned by that agent and must be committed before deployment.

Runbook: [D1 migration operations](../technical/d1-migration-operations.md).
