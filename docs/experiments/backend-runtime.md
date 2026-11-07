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

## Privacy lifecycle and live board implementation checkpoint

The subsequent implementation batch connects signed reset and unrestricted-session leave. A greater
valid reset generation wins without changing the epoch's original issuance time; stale reset markers
return the current winner. Leave closes membership and removes mutable public observations/scores
atomically, while restricted users can still invoke it without App Attest. Future finalized-result tables
must participate in the same privacy visibility/purge fence when introduced.

Live all/week/month boards use reducer-derived scores, UTC calendar windows, competition ranking and
percentiles. Source replay precedes period grouping. Accepted timestamps up to five minutes ahead also
materialize the next calendar window when near a boundary. Blocks filter presentation after rank and
population calculation. Cursors are HMAC signed, expire after 15 minutes and bind viewer, deployment,
period, limit, snapshot and last ordering key. Changed snapshots return `snapshot_changed`. Historical
period queries remain unavailable until published frozen versions exist. Large-history replay and board
pagination currently load full matching sets; scalable SQL/read-model work remains an acceptance gate.

Native Apple reauthentication verifies the same subject as the current authenticated session, exchanges
the native code, and returns an encrypted, one-use, five-minute proof bound to that session. An exact
retry can recover its unspent proof while valid. Deletion consumes that proof in the same D1 batch as
session/key revocation, membership removal and polling capability issuance. The narrow polling token
expires after 15 minutes. Recovery requires a fresh nonce-bound Apple exchange for the original subject
and operation; it returns only deletion status and never recreates the account. Fresh Apple grants created
for recovery have a separate encrypted revocation job.

The dispatcher leases pending deletions, calls Apple's fixed HTTPS revocation endpoint, and purges
owned profile/session/key/observation data only through a guarded completion batch. Repeated revocation
uses Apple's documented idempotent HTTP 200 behavior. Completed operations retain a minimal keyed
subject/operation mapping for 30 days; unrestricted deleted identities then purge, while restricted
identities retain their enforcement record. Apple outages leave deletion pending and publicly hidden.
The current dispatcher polls D1 jobs directly; Cloudflare Queue publication/consumption and shared job
backoff/metrics are still required integration work.

Verification at this implementation-first checkpoint: native all-targets compilation, Wasm compilation,
and all eight migrations applying to a fresh in-memory SQLite database. No final workerd/concurrency,
crypto, device or live-account acceptance is claimed for this combined batch. Next required coverage
includes lost deletion responses, capability expiry/recovery, revoked proof/session races, deletion-job
lease recovery, Apple outage retries, period boundaries, cursor tampering and privacy-versus-ingestion
races. Profile/avatar moderation, preferences, reports/block mutations, finalized results and APNs remain
outstanding. Revocation contract source: [Apple token revocation](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens).

## Frozen results, moderation and capability implementation checkpoint

Migrations 0009–0010 add the decision watermark, period state machine, frozen roster/input records,
staged replay totals, atomically published ranked results, unique original-award jobs, report cases,
moderation audit rows and durable rate windows. Finalization copies all eligible baseline observations
and the current roster in one D1 transaction at freeze, using strict receipt cutoff and current decision
version. Each frozen source replays independently; publication computes tied ranks/percentiles with SQL
window functions and switches the published version atomically. Failed or incomplete staging never
publishes partial awards. Privacy mutations remove copied inputs/results and suppress pending awards;
other recipients' stored rank/population never changes merely because a person disappears.

The dispatcher catches up calendar periods, stages bounded roster batches and publishes completed
periods. Self-result history, share data and historical leaderboard reads use only published versions.
Current visibility/generation/join-era checks and signed snapshot cursors apply. Measured D1 snapshot
and publication size limits, production history scale, Queue orchestration, APNs delivery and correction
preview/versioned republishing remain final implementation/acceptance gates; this checkpoint does not
claim those components are complete.

