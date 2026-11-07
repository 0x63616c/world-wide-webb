# Backend runtime foundation evidence

Current authentication endpoint status and the latest checks are recorded in [Runtime authentication handler evidence](#runtime-authentication-handler-evidence); earlier sections describe preceding checkpoints.

Date: November 7, 2026. Local development evidence only; no staging or production resources were accessed by the backend agent. CI is owner-deferred. Physical-device tests remain deferred to F13.

## Toolchain and dependencies

- Rust 1.99.1 (`58cf8f9c3`, installed exact toolchain), `wasm32-unknown-unknown`.
- workers-rs / worker-build 0.8.7; wasm-bindgen 0.2.129, js-sys/web-sys0.3.106.
- Serde1.0.229 / serde_json1.0.154, chrono-tz0.10.4, SHA-2 0.11.1.
- P-256 0.14.0 (pure Rust, no default OS randomness dependency), Ciborium0.2.2, serde_bytes0.11.19.
- Image0.25.10 with only JPEG/PNG; Askama0.16.1 with derive/std; rusqlite0.41.1 only in native tests.
- Node26.13.0 / Miniflare5.20261104.0-beta, the dependency used by current Wrangler4.158.0. The initial stable Miniflare4.20260730.0 had three high-severity audit findings through sharp/undici; the replacement lockfile reports zero. No override or audit suppression was used.

Exact Cargo/npm lockfiles are committed under `backend/`. Rust and Worker packaging are local tool pins, not proof of deployed Cloudflare compatibility.

## Checks and observations

`backend/scripts/check` runs formatting, warning-denying Clippy for native/all targets and Wasm, native tests, the actual Worker packager, npm clean install and local workerd tests. The batch passed 12 native tests (including shared fixture loops) and 2 local workerd/D1 tests; both Clippy targets and actual packaging passed. Subsequent additions to eligibility/tied-population coverage passed the same native Clippy/test checks.

- All eleven shared reducer cases pass in original and reversed arrival order. Shared competition fixtures cover ties, rank/medal skipping, twenty-participant percentile values, reset ordering and exclusive cutoff.
- Negative envelopes cover unknown fields, missing nullable epoch, uppercase UUIDs, unknown timezone, unsafe sequence and changed event/sequence identities.
- Synthetic P-256 assertions verify exact-body binding; changed body, RP ID, old counter and trailing CBOR fail. A separately generated Apple CryptoKit synthetic signature confirms ECDSA-with-SHA256 over the derived nonce. It is **not** an official App Attest attestation/device vector. The nonce is the message supplied to ECDSA-with-SHA256; passing it as a prehashed digest is the wrong protocol.
- Native JPEG/PNG re-encoding/dimension/input tests pass; Askama escapes nickname and attribute content. Both libraries compile into the actual Wasm target. Image worst-case CPU/memory on deployed Workers remains unmeasured.
- The compiled Rust Worker runs in local workerd and rejects forged bearer input without enabling any public mutation. An oversized body returns413; admin on the API route returns404.
- The same guard SQL runs against local workerd's D1 binding. A deliberately failed later receipt insert rolls back the guard, challenge consumption, key counter, receipt and job. Two competing batches with the same participant revision produce exactly one committed receipt/job/revision; the losing guard raises a constraint error. This is local D1 evidence, not a remote D1 integration pass.
- Initial packaging failed because `strip = true` removed the Wasm feature section. Changing only to `strip = "debuginfo"` retained it and the actual worker-build package succeeded. No runtime/signature check was weakened.

## Outstanding gates

F03 remains open: Apple JWT signature/audience/nonce/code exchange; full App Attest chain/nonce extension/key-ID/environment enrollment and official/device vectors; opaque token rotation/reuse/reauth/deletion flow; durable authorized receipt/idempotency/recompute operations; remote D1 rollback/CAS; avatar stress/moderation/R2; and real APNs HTTP/2 request/response validation. None of these may be inferred from local crypto or SQL tests.

The production Worker currently exposes no success operation and must not be presented as a ready backend. New route contracts and schema ownership remain coordinated with the primary agent. Staging deployment and credentials are primary-agent-only work.

## References

- [workers-rs0.8.7](https://docs.rs/worker/0.8.7/worker/) and [D1 batch API](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).
- [Apple server validation procedure](https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server).
- [RustCrypto P-256](https://docs.rs/p256/0.14.0/p256/) and [image decoder limits](https://docs.rs/image/0.25.10/image/struct.Limits.html).
- [workers-rs issue1014: full stripping breaks externref](https://github.com/cloudflare/workers-rs/issues/1014).
- [Independent Ruby/OpenSSL assertion implementation](https://github.com/catawiki/devicecheck-ruby/blob/main/lib/devicecheck/assertion.rb) checked for the nonce/signature API semantics; production code uses RustCrypto/Ciborium and no copied implementation.

## Authentication and ingestion component batch

The next local checkpoint passes **20 native tests and 3 workerd/D1 tests**, both Clippy targets with warnings denied, formatting, actual `worker-build` packaging, and npm audit with zero findings. Fourteen additional valid/rejected authentication request fixtures pass JSON Schema validation. The shared timezone vectors were obtained from Foundation and now run in Rust and Swift; canonical `GMT±HHMM` offsets are supported, while zero-offset aliases normalize to `GMT` and are rejected on the wire. Missing, empty, and unreadable write bodies return a safe error envelope.

Implemented components, not complete public endpoints:

- Apple identity JWT verification against bounded server-sourced JWKS: RS256 only, signature before claims, exact issuer/audience/nonce, expiry and issue-time checks, nonempty bounded subject, duplicate-key/unknown-critical-header rejection. Independent Node/OpenSSL-generated RSA vectors cover wrong audience, issuer, nonce, expiry, future issue time, subject, algorithm, key ID, critical header and damaged signature. Generated private keys are discarded and never committed. Fetching/caching the fixed Apple JWKS endpoint and exchanging authorization codes remain runtime integration work.
- WebPKI 0.103.15 plus RustCrypto X.509 0.3.0/DER 0.8.3, P-384 0.14.0 and P-256 verify certificate paths using a small signature-provider adapter; no custom ASN.1 certificate parser. The production verifier pins Apple's published App Attestation root, SHA-256 `1cb9823ba28ba6ad2d33a006941de2ae4f513ef1d4e831b9f7e0fa7b6242c932`. Synthetic OpenSSL certificate tests verify chain signature, validity, nonce extension and P-256 leaf key format; an unrelated root, wrong nonce, expiration and damaged signature fail. The test-only alternate root is private to the certificate module; the public API always uses Apple's root.
- Current Apple documentation requires `apple_validation_category_01` and `apple_bundle_version_01`. The new policy-bearing assertion verifier requires signed extension data and server-allowlisted bundle versions; production allows TestFlight/App Store categories, development allows development signing. No legacy-data downgrade is enabled. The legacy primitive remains for historical CryptoKit fixture comparison and is not the public-write authorization entry point. A credential-stage parser checks CBOR shape, RP hash, zero counter, AAGUID, credential ID, COSE public key and certificate binding. Its deliberately named `CredentialPendingReceipt` output **is not enrollment**: independent Apple CMS receipt verification remains unimplemented, as do official full-object/device interoperability tests. Do not persist this stage output as a trusted key.
- Session migration stores only token hashes and encrypted-receipt placeholders; access/session expiries, family revocation, refresh rotation CAS and the exact 60-second recovery policy are represented explicitly. The competition mutation guard now rechecks session revocation, deployment, installation, bearer hash/expiry and challenge-session ownership in the same batch as key/epoch/counter fences. Local workerd proves one refresh rotation wins and revoked sessions cannot commit. This does not yet implement token issuance, encrypted receipt creation, retry recovery handlers, push revocation, or Apple revocation credentials.
- The provisional ingestion planner validates all identities before writes, preserves receipt input order, rejects changed identities, marks duplicates, applies generation/epoch/setup/future eligibility and quarantines clock reversals. All-time totals replay accepted observations through the shared reducer, never client totals. It has no persistence/public endpoint yet; periods, live-score persistence, receipt replay, bounded retries and finalization remain required work.

Remaining implementation is not blocked solely on credentials: finish secret encryption and session/challenge handlers, Apple code exchange/JWKS transport, CMS receipt verification and full enrollment, separate join/transfer fences, durable authorized ingestion/receipt replay and live periods. All `/v1` success paths remain disabled until their whole authorization chain is connected. Remote D1, actual Apple enrollment and APNs still need later integration evidence. Nothing in this batch completes F03, issue33 or issue34.

## Runtime authentication handler evidence

Current runtime status: configured deployments now expose the sign-in challenge, native Apple sign-in (`purpose: sign_in`), refresh and logout handlers. Community operations and App Attest enrollment remain unavailable. This checkpoint passes **23 native tests and 6 compiled Worker/workerd tests**, warning-denying native/Wasm Clippy, formatting and Worker packaging. The final workerd tests also passed after adding malformed JSON, HTTPS, Retry-After, expired unused challenge and expired sign-in receipt cases. No live Apple/Cloudflare account, deployment, credential prompt or CI run was used.

- The local outbound service generates synthetic RSA issuer and P-256 client keys in process memory. It independently verifies the Worker's ES256 client-secret signature with Node/OpenSSL and checks its team/client audience/300-second lifetime. The compiled Worker verifies both signed identity tokens, exchanges a one-use code, checks exact subject/nonce/audience equality, and commits one session with a consumed challenge in real local D1. The outbound replacement is test infrastructure only: production code uses fixed Apple HTTPS endpoints with no configurable alternate issuer or verification bypass.
- Apple responses are streamed with a 64 KiB limit and a ten-second abort signal; a one-minute isolate-local JWKS cache never serves expired data after a fetch failure. Actual workerd rejects `RequestRedirect::Error` at construction. `Manual` plus strict status-200 checking is the supported fail-closed implementation: a synthetic redirect is rejected without contacting its target. Oversized token exchange responses are rejected before deserialization.
- Access/refresh tokens come from Worker Web Crypto. Only SHA-256 token hashes go into token tables. AES-256-GCM receipts and Apple revocation credentials use fresh random 96-bit nonces and purpose/deployment/owner/operation associated data. Node/OpenSSL independently decrypts a real Worker-created test receipt and verifies it matches the issued pair. The retained Apple subject/refresh token are encrypted; their plaintext is absent from D1 ciphertext checks. Server client signing keys, HMAC keys and encryption keys remain secret bindings.
- Two concurrent refresh requests with the same operation converge on the same encrypted response-loss receipt. Other-operation reuse revokes the family and push binding. A stale recovery request cannot return a refresh token already rotated again and does not revoke the still-valid newer session merely for requesting stale recovery. A new family cannot reuse another family's participant-scoped operation ID. Non-secret operation tombstones preserve this rule after encrypted receipts are purged.
- Sign-in receipt recovery verifies the same signed subject/nonce and normalized business body, returns the original session only within 60 seconds, and rechecks current account state, restriction, participant revision, session/device/deployment, and refresh-token state. Changed device/body, wrong subject/nonce, banned/deleting account or revoked session fails. Expiring the consumed challenge does not prematurely invalidate its already-committed receipt; an unused expired challenge fails. Once the receipt expires, a retry cannot create another session from the spent challenge. A valid native JWT paired with a valid but different-subject exchange JWT is rejected.
- Logout atomically fences authorization, revokes the family, records the operation and removes its push binding. Existing banned accounts can establish a fresh privacy-capable session; sign-in does not enroll them or bypass community restriction guards. `participants.account_state` supports the upcoming deletion fence; new sign-in refuses deleting/deleted accounts.
- The exported scheduled handler is locally invoked against workerd. It purges expired ciphertext/credentials/challenges/rate windows while preserving non-secret replay tombstones. Provision the shared **five-minute dispatcher Cron** through OpenTofu before enabling auth in a deployed environment. The recovery authorization window ends exactly at expiry; physical cleanup occurs at the next successful scheduled pass, with opportunistic receipt cleanup on auth requests. A fixed safe log marker reports cleanup failure for later monitoring integration.

Bindings, key-rotation constraints and remaining endpoints are listed in `backend/README.md`. Subject HMAC lookup checks every retained configured version and migrates a matched account digest without changing its restriction. Old keys cannot be removed while an active identity/ban or encrypted record still depends on them.

Remaining F03/#33 gates: real Apple interoperability/configuration, native reauthentication and deletion recovery, complete App Attest CMS receipt verification/enrollment and official/device vectors, attestation challenge rate limits, and deployment/host configuration. F04/#34 still requires durable authorized event ingestion, joins/transfers/resets and live/finalized scoring. Auth success does not imply any competition endpoint is enabled. Native sign-in nonce semantics were checked against Apple's [request nonce documentation](https://developer.apple.com/documentation/authenticationservices/asauthorizationopenidrequest/nonce); Folding explicitly hashes the returned nonce string and shares `contracts/fixtures/apple-nonce.json` with Swift.

## CMS enrollment and connected competition implementation checkpoint

The next implementation batch adds bounded BER CMS verification, the fixed Apple Root CA G3 receipt
trust anchor, and encrypted receipt storage. CMS accepts Apple's indefinite-length BER and optional
signed attributes; duplicate attributes, extra signers, wrong digest/content type, wrong application,
key/client hash or receipt kind, stale creation and expired receipts fail closed. The receipt signer must
carry Apple's dedicated receipt marker, preventing an unrelated certificate under the shared root from
becoming a receipt authority. Test-only private roots exist only under `cfg(test)`.

Official Apple validation-guide inspection identified the credential EKU, P-384 issuers signing SHA-256
leaves, and four-byte little-endian validation-category CBOR byte strings. The guide's flags can omit ED
while extension bytes remain present; the implementation still requires and verifies the extensions.
The published guide sample has inconsistent key/nonce/receipt bindings and is not treated as an
end-to-end positive fixture. A licensed historical real-device Apple receipt and assertion are retained
with provenance under `backend/tests/fixtures/apple-ios14`; modern full synthetic vectors use temporary
OpenSSL keys, with no private keys committed. Earlier focused native runs validated the historical
receipt/assertion and synthetic receipt cases. Final full-suite verification of this combined batch is
explicitly deferred under the owner's implementation-first direction.

The connected runtime now performs session-bound key enrollment, signed join/transfer, signed durable
event ingestion and owner receipt reads. Enrollment never stores a key before both certificate and CMS
verification. Assertion transport decrypts the challenge nonce, verifies exact request bytes and signed
metadata, and provisionally extracts the counter. Each D1 mutation fences session validity, restriction,
participant revision, key/environment/counter and challenge expiry/purpose. Ingestion additionally fences
the active epoch/generation, stores immutable observations and receipts, and updates all-time scores
from reducer replay. Join starts fresh public history; transfer retains history. Pending custom names
retain the approved safe display name. Full multilingual moderation and its administrator UI are pending.

Native and Wasm compilation pass for the new modules (explicit pinned Rust compiler). Comprehensive
runtime/concurrency/replay acceptance remains pending, as do sustained history-size replay limits,
period score consumers/finalization, mutation-rate enforcement, privacy lifecycle, preferences and real
Apple/device enrollment. Existing test harness migrations/configuration were extended, but that harness
has not been rerun for this combined batch. The shared dispatcher is aligned to the frozen five-minute
schedule; exact cryptographic/receipt expiration never waits for scheduled cleanup.
