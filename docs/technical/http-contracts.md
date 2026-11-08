# HTTP v1 operation catalog

This catalog fixes wire names and request/response ownership. JSON schemas under `contracts/schemas/` cover the critical event/reset/error messages. Remaining object shapes are defined below and must be encoded in typed Swift/Rust DTOs before implementing their work order. A new route/field meaning requires updating this catalog and shared fixtures in the same PR.

## Common shapes

- `ID`: lowercase UUID string. `Instant`: integer Unix milliseconds. `Page<T>`: `{items: T[], next_cursor: string|null, snapshot_version: string}`. `Mutation`: request contains `operation_id: ID`; success includes `operation_id` and `request_id: ID`.
- `Generation`: `{revision: integer >=0, reset_id: ID}`. Inside an isolated private account namespace, initial generation uses revision 0 and reset_id `00000000-0000-0000-0000-000000000000`. Namespace/account separation is independent of reset identity; only explicit revisions >=1 reset history. Revisions increase only for reset; reconnect/join must not create a private reset implicitly.
- `Event`: see [event.schema.json](../../contracts/schemas/event.schema.json). `EventDisposition`: `accepted` (durable validated observation, may count zero), `duplicate`, `quarantined`, or `rejected`; rejected/quarantined entries include a stable reason code. `counted_folds` is deliberately absent from batch receipts because replay can change live reduction.
- `Profile`: `{participant_id, nickname, avatar_id: ID|null, membership: not_joined|joined|left, restriction: none|suspended|banned, nickname_status: approved|pending, avatar_status: none|pending|approved|rejected}`. Fields are server-derived except requested nickname. Rejection reasons use safe codes, not matched slurs. Owner-only `/me` and PATCH profile responses additionally include optional `pending_avatar_id: ID|null`, derived from the current uploading/pending reservation, so a lost upload response can be recovered or cancelled after relaunch. This field is never included in ranked entries, share profiles or other public projections (approved prelaunch contract amendment).
- `Preferences`: `{weekly: off|all|podium, monthly: off|all|podium, home_timezone: IANA string, locale: supported BCP47 string}`. Daily reminders are local and not sent here.
- `RankedEntry`: `{participant_id, nickname, avatar_id, folds: nonnegative integer, rank: positive integer, percentile: integer 0..100|null, medal: gold|silver|bronze|null}`. No email/Apple subject. Hidden/removed entries are omitted without renumbering remaining ranks.
- `Result`: `{period_id, kind: week|month, start_ms, end_ms, version: positive integer, finalized_at_ms, folds, rank, population, percentile, medal}`. Finalized self-history only; provisional status belongs to live periods.
- `Enrollment`: `{epoch_id, device_id, generation: Generation, joined_at_ms, issued_at_ms}`. ID ownership and times are server-derived. A transfer creates a different epoch without resetting accepted history.
- `OperationStatus`: `{operation_id, state: pending|completed|failed, error_code: string|null}`. `failed` requires a retry instruction represented by the error contract; visibility changes are immediate on accepted leave/delete even while cleanup is pending.

Event `timezone_id` accepts supported IANA identifiers and canonical Foundation fixed-offset identifiers `GMT±HHMM` (maximum ±1800, minutes 00–59). Zero offset is `GMT`; `GMT+0000`, `GMT-0000`, and noncanonical aliases such as `GMT+1` or `GMT+01:00` are rejected. Shared `contracts/fixtures/timezones.json` records actual Foundation behavior and the wire policy.

All successes return `request_id` in JSON or `X-Request-ID` for binary responses. All errors use [error.schema.json](../../contracts/schemas/error.schema.json). Request sizes/string bounds in backend-and-security.md also apply. Server never trusts participant ownership, timestamps, roles, or totals merely because they fit a schema.

## Release capabilities

- `GET /v1/capabilities`: unauthenticated, read-only → `{contract_version:1, worker_version:string, capabilities:string[], request_id:ID}`. `worker_version` is the exact deployed `WORKER_VERSION` binding. `VERIFIED_CAPABILITIES` is a deployment-owner-managed JSON allowlist of implemented capabilities whose final acceptance has passed; missing allowlist returns an empty array. Unknown/unimplemented capability names fail configuration instead of being advertised. This handshake never disables private tracking.
- Names: `auth.apple`, `auth.refresh`, `auth.reauthenticate`, `attest.enroll`, `enrollment.join`, `enrollment.transfer`, `enrollment.leave`, `events.submit`, `events.receipt`, `account.delete`, `account.deletion_status`, `account.deletion_recovery`, `history.reset`, `leaderboard.live`, `results.finalized`, `results.share`. Additional launch features reserve `avatars.upload`, `avatars.moderation`, `profiles.edit`, `moderation.reports`, `moderation.blocks`, `notifications.results`; they cannot be enabled until implemented and accepted. Release preflight fails while any required capability is missing.