The admin origin now verifies Cloudflare Access RS256 signatures against the configured team's HTTPS
certificates, exact issuer/audience/time claims, app token type and explicit administrator email allowlist.
Every request authenticates independently, including alternate-host attempts, which fail the configured
canonical-origin check. POST forms require matching Origin, an Access-token-bound HMAC CSRF token,
a reason and expected row revision. Askama escapes the People, Names, Reports, Quarantine, Audit and
participant-evidence views. Name approval/rejection/removal, report close/reopen, suspension/ban/unban
and batch quarantine/reinstatement commit audit rows atomically with the guarded change. Reinstatement
only restores observations that the moderator quarantined from an accepted state and refuses a new
clock reversal; validation-quarantined events do not become accepted through this shortcut. Live scores
replay immediately after a moderation change; frozen awards require the still-pending correction flow.

Nickname policy is versioned under `policies/names-v1.json`; NFC display normalization is separate from
NFKC/full casefold detection. Whole words and explicit obfuscations are checked without naive substring
rejection. Every new custom name still waits for human approval. This initial multilingual vocabulary
requires final localization/moderation review. Profile edits (5/hour), reports (5/day), blocks and event
batches have durable rate windows. Report case evidence purges 90 days after closure. Broader case
retention/annual permanent-ban review, appeals, audit/queue pagination refinements and admin operational
switches remain outstanding; these are not silently treated as finished moderation requirements.

`GET /v1/capabilities` is public and read-only. Its exact `WORKER_VERSION` and owner-managed
`VERIFIED_CAPABILITIES` deployment allowlist let release preflight distinguish code presence from final
accepted capability. The default is an empty list; unknown/unimplemented names fail configuration. This
is not a private-tracking remote switch. HTTP catalog additions (capabilities and report decisions) were
approved by the primary agent and coordinated with release/native work.

