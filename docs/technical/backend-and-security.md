# Backend, competition, and security implementation contract

**Current owner amendment — #76/#77/#78:** badges are owner-only, featuring is disabled, existing eligible history is imported when joining (and backfilled for existing accounts), direct photo/name edits replace Edit Profile, and optional grouped badge push is supported. See [the exact contracts and evidence](../experiments/owner-polish-2026-11-08.md). This supersedes conflicting earlier feature-plan wording; live rollout and deferred device acceptance are separate.


## Runtime and module choices

Use workers-rs for the Cloudflare runtime, Serde/serde_json for typed JSON, D1 prepared SQL, R2 private object storage, and Queues/Cron for retryable work. Use a compile-time autoescaping Rust HTML template engine (default Askama) for admin. Compile template, crypto, image decoder, and APNs integration to the actual Worker target in F03 before depending on them. No assumed Tokio socket server, filesystem, or long-running background thread inside a Worker.

Domain functions accept values and return decisions. Worker operations own authorization, SQL, and IO. Keep SQL with the operation that uses it, not in a generic CRUD framework. Store secrets in Worker secret bindings; never return them to admin pages or logs. Versioned HTTP routes use `/v1`; [wire schemas](../../contracts/README.md) define JSON shapes.

## Protocol defaults

HTTPS only. JSON UTF-8, integer Unix milliseconds, lowercase UUIDs. Max authenticated JSON body 256 KiB, at most 256 events per submission. Return `413` before expensive decoding/attestation for oversized bodies. Reject unsupported schema versions and malformed identifiers. Unknown object fields are rejected in v1 writes; responses may gain optional fields and clients ignore those. Page size defaults to 50, maximum 100, opaque signed cursor expires after 15 minutes. Cursor includes query period/snapshot version and last ordering key; changing a query invalidates it.

Errors always have `{code, request_id, retryable}` and optional `retry_after_seconds`. No raw SQL, JWT, Apple response, personal data, or stack trace in responses. Use `400 malformed_request`, `401 authentication_required`, `403 restricted`, `404 not_found`, `409 conflict`, `413 body_too_large`, `422 invalid_input`, `429 rate_limited`, `503 temporarily_unavailable`. Specific conflict codes include `identity_conflict`, `generation_stale`, `epoch_stale`, `assertion_replay`, `challenge_expired`, and `snapshot_changed`.

Every user mutation has an `operation_id` UUID; events additionally have stable event IDs. Namespace operation IDs by participant and route family. Persist successful mutation receipt and normalized request hash. Same ID/body returns the same outcome; same ID/different body returns 409. Never include credentials in the normalized business-body hash. Receipt lookup still requires the current authorized participant; deleted identities cannot recover old data through receipts.

## Authentication and authorization sequence

1. `POST /v1/auth/challenges` creates a cryptographically random 32-byte nonce, expires in 5 minutes, and returns challenge ID/nonce. Limit unauthenticated issuance initially to 20/minute per network identifier with bounded hashed-log retention; tune for shared networks. Bind challenge to purpose, deployment, and any known session/device. No reusable global challenge.
2. The client uses native Sign in with Apple, a nonce and state per attempt, and sends the authorization code/identity token plus the challenge ID to `POST /v1/auth/apple`. Verify Apple's signature/key, issuer, permitted audience, expiry, nonce, and one-time challenge. The native request nonce and expected signed claim are lowercase SHA-256 hex of the UTF-8 base64url challenge nonce string, set explicitly by our client (not automatically hashed by Apple); the persisted challenge nonce_hash is that digest. Exchange code server-side as required to retain revocable authorization. Identify the participant by Apple's subject, not email or display name. Do not publish Apple's supplied name/email.
3. Return a short-lived opaque bearer access token (15 minutes) and rotating refresh token (30 days inactivity, 90 days maximum session lifetime). Store only token hashes server-side. Detect reuse of a rotated refresh token and revoke its session family. Client tokens use Keychain, device-only after-first-unlock accessibility; tokens are never copied to iCloud. Encrypt retained Apple revocation credentials with a versioned server key outside D1; revoke on deletion.
4. Session establishment permits profile/privacy operations. Joining, device transfer, and competition writes also require an enrolled App Attest key. `POST /v1/attestation/challenges` is session-authenticated, binds key/device/purpose, expires in 5 minutes, and is single-use.
5. `POST /v1/attestation/keys` validates the full Apple attestation: chain to Apple root, nonce extension, credential/key ID, relying-party hash, correct app/environment identifiers, and receipt as specified by Apple. Persist key ownership, public key, environment, and counter. Do not hand-roll certificate/CBOR parsing; select maintained libraries verified by F03 fixtures. A successful signature alone is insufficient.
6. For protected mutations obtain a fresh purpose-bound challenge. Sign `clientDataHash` over a defined request binding: SHA-256 of UTF-8 `Folding-v1\n{deployment}\n{method}\n{path}\n{challenge_id}\n{nonce_base64url}\n{sha256_hex_of_exact_HTTP_body}`. No query strings on signed mutations; body bytes are frozen before assertion. The verifier must use those exact received bytes. Check assertion signature, relying-party ID, participant/device/key binding, and monotonically increasing counter.
7. Atomically consume the challenge and advance the key counter alongside mutation receipt creation. Serialize client signing/sending per installation to avoid legitimate concurrent assertions overtaking each other. On lost response, request a fresh challenge/assertion for the same operation/body; server receipt idempotency returns its prior result after verifying ownership and the fresh assertion. Never accept an old assertion again merely because the operation is a retry.