## Authentication

For Sign in with Apple, the returned challenge `nonce` is canonical base64url (no padding), encoding 32 random bytes. The client explicitly sets `ASAuthorizationAppleIDRequest.nonce` to the lowercase hexadecimal SHA-256 of the **UTF-8 nonce string** (not the decoded bytes). The server compares the signed identity-token nonce to that exact digest. Apple passes the request nonce to the identity provider; do not assume Apple hashes it. See `contracts/fixtures/apple-nonce.json`. App Attest uses its separately defined challenge/request binding and must not reuse this sign-in transformation.

- `POST /v1/auth/challenges`: `{purpose:"sign_in"|"reauthenticate"|"recover_deletion"}` → `{challenge_id, nonce, expires_at_ms}`. No session.
- `POST /v1/auth/apple`: `{operation_id, purpose:sign_in|reauthenticate|recover_deletion, challenge_id, identity_token, authorization_code, device_id, deletion_operation_id:null|ID}`. Purpose must match the server challenge. Sign-in success → `{access_token, expires_at_ms, refresh_token, profile}`; reauthenticate success for the existing session subject → `{reauthentication_token, expires_at_ms}` (one-use, 5 minutes); recover_deletion success → the deletion receipt below after same-subject verification. Recovery does not create membership or reopen a deleted profile. Validate nonce/state linkage as specified in security; client state is verified on-device before this request. Cap token/code strings at 16 KiB each.
- Sign-in response-loss recovery: the same operation and normalized business body can recover its encrypted original token pair for 60 seconds after commit, after verifying the same Apple subject and nonce. Token/code strings are excluded from the business hash. Recovery never creates a second session and does not exchange an already-used code again. Recheck current account state, restriction, session revocation, participant revision, device/deployment, and that the returned refresh token has not already rotated. A spent challenge may pass its original issuance expiry during this recovery window; an unused expired challenge cannot establish a session. After expiry, fresh native authorization with a new operation ID is required. Keep a non-secret operation tombstone after encrypted receipt cleanup. Exact expiry checks enforce the window; a scheduled retention pass physically purges expired ciphertext.
- `POST /v1/auth/refresh`: `{operation_id, refresh_token}` → new access/refresh pair and expiry. A committed retry of the *same* refresh operation may retrieve the previously issued pair for a 60-second response-loss window via encrypted receipt storage; other reuse revokes the family. After that window reauthenticate rather than keep old tokens recoverable indefinitely. Recovery never returns a token that has already rotated again; it requires fresh authorization in that case without revoking a still-valid newer session merely for the stale recovery request.
- `POST /v1/auth/logout`: `{operation_id}` → `{operation_id, state:"completed"}`; revoke the current session family and its push token binding. It does not leave competition or delete scores.
- `POST /v1/attestation/challenges`: `{purpose: enroll_key|join|transfer|submit_events|reset|avatar_upload, device_id, key_id: string}` → `{challenge_id, nonce, expires_at_ms}`. Session required. Generate the App Attest key first and supply its canonical standard-base64 key ID; null/unbound key challenges are rejected.
- Enrollment passes `SHA256(base64url_decode(challenge.nonce))` as `DCAppAttestService.attestKey`'s `clientDataHash`; the decoded nonce is exactly 32 bytes. This differs from the explicitly hashed UTF-8 native Sign in with Apple nonce. Assertions continue using the exact `Folding-v1` request binding in the security contract.
- `POST /v1/attestation/keys`: `{operation_id, device_id, key_id, challenge_id, attestation_base64}` → `{key_id, enrolled:true}`. Attestation bytes <=64 KiB decoded. Key ownership bound to the session participant/device.

Protected requests include `Authorization: Bearer …`, `X-Folding-Key-ID`, `X-Folding-Challenge-ID`, and `X-Folding-Assertion` (base64url encoded, maximum 16 KiB decoded). Header assertion is not part of the body digest. Only enrollment uses the attestation object instead of an assertion. Avatar-upload challenges bind exact raw body bytes and request path, with operation ID in the path.

## Enrollment and data lifecycle