Checkpoint evidence: native all-targets and Wasm compilation pass; ten additive migrations apply to
fresh SQLite; 231 literal SQL statements prepare successfully against that schema. These compilation
checks do not replace the deferred final workerd/D1 concurrency, real Access/Apple, image-stress, UI,
notification or device tests. No deployment, credentials, secret reads or CI runs were performed.
Access protocol reference: [Cloudflare JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

## Avatar and notification implementation batch (November 7)

Migrations 0011–0012 add private avatar reservations/purge jobs/moderation alerts, preferences,
installation token uniqueness and leased award delivery. Avatar PUT authenticates/asserts before bounded
image decoding; reservation precedes create-only R2 writes. Superseded/rejected/removed objects are
replaced by zero-byte metadata-free tombstones so an in-flight retry cannot recreate deleted content.
Those opaque random-key markers remain indefinitely (additional object/write cost, no user content).
Only approved current derivatives can be served publicly to eligible signed-in participants; private
originals are never served. Access-protected admin previews use sanitized derivatives. Leave returns
pending until its R2 purge finishes, and account deletion also waits for purge completion. `/me` exposes
pending leave receipts. Custom avatars retain the previous approved image while a replacement waits.

`AVATAR_UPLOADS_ENABLED=false` is the default. `ADMIN_EMAIL_ENABLED=false` independently gates the
optional `ADMIN_EMAIL` send-email binding and `ADMIN_ALERT_FROM`/`ADMIN_ALERT_TO` vars. The protected
avatar queue works without email. Inbound support forwarding is not evidence of outbound sender
verification. No email was sent during this implementation. Enabling requires verified sender capability.

Preferences use weekly/monthly `off|all|podium`, an IANA home timezone, and a supported app locale.
Push registration encrypts tokens and uses a dedicated stable `APNS_TOKEN_HMAC_KEY` to make a token
unique across accounts for its topic/environment. Re-registering records a timestamp; invalid-token
responses cannot disable a newer registration. Rotation of this indexing key requires a coordinated
binding migration or complete token re-registration, not an unannounced secret replacement.

APNs uses ES256 from `APNS_PRIVATE_KEY_PKCS8` (base64url PKCS8 DER), `APNS_KEY_ID`, `APNS_TEAM_ID`,
`APNS_TOPIC`, and `APNS_ENVIRONMENT=sandbox|production`. Production rejects sandbox configuration.
`APNS_ENABLED=false` prevents delivery and suppresses advertising `notifications.results` even if it
appears in the acceptance allowlist. An encrypted D1 provider-token cache reuses the winning token
across isolates for 50 minutes. Award jobs schedule the next local 09:00 strictly after publication and
recheck consent, current generation/join era, restrictions, active installation and session before send.
Localized payloads contain only the result announcement and `folding:{kind,period_id}` navigation data.
Stable APNs UUID/collapse keys survive retries; transient/network errors back off with an eight-attempt
budget. APNs acceptance is recorded as sent, not proof of display; ambiguous network outcomes may
still duplicate delivery. A push already accepted by APNs cannot be recalled by a later privacy change.

Focused checkpoint: actual Wasm compilation passes; twelve migrations apply on fresh SQLite and 282
literal SQL statements prepare. Native compilation is checked separately at the batch boundary. Full
R2/workerd race tests, image memory limits, live APNs transport/authorization/delivery, email delivery,
localization review and device behavior remain final acceptance work. Queue transport, explicit result
corrections and remaining admin operational controls are the next implementation batch. No credentials,
external sends, deployments, CI runs or independent review were performed here.

Protocol sources: [Apple token authentication](https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns),
[APNs requests](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns),
[APNs response timestamps](https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/RemoteNotificationsPG/CommunicatingwithAPNs.html).

## Queue and operational-control implementation checkpoint

Migration 0013 adds the versioned administrative configuration, separate operational audit and durable
D1 dispatch outbox. One five-minute Cron inserts unique category/slot work records and publishes only
opaque job IDs to `JOBS`. The consumer derives the work type from D1, leases the dispatch, and invokes
the bounded domain worker (whose individual mutation/job fences still apply). Lost queue publication
is retried from D1; duplicate messages are harmless. The consumer uses 12 business execution attempts,
30-second exponential backoff capped at one hour with jitter; exhausted identifiers go to `JOBS_DEAD`
and remain failed in D1. A failed dead-letter publication retries publication without executing business
work beyond the attempt limit. Completed dispatch metadata expires after 30 days. Provider queue
settings: batch size 1, batch timeout 5 seconds, retries 12, initial retry delay 30 seconds, concurrency 2.

`/admin/config` is Access-authenticated, escaped HTML with revision fences, CSRF, audit reason and
idempotent operation receipts. Competition ingestion, avatar uploads and result notifications read
these controls on relevant requests/jobs; defaults are enabled behind independent deployment acceptance
gates. Pausing never clears business queues or affects personal tracking. APNs provider configuration
or authorization failures pause notification work and surface an alert in this protected page with an
operational audit. The APNs retry policy now matches the frozen 12-attempt/30-second/one-hour schedule;
this supersedes the eight-attempt policy in the preceding checkpoint. Consent/ownership are checked
again after provider-token preparation immediately before dispatch; in-flight external delivery remains
inherently non-recallable. Remaining work includes explicit correction previews, complete failed-job
management UI, appeals/case retention and final runtime/service acceptance.

Approved owner-recovery contract amendment: authenticated `/me` and PATCH profile responses include
optional `pending_avatar_id`, selecting the current uploading/pending reservation. Ranked/public/share
projections exclude it. The native client can recover or cancel an upload after response loss/relaunch.
Focused verification: actual Wasm compilation and 299 literal SQL preparations across 13 migrations pass.
Full Queue/D1 concurrency and provider failure simulations remain deferred final acceptance.

## Historical correction implementation checkpoint

Migration 0014 adds audited correction snapshots. The protected period list links finalized periods to
an explicit prepare/preview/publish workflow. Preparation freezes currently accepted observations
received before the original cutoff, at the current decision watermark, using the prior eligible roster
and its original generation/join era. Reset/deleted rosters cannot be recreated. A queued correction
worker reuses the shared reducer and stages a new unpublished result version. Existing published
results remain visible throughout preparation. Expired unpublished copies are purged.

The preview shows changed fold totals/ranks and binds all eligible result rows to a SHA256 digest.
Confirmation is restricted to the preparing administrator, the exact published base version, the
preview digest and a ten-minute ready window. Publication checks current privacy eligibility and
result-row count inside the transaction, writes a reasoned audit and swaps only the published version.
A privacy removal invalidates the old preview instead of silently publishing a different result. No
original-award job is inserted by corrections; pending original jobs recheck the latest published result.
Original finalization time remains unchanged, so correction does not move notification scheduling.

Actual Wasm compilation passes. Fourteen migrations apply and literal plus multiline SQL guards prepare
on SQLite. Full original-finalization/correction/privacy interleavings, large-roster D1 statement limits
and browser review remain final acceptance work; no live results have been corrected or published.