Challenges consumed on a failed committed validation cannot be reused. Rollback on a transaction conflict leaves no partial counter/challenge mutation; retry the operation with a fresh assertion to simplify client recovery. Development and production app IDs, keys, sessions, and challenges are disjoint. Unsupported attestation or Apple outages preserve local tracking but cannot silently permit public ingestion. Sign-in/profile/deletion/export support must not require working attestation to delete.

Routes are denied by default. Reads of leaderboards require an authenticated, joined, non-banned participant in v1. Avatar reads require the same community authorization; use short cache lifetimes and current moderation visibility. Admin routes require independently verified Cloudflare Access plus allowlisted administrator identity. Admin status is never a field accepted from mobile clients.

## Operations and permissions

Profiles/milestones add the operation contracts in [HTTP](http-contracts.md) and the [single-release plan](profiles-and-milestones.md). Public profile lookup requires current eligible community membership and current target visibility, returning an explicit allowlist without progress/dates. Owner progress, earned featuring and displayed-group acknowledgment remain session/participant/generation/revision guarded; they never accept client counts or weaken ingestion attestation. Migration 0021 supplies derived projection/backfill/grant/selection/acknowledgment state. Scoring, moderation, deletion and reset update or purge that state in their existing guarded batches. Backfill uses durable bounded keyset pages; partial projections remain unavailable and cannot resurrect reset/deleted accounts. Install the additive migration before its Worker and ship all client surfaces in the same release. Provider acceptance is separate from local implementation.

The following are the complete v1 operation families; nested response shapes and mutation inputs are in [http-contracts.md](http-contracts.md). Implement only these families until a contract change is reviewed.

- Authentication: challenge, Apple exchange, refresh, logout. Session lifecycle only; never award scores.
- Profile: get/update self; nickname moderation and notification locale/preferences. Session required; profile edits require current non-banned community eligibility.
- Enrollment: join, transfer device, delete. Join/transfer require assertion; delete requires an authenticated session without attestation. Reauthentication required if auth age exceeds 15 minutes for delete. Apple sign-in UI provides reauthentication.
- Events: submit batch, get receipt. Session + current active device/epoch + assertion required for submit.
- Reset: submit logical reset marker. Session + assertion; local reset can happen while offline, and public submission waits for acknowledgment.
- Results: live leaderboard page/self, finalized self-results, share-card data. Session + eligibility; never accept client totals.
- Avatars: bounded upload, status/delete, approved image retrieval. Session + eligible profile; upload assertion required. Direct bucket URL is never public.
- Reports/blocks: report a participant/content ID, hide/unhide participant. Session; rate-limited. Banned users retain appeal/deletion access but cannot create community reports.
- Push: register/delete installation token and edit preferences. Session; tokens scoped to installation/environment, never accepted for another participant.
- Admin: participants, published names/avatars/reports/quarantine, moderation actions, corrections, audit. Access auth + CSRF for all mutations.

## Competition epochs and device transfer

Maintain a server-issued random `competition_epoch_id` with `joined_at`, participant, active installation, and data generation. Local events carry this epoch only if recorded after the confirmed join/transfer. Pre-join private events are never decorated later.

A join starts a new participation epoch and totals from zero. Transfer invalidates the old device's epoch and issues a new epoch retaining the participant's accepted history. Reset changes the accepted data generation while retaining membership/ban and starts totals from zero. Leave closes membership and removes public data; rejoin issues a new epoch and does not restore removed totals. Personal data generations and competition epochs are different identifiers; never overload one for both.