- `GET /v1/me`: → `{profile, enrollment: Enrollment|null, preferences, pending_operations: OperationStatus[]}`. Return only operations for this participant.
- `POST /v1/enrollment/join`: `{operation_id, device_id, generation, nickname}` → `{profile, enrollment}`. Current active membership returns its existing enrollment if same device; another device requires explicit transfer. A completed leave followed by join issues a fresh epoch.
- `POST /v1/enrollment/transfer`: `{operation_id, from_epoch_id, device_id, generation}` → `{enrollment}`. Requires current membership and assertion from the new installation. CAS on the prior epoch prevents simultaneous transfer ambiguity.
- `POST /v1/enrollment/leave`: `{operation_id}` → `202 OperationStatus`. Fence all epochs immediately; remove public visibility then purge. Available without App Attest.
- `POST /v1/account/delete`: `{operation_id, reauthentication_token}` → `202 DeletionReceipt`, where `DeletionReceipt` is `{status:OperationStatus, polling_token, polling_token_expires_at_ms}`. The reauthentication token is a one-use, 5-minute server-issued proof from the discriminated `/auth/apple` exchange for the same subject, not an arbitrary identity token. Private reset is a separate local command.
- `GET /v1/operations/{operation_id}` → `OperationStatus`. For deletion, authorize with `Authorization: Deletion <polling_token>` instead of a bearer session; it is narrowly scoped to that operation and expires in 15 minutes. Issue it before revoking session access and store its hash. It reveals status only. If lost/expired, use `/auth/apple` with purpose `recover_deletion` and the same deletion operation ID; verify the original Apple subject and return a fresh DeletionReceipt without recreating the account. Keep the minimal keyed subject/operation mapping for 30 days after cleanup completion so lost responses can be recovered, then purge it except an independent active-ban record. Recovering status never returns removed profile fields.
- `POST /v1/resets`: [reset-request.schema.json](../../contracts/schemas/reset-request.schema.json) → `{operation_id, generation, state:"acknowledged"|"superseded"}`. Greater valid marker wins; stale marker returns current winner and no score mutation. Receipts remain idempotent; do not let duplicate old receipts override the current generation returned by `/me`.

## Events and scores

- `POST /v1/event-batches`: [event-batch.schema.json](../../contracts/schemas/event-batch.schema.json) → [event-receipt.schema.json](../../contracts/schemas/event-receipt.schema.json), HTTP 200 after durable commit. `received_at_ms` comes from the server. Every submitted event has exactly one receipt entry in input order. A duplicate request returns its stored receipt; it does not update the receipt timestamp or retry the physical observation.
- `GET /v1/event-batches/{operation_id}` → same receipt; authenticated owner only. Unknown returns 404; don't expose other participants' IDs.
- `GET /v1/leaderboards?kind=week|month|all&cursor=…&limit=…`: → `{period:{id,kind,start_ms:null|Instant,end_ms:null|Instant,state:open|grace|finalized}, page:Page<RankedEntry>, you:RankedEntry|null, population}`. Default is current week; historical finalized boards can additionally specify `period_id`. Kind all has null bounds. A changed live snapshot can return 409 snapshot_changed; client restarts pagination without mixing pages.
- `GET /v1/results?kind=week|month&cursor=…&limit=…`: → `Page<Result>` for the caller, descending end_ms.
- `GET /v1/results/{period_id}/share`: → `{result:Result, profile:{nickname,avatar_id}}` for caller's current visible finalized entry. Never return another person's private self-history. UI can compose a live share preview from the current board's `you` plus date/time; it must not label it finalized.

## Profile, content, and push

