# Storage, event accounting, and private synchronization

## Types and interface

The JSON [event schema](../../contracts/schemas/event.schema.json) is the persisted immutable event envelope. Swift uses Codable structs with explicit CodingKeys and integer millisecond timestamps; Rust uses Serde structs with matching names. Reject out-of-range integers and unknown event kinds. Never use floating-point seconds in contracts.

`TrackingStore` is a concrete FoldingData module interface. Its operations are `record(observation) -> receipt`, `summary(query) -> snapshot`, `sessions(query) -> page`, `beginSetupTest(expected) -> attempt`, `reset() -> resetStatus`, and `export(format) -> file`. Exact Swift names may vary; semantics may not. Domain inputs/outputs are immutable Sendable values. Managed objects and SQLite handles never escape the module. IO runs off the main actor; view state updates return to the main actor.

A receipt contains event ID, data generation, source sequence, whether this call was a retry, and whether it consumed a test lease. Return success only after the journal commit. A retry with the same operation/event ID and same content returns the original receipt; same ID with different immutable content returns `identity_conflict`. A fresh Shortcut invocation is a fresh observation, not automatically a retry merely because its state matches. Platform execution does not promise a durable invocation ID: generate it once at our entry point and preserve it across our own retries; distinct system re-invocations are handled by repeated-state rules.

## Canonical local schema

Implement SQL migrations with `PRAGMA user_version`, never manual file edits. UUIDs are lowercase canonical strings. A private account namespace is separate from a reset generation. Within every isolated namespace, initial generation is exactly `{revision:0, reset_id:"00000000-0000-0000-0000-000000000000"}`; only explicit reset markers at revision >=1 erase history. Two new installations in the same iCloud account therefore start in the same generation. Never compare reset markers across account namespaces. SQL integer fields are checked against the contract's nonnegative safe-integer range.

- `source_state(device_id PRIMARY KEY, next_sequence, active_generation_revision, active_generation_id)`. Sequence increases for the installation lifetime, including test events; reset does not restart it. Restoring/reinstalling on a different installation creates a new device ID and requires competition transfer.
- `events(event_id PRIMARY KEY, device_id, sequence, generation_revision, generation_id, observed_at_ms, timezone_id, transition, is_test, competition_epoch_id NULL, payload_json, payload_hash)`, UNIQUE(device_id, sequence). Payload hash is of normalized schema fields; identity comparison also checks parsed values. Never hash arbitrary JSON pretty-print output.
- `reset_markers(reset_id PRIMARY KEY, revision, created_at_ms)`; ordering is `(revision, reset_id)` with lowercase ASCII lexical UUID ordering. Logical revision must be one above the highest known revision. Wall time is for diagnostics only.
- `sessions` and `daily_summaries`: derived caches with reducer version/generation/timezone keys. Rebuildable from retained events; not separately synced to iCloud.
- `work_outbox(work_id PRIMARY KEY, kind, entity_id, generation_id, state, attempt_count, next_attempt_ms, lease_until_ms)`, UNIQUE(kind, entity_id). Kinds: `mirror_event`, `mirror_reset`, `mirror_interruption`, `mirror_transfer`, `competition_event`, `competition_reset`. Insert each interruption/transfer marker and its corresponding mirror work in the same journal transaction. Transfer markers and their mirror work survive event-generation reset cleanup because the selected-device policy persists. Replication and competition acknowledgments are distinct.
- `setup_attempt(attempt_id PRIMARY KEY, device_id, generation_id, expected_transition, baseline_sequence, expires_at_ms, consumed_event_id NULL, status)`. At most one waiting attempt per device; replacing an attempt cancels the prior one.
- `interruptions(interruption_id PRIMARY KEY, device_id, generation_id, after_sequence, reason, observed_at_ms)` is immutable. Reason is `device_restart`, `tracking_interruption`, or `transfer_away`. Apply a marker after all events through `after_sequence`, before the next greater sequence. Several markers at one position have the same idempotent session-invalidation effect, preserving the last observed transition.
- `transfer_markers(transfer_id PRIMARY KEY, revision, active_device_id, source_watermarks_json, created_at_ms)` is immutable; private transfer ordering and inclusion are defined below.
- `settings(key PRIMARY KEY, value_json)`, `sync_checkpoints`, and `notification_claims` are local control records. Never put refresh tokens, Apple identity tokens, or App Attest private material here.