Transfer cutoff default: old-device submissions durably accepted before transfer remain; submissions from its invalidated epoch received after transfer are rejected, including old offline batches. New-device events count only after confirmed transfer. This rule deliberately uses server authority and avoids trusting backdated client claims. A concise transfer confirmation can say “Pending folds on your old phone won’t be added.” Private history/export still preserves those observations.

## D1 data model and invariants

Keep SQL migrations in `backend/migrations/` with monotonically ordered names. All timestamps UTC integer milliseconds. Add indexes for the stated access patterns, not speculative fields.

- `participants`: ID primary key; UNIQUE Apple-subject HMAC; membership, restriction, row revision, current generation and epoch. Store actual Apple subject only if needed for token handling, encrypted; minimal active-ban lookup uses a keyed subject digest. Support account-secret rotation without clearing restrictions.
- `sessions`, `refresh_tokens`, `attestation_keys`, `challenges`: token hashes/owners/expiry/counters. Unique key ID; challenge purpose/used flag; indexes on expiry for cleanup.
- `epochs`: participant/device/generation scope, created/closed server times. Epoch ID primary key.
- `submissions`: UNIQUE(participant, operation_id), immutable normalized body hash, received_at, state, moderation version. Receipt rows do not contain bearer tokens.
- `events`: UNIQUE(participant, event_id) and UNIQUE(participant, device_id, sequence); immutable envelope/hash, owning submission, current disposition. Foreign participant ownership mandatory in every query.
- `participant_revisions`: monotonically increasing state revision used to compare-and-swap any operation touching scoring/reset/enrollment.
- `event_decisions`: append-only disposition/version audit with observed/received/approved time and moderation actor; accepted/rejected/quarantined. Reset/deletion removes event content according to retention rules, leaving only minimal necessary audit.
- `live_scores`: participant, generation, period, accepted fold total, reducer watermark/version. Cache, rebuildable from eligible decisions; not the source of identity or auth.
- `periods`: UNIQUE(kind,start_ms), end, cutoff, state, result version, finalization marker.
- `finalization_inputs`: immutable copied event envelopes and disposition versions for a period/result version, source sequence, receipt time, and freeze watermark; include prior-period baselines. `finalization_progress` records a completion row for every snapshotted participant, including zero scorers. These staging records are private and have deletion fences.
- `results`: UNIQUE(period,result_version,participant), score/rank/population/percentile/medal, identity visibility flag. These are frozen awards; reset/delete removes the participant's entry without reranking other recipients.
- `jobs`: UNIQUE(kind,logical_key,version), due/lease/status/attempts. Transactional outbox for queue publication and notifications. Queue messages contain job IDs, not authoritative business payloads.
- `profiles`, `avatar_objects`, `reports`, `blocks`, `moderation_actions`, `notification_preferences`, `push_installations`, `notification_receipts`: constrained ownership, indexes on pending states. Audit actors are server-derived.

### Atomic mutation recipe

A network round trip between `SELECT` and `UPDATE` is not a transaction. Never use `BEGIN`/`COMMIT` calls around separate D1 binding requests as if they share a connection.

1. Read state/revision and compute the domain decision outside the write batch. Treat the result as provisional.
2. Send one D1 `batch` of prepared statements. Its first write inserts an operation guard whose CHECK fails unless the participant revision, active epoch/generation, challenge unused/expiry, and counter conditions still match. Use an `INSERT ... SELECT CASE WHEN (...) THEN 1 ELSE 0 END` into a guard column constrained to `1`; zero affected rows are not sufficient evidence of rollback.
3. In the same batch consume challenge/counter, persist event/receipt, apply derived score changes, increment participant revision, and insert jobs. Unique constraints detect content/identity races. Domain decisions never bypass the guarded batch.
4. On any statement failure the whole batch must roll back; verify this in real D1 integration tests. On a revision race, reread/recompute and retry at most three times, then return retryable 409. On duplicate operation, compare its hash and return its authorized receipt. Remove successful temporary guard rows in the batch or use the receipt row as the guard; do not leak guard records indefinitely.
5. A queue publisher scans committed jobs and sends job IDs. Crash after send/before marking sent produces a duplicate delivery; consumers claim jobs conditionally, and the business operation remains idempotent.

Zero-row conditional updates are expected under races and must be checked or made to trip a SQL constraint. Never turn `INSERT OR IGNORE` into a success receipt without reading why it was ignored. The F03 storage experiment must include two competing writers and a forced mid-batch failure.

## Ingestion and score calculation

Validate the whole envelope structurally before accepting any events. A malformed batch gets 422 with no write. Valid batches receive a per-event disposition; an accepted request is not a promise that every observation earned a fold. Same event ID with changed content is a batch conflict; valid duplicate IDs return duplicate receipts.