- `PATCH /v1/profile`: `{operation_id, nickname}` → `{profile}`; safe validation errors 422. Operation ID idempotency applies to PATCH too.
- `PUT /v1/avatars/{operation_id}`: JPEG/PNG bytes, `Content-Type` required, bounded by avatar limits → `{avatar_id, state:"pending"}`. Signed digest covers bytes; duplicate operation compares body digest. Reject redirects/remote URL inputs. Input stream must be bounded before decode. User can have only one pending avatar; newer accepted upload supersedes/purges the older pending one.
- `GET /v1/avatars/{avatar_id}/status`: owner only → `{state:pending|approved|rejected, reason_code:null|string}`.
- `DELETE /v1/avatars/{avatar_id}?operation_id=…`: session owner; no assertion required for removal → `{operation_id,state:"completed"}`. This unsigned privacy mutation uses normal session/idempotency checks.
- `GET /v1/avatars/{avatar_id}/image`: authorized visible approved derivative, `image/jpeg`, or 404. Owner's pending preview remains local; don't expose original uploads through this endpoint.
- `POST /v1/reports`: `{operation_id, subject_participant_id, content_id:null|ID, reason: abusive_name|abusive_avatar|suspected_cheating|other, comment:null|string}` → `{report_id,state:"received"}`.
- `PUT /v1/blocks/{participant_id}` and `DELETE /v1/blocks/{participant_id}`: `{operation_id}` → `{operation_id,blocked:boolean}`. Cannot block self; hide is presentation-only. List blocked IDs through `GET /v1/blocks` → `Page<{participant_id}>`.
- `PUT /v1/preferences`: `{operation_id, preferences:Preferences}` → `{preferences}`. Validate IANA zone and supported locale server-side.
- `PUT /v1/push-installations/{device_id}`: `{operation_id, token_hex, environment: sandbox|production}` → `{registered:true}`. Derive permitted environment/topic from authenticated deployment configuration, not this claimed value. Token string must decode correctly and remain bounded; don't assume a fixed future token length.
- `DELETE /v1/push-installations/{device_id}`: `{operation_id}` → `{registered:false}`. Current participant/device only.

## Admin forms

Admin uses HTML responses rather than these mobile JSON contracts. GET routes `/admin/participants`, `/admin/participants/{id}`, `/admin/queue`, `/admin/periods/{id}`, `/admin/audit`. Paginated filters are bounded allowlisted values. Mutation POST routes `/admin/moderation`, `/admin/avatars/{id}/decision`, `/admin/names/{id}/decision`, `/admin/reports/{id}/decision`, `/admin/periods/{id}/corrections`, `/admin/config`.

Every POST has `operation_id`, `csrf_token`, `reason` (10–500 graphemes), `expected_revision`, and an allowlisted action. Participant actions: quarantine_submission/reinstate_submission/suspend/ban/unban; suspension requires `until_ms`. Content actions: approve/reject/remove. Report decisions use close/reopen with the report revision (and subject participant ID); both decisions are audited and closing starts the 90-day case-evidence retention clock. Period correction posts a previously generated preview ID/hash bound to the admin, expected result version, and 10-minute expiry. A changed result version invalidates preview; never “apply whatever is current.” Config edits accept only the operational switches in release-and-operations.md. Success uses POST/Redirect/GET; stale revisions display a reload/review message without repeating the mutation.

Admin management amendments (prelaunch): `GET /admin/periods` lists periods; `GET /admin/jobs` lists failed dispatch/award work and `POST /admin/jobs/{id}/retry` retries the same logical record with Access, CSRF, explicit confirmation, reason, expected failed-state attempt count and audit. No retry bypasses consent/privacy or recreates a logical award. Existing `/admin/moderation` additionally accepts `review_ban` (records upheld result and next annual review, without lifting restriction) and `close_case` (starts the 90-day evidence retention window), both participant-revision fenced and audited. Appeals remain the public support/appeal route; administrative case reasons record their outcome. Destructive moderation choices require explicit confirmation.

`GET /v1/health` is a public, read-only operational probe: `200 {status:"ok",worker_version:string}` after a fixed indexed D1 administrative-configuration singleton query; `503 {status:"unavailable"}` on missing/invalid version configuration, DB failure, missing row or a two-second readiness timeout. Always `Cache-Control: no-store`; never return user records/counts, credential state or error details. This probe does not claim feature acceptance and is independent of `/v1/capabilities`.

## Incomplete-entry contribution removal

`POST /v1/entry-deletions` accepts the typed
[request](../../contracts/schemas/entry-deletion-request.schema.json):
`operation_id`, 1–2 distinct `event_ids`, and 1–2 distinct `epoch_ids`. An
authenticated session is required; App Attest is not required to remove one's
own data. Every supplied epoch must belong to that participant. Tombstones are
participant-scoped, so arbitrary IDs cannot affect another participant. No score
is accepted from the client.

The [receipt](../../contracts/schemas/entry-deletion-receipt.schema.json) reports
completed state and request ID. Normalized retries are idempotent; changed bodies
under the same operation return conflict. Wrong-account epochs return 403
`wrong_account`. Per-participant authentication/mutation rate limits apply.

The atomic, session/revision-fenced mutation persists tombstones, replays accepted
causal observations with contributions suppressed, and refreshes current
week/month/all-time scores. Late uploads also honor the tombstones. A decision
clock guards in-flight finalization; affected staged results are invalidated.
Published historical result versions retain the formal correction workflow.
Migration 0018 creates the indexed participant-owned tombstone table; account
erasure removes it.