Use `journal_mode=WAL`, `foreign_keys=ON`, `synchronous=FULL`, and a 1000ms SQLite busy timeout as initial defaults. Retry a busy transaction at most twice with jitter if the caller's remaining execution budget allows; otherwise return a retryable error. Never acknowledge an unwritten fold. Use prepared statements, not SQL string interpolation. Use SQLite backup facilities for a consistent diagnostic snapshot; never copy only the main database file while WAL is active.

Choose file protection compatible with access after first unlock (`completeUntilFirstUserAuthentication`) for the journal and associated files, and verify it on a locked Duo. Before first unlock, report protected-data unavailability; do not weaken protection or claim background tracking succeeded. Platform observation gaps are visible as incomplete tracking when detectable.

## Recording transaction

No network request or long-running task inside this transaction:

1. Open `BEGIN IMMEDIATE`; read current winning generation and source state.
2. Look up supplied retry ID. Return the original receipt on matching content; conflict otherwise.
3. Allocate the next source sequence and increment source state in this same transaction.
4. Check the live setup attempt. A matching transition after its baseline, same device/generation, before expiration consumes it once and marks the event `is_test=true`. An opposite transition is ordinary tracking and does not consume the lease. Expired leases cannot suppress events.
5. Insert the event and mirror work. Insert competition work only if this is a real event captured while locally joined under a server-issued competition epoch; never add it retroactively after joining.
6. Apply deterministic reduction and update affected summaries/session caches; update threshold claim eligibility atomically. For expensive history rebuilds, commit an invalidation marker instead and return a consistent snapshot version while background work rebuilds.
7. Commit; then request widget refresh, attempt uploads, and fulfill local notification work outside the transaction.

No lock or actor in only one process replaces step 1. An import uses the same transaction discipline but preserves original ID/sequence and never allocates a sequence or creates competition work on behalf of another device.

## Reducer v1

Process each `(device_id, generation_id)` independently in source-sequence order, never network-arrival order. Reject conflicting IDs/sequences. Ignore exact retries and test events entirely for tracking state. A known tracking interruption (including mirrored interruption records during replay) marks any spanning session incomplete and clears its duration/cycle candidate, but preserves the last observed open/closed state for fold deduplication. It does not manufacture another fold merely because tracking restarted. Ordinary app launch does not reset state.

- `unknown + open`: add one open/fold; start normal session.
- `unknown + close`: add one close/fold; no duration/cycle.
- `open + close`: add one close/fold; close current session if one exists. Normal session gives one cycle. Candidate session created by repeated open gives duration but no cycle. After an interruption with no active session, this close gives no duration/cycle.
- `closed + open`: add one open/fold; start normal session.
- `open + open` with a distinct ID: add zero; mark the previous session incomplete only if it is still active, then start a candidate session at the new observation. Do not count the same interrupted session as incomplete twice.
- `closed + close` with a distinct ID: add zero; remain closed.

Sequence gaps alone do not prove missed physical events (test and unsubmitted private events also occupy sequence numbers). Preserve uncertainty if the source explicitly reports a detected interruption. A late event causes replay of its affected device/generation from a checkpoint before its sequence; never apply a negative ad hoc “counter correction” without replay. Cross-device totals sum each device's reducer output, not a stitched session spanning phones.

If close time precedes open time, count the valid state transition but mark duration/cycle incomplete; do not clamp negative duration to a convincing zero. Equal timestamps can yield zero duration and a cycle if the source sequence establishes an otherwise complete pair. Split complete durations at home-timezone calendar midnight, using Calendar/TimeZone rather than adding 86,400 seconds. Running duration is an estimate until close; don't include it in finalized session exports.