Source sequence defines the observation order; observed time assigns the resulting counted transition to a period. Deduplicate/reduce the accepted observation stream before grouping by period. An observation can be accepted but add zero folds. Setup events are permanently ineligible. Reject old generation/epoch and mismatched device; quarantine implausible future timestamps (more than 5 minutes ahead of server receipt), clock reversals, or suspicious patterns. Do not invent an upper offline age limit for otherwise valid all-time events; weekly/monthly cutoff still applies.

Initial network caps: 60 submission requests/minute/participant, 256 events/request, 10 challenge requests/minute/session; use Retry-After and account for offline batches. These are engineering caps, not physical plausibility thresholds. Tune physical-pattern quarantine from measured device behavior in F02; do not ship an arbitrary automatic permanent-ban number.

Resource protection adds approximate Cloudflare per-location burst counters **before** body processing, D1 and cryptographic verification: 600 API requests/minute/network, 60 authentication requests/minute/network, and 120 requests/minute/credential digest. Counters are environment-isolated. A forged or rotated credential still consumes the network budget; the credential counter never authorizes a request. Configured deployments fail closed when a binding is missing or unavailable. Existing authoritative account/session limits remain in D1; location counters are not global quotas, DDoS protection or a monthly spending cap. Shared-network false positives and distributed attacks require monitoring and tuning. API burst rejections and ordinary 4xx event errors do not generate ingestion-metric writes.

New event batches load only participant-owned identity/sequence collisions and the nearest accepted, non-test predecessor/successor for each incoming event/device/generation. Migration 0019 adds the partial expression index. At most four existing observations per incoming event are loaded. Compute old/new reducer differences on this subset and atomically apply score deltas under the existing session, revision, epoch and assertion guards. This preserves late insertions, duplicates, clock quarantine and repeated-state baselines; accepted-stream timestamps are monotonic by the existing clock-reversal rule. Full-history replay remains the recovery/moderation authority. Do not deploy this code before its additive index migration; do not remove the index when rolling back the Worker.

Late/out-of-order observations can change live totals after replay. Closed-period awards never change automatically. A late earlier event may alter all-time or open-period reduction, but the finalized period retains its frozen eligible observation set and version. Repeated-state baselines for a new period include preceding accepted observations even if those observations belong to an earlier period. A participant with zero counted folds is excluded from comparison population.

Rank = 1 + number of participants with strictly greater score. Percentile = round-half-up(100 × number of *other* participants with strictly lower score / number of other participants); null below 20 participants. Ties receive the same rank and percentile. Stable pagination tie order is participant UUID ascending, never an implied tie-break award. Medals correspond to rank 1/2/3, so ties can skip silver or bronze.

## Period finalization and notifications

State machine: `open -> grace -> finalizing -> finalized`. End and cutoff are exclusive boundaries: receipt must be strictly before `end+24h`. Scheduler runs every five minutes and catches up missed periods; jobs are keyed by kind/start/version.

At finalization claim, record a server-owned freeze timestamp and decision watermark. In one guarded D1 batch, materialize `finalization_inputs` from immutable observations received strictly before cutoff and whose disposition is accepted at the freeze watermark. Include preceding observations needed for each source's baseline, also filtered by that same cutoff/watermark. Capture a roster of participants/generations even if their score may be zero. Do not copy mutable per-event counted values or `live_scores`.

Replay each frozen source stream independently through the Rust reducer, then assign its counted transitions to the requested period. Store private staged totals with `(period, result_version, participant, generation)` uniqueness and a completion row for every roster member. Retries overwrite only identical same-version results; disagreement is an error requiring diagnosis. Once all roster members are complete, a single guarded D1 batch computes ranks/population with SQL window functions, inserts visible results and notification jobs, and atomically updates the published version/state. Readers see only that published version.

Reset/delete/ban fences are rechecked on staging writes and publish; remove/suppress affected participants and purge their copied event content. A deleted or reset participant cannot be recreated by a late computation. A moderation change after freeze that changes historical awards uses a correction; current public restriction still suppresses the profile immediately. If one-batch input materialization/publish exceeds measured D1 limits, the milestone fails until an equivalent consistent snapshot strategy is reviewed and tested; do not publish partial chunks.

Quarantined-at-freeze records are excluded. Later approvals may update all-time but need an explicit correction to alter that period. Correction creates a new result version and audited reason; sends no duplicate original award notification. Removal/reset suppresses the person's result and cancels their jobs; it preserves others' earned ranks. Reads resolve visibility against current profile restrictions, including cached responses.

