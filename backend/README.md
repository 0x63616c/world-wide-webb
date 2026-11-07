# Rust backend

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
- `client_data_hash` binds exact HTTP bytes, method/path, deployment and challenge nonce. `verify_assertion` checks a provisionally trusted P-256 key, RP hash and increasing counter. It does **not** validate an attestation certificate chain, authenticate a session, authorize a participant or consume a challenge. Certificate and metadata verification stages exist, but CMS receipt verification and complete key enrollment remain unavailable. Production assertion checks must use `verify_assertion_with_policy`; the historical primitive is for fixture comparison.
- Avatar processing rejects unsupported/content-type-mismatched/animated/oversized input, applies decoder allocation/dimension limits and re-encodes a 256px JPEG. Worker stress/CPU acceptance and R2 moderation lifecycle remain pending. Some valid high-bit-depth inputs may exceed the 64 MiB decoder allocation cap and fail safely; tune only after measured runtime evidence.
- Askama autoescaping is compiled for Wasm and tested with hostile nickname/attribute text. Admin authentication/forms are not implemented.
- The D1 fence SQL trips a CHECK constraint on stale participant revision, generation/epoch, key/device/deployment, challenge nonce/purpose/expiry or counter. All concrete mutation writes and receipt/job inserts must stay in that one guarded D1 batch. The helper is not an authenticated ingestion route.

## Authentication runtime

When all required configuration and migrations are present, the actual Worker implements `POST /v1/auth/challenges`, `/auth/apple` with purpose `sign_in`, `/auth/refresh`, and `/auth/logout`. Auth writes require HTTPS and JSON. Missing configuration fails closed. Apple endpoints are fixed HTTPS URLs, responses are bounded, redirects are never followed, and requests have a ten-second deadline. The native JWT and code-exchange JWT must both verify and identify the same subject/nonce/audience. Initial sign-in does not enroll a device or award scores.

Opaque access tokens last 15 minutes; refresh families have 30-day inactivity and 90-day absolute limits. D1 contains token hashes, AES-256-GCM encrypted Apple authorization credentials and short-lived encrypted response-loss receipts. Token reuse revokes the family and push binding. Recovery checks a live unrevoked session and never returns a refresh token already rotated again. Operation IDs are participant/route scoped, including across families; non-secret tombstones outlive encrypted receipts. Sign-in preserves banned-account privacy access while preventing stale receipt replay from exposing a previously unrestricted profile.

Apply **all migrations in order**. Schedule the single exported dispatcher every five minutes, matching the operations contract: it purges expired receipt ciphertext, tokens, sessions, challenges and short-lived network rate windows. Exact authorization expiry is checked independently of cleanup timing. A consumed challenge can support only its committed 60-second sign-in receipt; it never establishes another session. Account deletion must atomically set `participants.account_state` and revoke sessions before cleanup. New sign-in refuses deleting/deleted accounts; reauthentication and deletion recovery are separate pending handlers.

### Required Worker bindings

| Binding | Storage | Meaning |
| --- | --- | --- |
| `DB` | D1 binding | This deployment's database |
| `DEPLOYMENT` | Variable | `staging` or `production` |
| `AUTH_ENCRYPTION_KEY_VERSION` | Variable | Current version in the encryption key ring |
| `AUTH_ENCRYPTION_KEYS` | Secret | JSON object mapping versions to base64url 32-byte AES keys |
| `AUTH_NETWORK_HMAC_KEY` | Secret | Base64url 32-byte network rate-limit digest key |
| `AUTH_SUBJECT_HMAC_KEY_VERSION` | Variable | Current version in the subject key ring |
| `AUTH_SUBJECT_HMAC_KEYS` | Secret | JSON object mapping versions to base64url 32-byte subject HMAC keys |
| `APPLE_SIGN_IN_CLIENT_ID` | Variable | Deployment's registered native bundle identifier |
| `APPLE_SIGN_IN_TEAM_ID` | Variable | Apple team identifier |
| `APPLE_SIGN_IN_KEY_ID` | Variable | Sign in with Apple key identifier |
| `APPLE_SIGN_IN_PRIVATE_KEY_PKCS8` | Secret | Base64url DER PKCS#8 encoding of the Apple P-256 private key |

The primary agent provisions bindings from approved secret storage; no keys belong in Git, command literals or logs. Retain old encryption keys until their ciphertext is migrated/purged. Retain old subject HMAC keys until every associated identity/active-ban digest is migrated or expires through the reviewed policy. Login searches all configured subject keys and migrates the matching participant's digest without changing membership or restriction. The key rings accept at most eight concurrent versions; never remove old active-ban keys to make room without migration. Key values differ between deployments and between encryption, subject and network purposes.

## Remaining unavailable operations

All community writes, App Attest enrollment/challenges, reauthentication, deletion recovery, profile/results and admin handlers remain unavailable. No test identity or simulator fixture enables them. Local runtime tests replace only the outbound Apple service with a synthetic cryptographic issuer; production code has no alternate Apple URL/root or verifier bypass.

Before deployment acceptance, finish the full key-enrollment/reauthentication/deletion lifecycle, production host separation, authorized durable ingestion/scoring/jobs, remote D1 evidence, official/device App Attest vectors, APNs HTTP/2 and image Worker stress evidence. Neither F01 nor F03 is complete. See [runtime evidence](../docs/experiments/backend-runtime.md).

### App Attest and competition implementation

Apply migrations 0005–0006 before enabling the additional routes. Required public bindings are
`APP_ATTEST_APP_ID` (the full Apple team ID and bundle identifier), `APP_ATTEST_ENVIRONMENT`
(`development` or `production`), and `APP_ATTEST_BUNDLE_VERSIONS` (a JSON array of explicitly allowed
`CFBundleVersion` strings). No alternate certificate root or verifier is configurable. Each deployment
has independent D1 data, session keys and App Attest environment.

The client generates its key before requesting an enrollment challenge. Enrollment hashes the decoded
32-byte nonce; assertion requests use the existing exact method/path/body/nonce binding. Challenge nonce
bytes and CMS receipts are encrypted with the versioned server key ring. Credentials require the Apple
App Attestation chain and receipt CMS verification under Apple Root CA G3, including signer purpose,
application, credential key, client-data hash, creation time, expiry and ATTEST receipt type.

Implemented routes now include key challenges/enrollment, join/transfer, event batches, owner batch
receipt lookup and `/me`. All mutations fence session/revision and consume assertions inside the same
D1 batch as their business changes. Idempotent retries require a fresh assertion and challenge. Join
and transfer have distinct membership semantics; ingestion rechecks the active epoch/generation. Names
that differ from the safe approved profile enter a pending queue without being published. All-time
scores replay the accepted source stream; pending score jobs require the period-scoring consumer.

These new routes have passed compilation, **not final runtime acceptance**. Before deployment, complete
multilingual nickname detection/approval, privacy lifecycle (leave/reset/delete/recovery), preferences,
period scoring/finalization and job consumption, rate enforcement for business operations, and the final
workerd/D1 and device validation gates. Current `/me` preferences are the immutable opt-out defaults until
the preference mutation is implemented. No leaderboard endpoint is exposed prematurely.
