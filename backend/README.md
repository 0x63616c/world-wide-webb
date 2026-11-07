# Rust backend foundation

The workspace has two crates: `folding-domain` owns deterministic wire validation/reduction/ranking, and `folding-worker` owns runtime, assertion, image, HTML and transaction integrations. No per-feature crates or Node backend are introduced. Node is only the pinned local workerd/D1 test harness.

## Local verification

```sh
rustup toolchain install 1.99.1 --profile minimal --component clippy --component rustfmt --target wasm32-unknown-unknown
RUSTUP_TOOLCHAIN=1.99.1 cargo install worker-build --version 0.8.7 --locked
backend/scripts/check
```

Use Node 26.13.0. The check script explicitly selects the Rust pin so an inherited `RUSTUP_TOOLCHAIN` cannot silently change the compiler. Cargo and npm dependencies are locked. `worker-build` produces the Worker module/Wasm in `crates/worker/build`, which is ignored. Generated packaging uses `--no-opt` to avoid an unpinned wasm-opt download; release size/CPU optimization is a later measured gate. Keep Cargo `strip = "debuginfo"`: stripping all sections removes `target_features` required by the pinned wasm-bindgen packager.

The Miniflare 5 beta is the exact version used by Wrangler 4.158.0 at this checkpoint. The older stable Miniflare tag had high-severity dependency advisories; the selected lockfile audited clean. Tests use its explicit v4-option conversion and enumerate JS/Wasm modules. No automatic CI, remote D1 binding, account token or deploy command is configured.

## Implemented interfaces

- `EventBatch::decode` validates bounded input, exact write fields, required nullable epoch, canonical UUIDs, known timezone, safe integer limits and immutable event identities before an operation can write.
- `reduce` processes per-device/generation sequence order, ignores tests/retries, preserves interruption/deduplication rules and returns counted event IDs for period allocation. Do not pre-filter observations by date before reduction.
- `rank_scores` excludes zero scorers, assigns competition ranks/tie medals, deterministic ID order and integer round-half-up percentiles. `eligible_by_receipt` uses the exclusive 24-hour cutoff.
- `client_data_hash` binds exact HTTP bytes, method/path, deployment and challenge nonce. `verify_assertion` checks a provisionally trusted P-256 key, RP hash and increasing counter. It does **not** validate an attestation certificate chain, authenticate a session, authorize a participant or consume a challenge. Those required operations are not yet implemented.
- Avatar processing rejects unsupported/content-type-mismatched/animated/oversized input, applies decoder allocation/dimension limits and re-encodes a 256px JPEG. Worker stress/CPU acceptance and R2 moderation lifecycle remain pending. Some valid high-bit-depth inputs may exceed the 64 MiB decoder allocation cap and fail safely; tune only after measured runtime evidence.
- Askama autoescaping is compiled for Wasm and tested with hostile nickname/attribute text. Admin authentication/forms are not implemented.
- The D1 fence SQL trips a CHECK constraint on stale participant revision, generation/epoch, key/device/deployment, challenge nonce/purpose/expiry or counter. All concrete mutation writes and receipt/job inserts must stay in that one guarded D1 batch. The helper is not an authenticated ingestion route.

## Deliberately unavailable operations

Every `/v1/` request currently fails closed with 503 after the bounded request check; admin/unknown paths return404. No bearer text, test identity or simulator fixture enables public writes. The local runtime test proves this behavior; it is not an API acceptance test. There are no production capability claims or health-success responses to accidentally pass a release preflight.

Before deployment acceptance, implement the full Apple exchange/key-enrollment/session/refresh lifecycle, production configuration validation/host separation, route-specific request schemas, authorized idempotent mutations, persisted scoring/jobs, real D1 integration, App Attest official/device vectors, APNs HTTP/2 connectivity and bounded-image Worker stress evidence. Neither F01 nor F03 is complete. See [runtime evidence](../docs/experiments/backend-runtime.md).