Push settings are per participant; delivery targets the active installation only in v1. Logical notification key is `(participant, period, original_award)` and is unique independent of retries/result corrections. Schedule next local 09:00 strictly after finalization, recheck opt-in/ban/reset/deletion at send, and retain in-app results even if push is lost. APNs cannot provide an exactly-once end-to-end display guarantee: reuse stable APNs ID/collapse identifier on retry, suppress our duplicate jobs, and document ambiguous network outcomes. A terminal invalid token disables that installation token.

## Names, avatars, moderation, and deletion

Nickname: trim outer whitespace, NFC display form, 3–20 extended grapheme clusters, no controls/newlines/URLs, at most one internal space in a run. Use NFKC/case-folded detection form for versioned multilingual whole-word/obfuscation checks; do not alter the displayed name into that detection form. Rejected names leave the prior name intact; all other valid names publish immediately on join/edit without a manual queue. Generated names have no privileged bypass to impersonate admin. Limit profile edits to 5/hour initially. Admin name removal remains available afterward.

Avatar: input JPEG/PNG only, bounded encoded bytes/dimensions/pixel count and one still image. Client crops to square; server independently decodes bounded input, strips metadata and produces a sanitized JPEG derivative. A successful guarded upload publishes the derivative immediately and replaces the profile pointer atomically; it never waits for administrator approval. Incomplete or failed uploads remain private. Admin removal, reports, restrictions and durable R2 tombstone cleanup remain intact. Preserve the legacy pending upload receipt for existing clients: they immediately refresh the authoritative approved profile; publication_state also reports approved. R2 object names are random; never trust a supplied object path or fetch an arbitrary remote avatar URL. No external moderation provider is required.

R2 privacy fence: upload object keys are independent random identifiers and writes are conditional create-only. Purging overwrites each key with a zero-byte tombstone containing no user metadata rather than deleting the key. This prevents an in-flight conditional upload from recreating image bytes after a privacy removal. Retries must reject tombstones, and image reads never serve them. Content-free markers remain indefinitely while keys are never reused; account cleanup removes D1 identity/object mappings after content purge completes. This trades additional object/operation overhead for a per-key deletion race fence; monitor marker counts and storage billing before changing retention.

Reports accept a subject/content ID, enum reason, and optional <=500-grapheme comment; 5/day/participant initially. Reporter's identity is admin-only. Blocks affect presentation only, not rank or population. Removal invalidates cached derivatives; use versioned image IDs, short cache TTL (5 minutes), and authenticated visibility checks. Shared images already saved outside the app cannot be recalled; never promise that deletion erases someone else's saved copy.

Reset/delete first apply a transactional visibility and ingestion fence, cancel jobs/revoke relevant sessions as appropriate, then purge dependent D1/R2 data through retryable jobs. Expose deletion `pending` until jobs finish; failed cleanup retries and alerts. Deletion is available while banned and does not depend on successful App Attest. Do not destroy the credential needed to revoke Apple authorization before queuing revocation safely. Retain only case evidence for 90 days after closure and minimal active-ban subject digest while in force; yearly permanent-ban review. Account deletion must not clear that restriction by recreating the same Apple subject.

Admin validates Access signature/issuer/audience/expiry and allowlist on every request, including `workers.dev`/alternate routes. Browser mutations use POST, a session-bound CSRF token, same-origin validation, and escaped templates. Record actor, operation ID, reason, time, and before/after references. No arbitrary SQL console or bulk deletion endpoint. The moderator chooses quarantine/reinstate, suspend/ban/unban, approve/remove profile content, or a previewed versioned period correction.

## Integration acceptance

Test real database batch rollback and CAS races; signed request body tampering; bad Apple audience; old counters; expired/reused challenges; response-loss retry; stale epochs; delete/ban versus queued work; pending avatars inaccessible; forged admin posts; tied ranks; late earlier observations; freeze versus approval; and receipt pagination stability. Shared fixtures complement, not replace, negative security tests.

Sources: [App Attest server validation](https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server), [Cloudflare D1 database bindings](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/). Values such as expiry, caps, retry policy, and schema names above are Folding defaults to test, not limits claimed from these providers.

### Admin-managed minimum build

`administrative_configuration.minimum_ios_build` is the single source for compatibility policy. The protected Operations form uses the existing Access, CSRF, revision, atomic guard and idempotent audit path. A bounded 60-second isolate cache avoids a policy read on every public request; saves invalidate the local cache without extending remote cache lifetimes. Policy failures fail closed for business routes, while privacy/recovery exemptions remain. Migration 0020 starts disabled; no environment override is supported.
