# Staging D1 deployment — November 7, 2026

Applied committed migrations `0001` through `0015` to remote staging D1 `c1d89248-4402-4204-bfe5-de7a8e326d70` using `scripts/migrate-d1.py apply`. The database started with zero applied migrations. Wrangler exited zero; the wrapper read back all fifteen migration names and source hashes successfully.

Evidence: `build/migrations/staging/4b174526-956d-4fc4-98ff-d3a9c6e6c8ea/result.json` and its manifest, SHA-256 `457fd9b3ecf6bb503e0fb913985a6e67f71fd93b85b44fd95105e49dda64e5ca`. Verified at `2026-11-07T20:11:17.549245+00:00`. The uncommitted monitoring migration was explicitly excluded; subsequent migrations must use the same wrapper and verified prefix.

This proves successful staging schema installation and ledger/hash readback. It does not prove the deferred fault-injection, concurrent migration, Worker compatibility or production deployment checks. No production database migration or public API route was enabled by this operation.