Known invalidation (restart, account partition change, transfer away) uses a durable control marker keyed to source sequence. Reset starts unknown state in the new generation. Mirror these records and replay them on every device. Only physical transitions are submitted to public competition in v1: interruptions preserve transition state, so they do not change fold totals versus the same physical observation stream. Personal session/cycle results need interruption records; public rankings expose no duration/cycle claim. Eligibility/quarantine/cutoff can still cause expected personal/public differences. A network sequence discontinuity does not itself become a new fold.

## Private iCloud mirror

Use a separate Core Data store managed only by NSPersistentCloudKitContainer, with CloudKit-compatible optional/defaulted attributes. Entities: `ReplicatedEvent`, `ResetMarker`, `TransferMarker`, and `TrackingInterruption`; logical IDs are attributes, not CloudKit uniqueness constraints. Events are immutable after creation. Do not synchronize authentication, public avatars, notification claims, outbox leases, or derived summaries.

The app's sync coordinator writes pending mirror work, processes persistent history, and imports remote records into the journal. A committed local mirror save marks work `mirrored_locally`, not `uploaded_to_iCloud`. Container export/import events can update UI health but do not certify every other device has seen a reset. Show pending reset until local mirror export and, if joined, backend reset acknowledgment; never claim global instantaneous deletion.

Crash between mirror save and journal acknowledgment can produce another mirror row. Import deduplicates by logical ID/content. Conflicting immutable payloads are quarantined locally and excluded from derived state until diagnosed; never last-write-wins a fold's contents. Checkpoint advances only after the matching journal import commits. Remote imports do not feed endless mirror re-exports.

A reset marker survives event cleanup. Import markers before events from the same available history batch, select the maximum known marker, and reject/delete all older-generation events/outbox work. Importing a greater marker removes losing pending-generation events as specified in the product spec. Remove mirrored old event records opportunistically after the reset is durable; delayed old records still cannot restore counts. Retain reset tombstones for the lifetime of this private history namespace.

Keep iCloud account partitions separate. On sign-out/account-change notification, pause mirror work, close the old mirror, and retain old private data in its inaccessible partition. Open a fresh local-only/new-account partition; never upload one account's records into another account. Provide deliberate export/access guidance for the prior partition only when that account is reauthenticated. Device source identity and competition transfer must be re-evaluated; do not silently inherit another partition's active grant.

## Reset, transfer, and upload state machines

Reset: `idle -> local_committed -> mirror_pending/backend_pending -> acknowledged`. These remote substates are independent. Retrying uses the same reset ID. A greater concurrent marker transitions to `superseded`, deletes losing-generation work, and adopts the winner; no relabeling. Cancellation after local commit does not undo reset.

Transfer: `current -> requested -> server_confirmed -> mirrored`. Public transfer requires online authentication/attestation and a new server-issued epoch. Private transfer is an immutable logical revision/UUID marker; greatest `(revision, transfer_id)` wins, independent of wall clocks. It carries `active_device_id` and a source-watermark map: the highest sequence known locally for every inactive source when the transfer commits. Existing inactive watermarks are preserved/advanced only from history known at that transfer; missing source IDs imply watermark zero. A winning marker includes all events of the active device and events of each other source only through its captured watermark. This deliberately excludes old-device observations not yet known at transfer, even if they were physically recorded earlier; device detail/export retains them. A later transfer back can include that device's preserved observations as active history; competition follows its separate epoch rules. Before any explicit private transfer, all sources are visible and no device is silently elected by a UUID race. Detect multiple sources and show the tracking-phone selection row. Reset keeps the selected transfer policy but clears generation history. Test concurrent transfers by applying the same maximum marker and watermark map on every device. The transfer confirmation explains the excluded pending history concisely. Public eligibility follows server receipt/epoch rules in the backend spec, not a client clock claim.

Uploads: `pending -> leased -> acknowledged | quarantined | permanently_rejected | retry_wait`. Lease defaults to 60 seconds; expired leases are retryable. After timeout or lost response, retain the same submission ID/body. On `generation_stale` discard that obsolete public work; on `epoch_stale` stop uploads and reconcile current enrollment, never rewrite old events into a new epoch. `401` refreshes once then requires sign-in; `403 banned` stops public work; `429` respects Retry-After; network/5xx retry with exponential jitter capped at 1 hour. App activation retries due work. Queuing is durable; background execution is best effort.

Daily notification deduplication uses a claim with `not_before_ms` equal to the next midnight in the timezone at claim time. A timezone/threshold change cannot reopen the claim before that instant; afterwards compute the next day in the new zone. This intentionally avoids a second same-travel-day alert. Claim ID is stable for notification retries; reset keeps the current claim to prevent a fresh alert for the same day.

## Required evidence

- Two separate processes recording simultaneously produce distinct sequence numbers and one receipt per event; killing either before commit produces no partial event/outbox.
- Reopening after commit but before mirror/upload acknowledgment yields identical counts and safe retries.
- All [reducer fixtures](../../contracts/fixtures/reducer.json) pass in Swift and Rust, including shuffled arrival.
- Repeated open creates uncertainty and no extra fold; setup lease survives app switching, expires safely, and consumes only one matching event.
- Duplicate mirror rows, replayed persistent history, concurrent resets, account switching, and stale old-device writes cannot resurrect cleared data.
- No real-device claim until lock/restart/Shortcuts experiments are recorded under the work order.

Sources: [SQLite transactions](https://sqlite.org/lang_transaction.html), [WAL](https://sqlite.org/wal.html), [Apple CloudKit model restrictions](https://developer.apple.com/documentation/coredata/creating-a-core-data-model-for-cloudkit). The schema and algorithms above are project decisions, not platform guarantees.

## Export contract

Produce a consistent SQLite read-transaction snapshot of the current namespace/generation, including event IDs and the reducer/timezone version used. Do not hold a write transaction while formatting files. If reset occurs during export, cancel that export before sharing and remove its temporary file; never present an old snapshot as the newly reset history.

JSON v1 top-level fields: `schema_version:1`, `exported_at_ms`, `generation`, `home_timezone`, `reducer_version:1`, `travel_formula:{version:1,degrees_per_fold:180,radius_metres:0.1}`, `events`, `interruptions`, `transfer_markers`, `sessions`, and `daily_summaries`. Raw events retain test/pending/excluded-source flags and a derived `included_in_summary` boolean for explanation; they never include auth tokens or internal moderation evidence. Sessions contain `start_ms`, nullable `end_ms`, `complete_duration_ms` (null when incomplete/running), `completeness:complete|candidate|incomplete|running`, and source device. Daily summaries exclude test/excluded-source events and unfinalized duration.

CSV export is a ZIP containing `events.csv`, `sessions.csv`, `daily-summaries.csv`, and `README.txt` with formula/version/timezone. Event columns: event_id, device_id, sequence, generation_revision, generation_id, observed_at_ms, timezone_id, transition, is_test, included_in_summary, public_upload_state. Session columns: device_id, start_ms, end_ms, complete_duration_ms, completeness. Summary columns: date, timezone_id, folds, opens, closes, cycles, complete_duration_ms, equivalent_degrees, equivalent_metres. Use UTF-8, RFC4180 quoting, dot decimal separator, and blank nullable values. Escape spreadsheet formula-leading strings in CSV and document that transformation; JSON preserves raw values.

Write protected temporary files within the app sandbox, share through the native sheet, and delete on completion/cancellation. On next launch remove abandoned files older than 24 hours; also purge on private reset/account change. Do not sync exports or upload them to a server.

## Implemented conflict handling detail

Private import batches checkpoint only after their journal transaction commits. Future-generation event/interruption records are deferred durably until a reset marker authorizes that generation. Conflicting event/interruption content is quarantined; local versions and derived uncertainty barriers remain eligible for private replication so devices can converge on exclusion.

A conflicting reset ID cannot safely undo a tombstone already applied on another device. Preserve that tombstone, reject further versions of the conflicting ID, quarantine the payloads, and continue unrelated valid history. Never rewrite the reset marker by last-write-wins. Minimal rejected-ID tombstones survive history cleanup. Surface the conflict as impaired private sync until resolved; do not call the account converged merely because a batch checkpoint advanced.
