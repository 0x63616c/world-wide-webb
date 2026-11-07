# Agent work orders and handoff rules


## Owner-approved execution update — November 7, 2026

The owner has authorized implementation through submission/publication and reports Apple account agreements/tax/banking requirements complete. Verify actual App Store Connect state when used; do not request these again unless a concrete account prompt contradicts that report.

Physical-device testing is explicitly deferred until **after App Store submission**. Any earlier wording requiring a real-device pass before feature work/submission is superseded by this scheduling exception. Keep these checks marked **deferred**, never passed; continue simulator, domain, backend, security, UI, and release checks before submission. Do not bypass App Attest or fabricate device evidence to satisfy this schedule. Missing device-only evidence is recorded in the release manifest as an owner-approved deferral, not a successful check. Automatic release after approval remains enabled; approval may occur before device testing is complete.

Immediately after verified submission, run the deferred Duo tests with the owner and fix/resubmit if needed. The full shipping goal remains incomplete until required deferred tests and resulting fixes are resolved. Known functional/security failures are still fixed promptly; this exception defers hardware evidence, not already-known defects.

These are implementation instructions, not completed work. One execution agent owns all implementation. No execution subagents; independent agents may review completed work only. Each order starts with the [technical index](README.md). Shared contracts, target/crate manifests, migrations, and integration decisions have the same execution owner.

## Execution order and batching

Follow the [delivery plan's three validation checkpoints](../delivery-plan.md#delivery-rules): foundation proof, substantial feature batches, then integrated release validation. F00–F03 establish accounts, contracts, and the real tracking/upload route. Complete this foundation proof before dependent feature work.

Then implement substantial batches sequentially:

- **Personal tracker:** F04–F06 — tracking/history/sync/export/reset, native setup/screens, widgets, and daily reminders.
- **Competition and operations:** F07–F09 — competition, account lifecycle, admin/moderation, and result notifications.
- **Polish and release assets:** F10 — localization, tips, branding, listing, and screenshot coverage; release automation already exists from F00.
- **Full integration and release:** F11–F12 — TestFlight, independent UI/security review, recovery/release rehearsal, submission and publication verification.

Work orders define ownership, requirements, and acceptance evidence, not mandatory pauses. Build continuously within a batch and validate the whole behavior at its end. Run cheap checks in the background; reserve expensive suites/device checks for these points or a specific newly introduced risk. Do not rerun unchanged passing checks without cause. Technical dependencies and known failures still gate dependent work.

## Required completion record

At each batch checkpoint, record changed files, contract version, caller-visible behavior, checks/outcomes, evidence links, known failure states, and downstream effects against its work orders. Implementation can be marked awaiting validation; acceptance boxes remain unchecked until evidence passes. Reuse valid evidence across tasks rather than rerunning the same check for every checkbox.

Include negative/retry coverage where behavior touches persistence, auth, payments, or external writes. Stop only dependent work if a platform gate fails; continue unrelated authorized work. Fix known security/data-integrity failures promptly. Routine progress updates do not require user confirmation.

No task may solve a failure by weakening verification, changing counting semantics, dropping a launch language, leaking internal data to UI, fabricating hardware evidence, or silently adding an external vendor. Use deterministic fixtures for local development; real integration and physical-device gates remain required. Independent reviewers report findings; the execution agent implements their fixes.

## F00 — Account and build foundation

**Owns:** `.github/workflows/`, `.githooks/`, `scripts/`, `fastlane/`, `infra/`, root tool pins; account configuration references. Coordinator resolves any overlap with release work.

**Read:** release-and-operations.md; delivery M0/M1.

**Deliver:** pinned toolchains/lockfiles, reproducible bootstrap/format/check commands, explicit hooks, private signing setup, separate environments, correct bundle identifiers, App Store record, a build lane, one CI screenshot artifact. Configure infrastructure only with scoped account access and confirmed cost requirements.

**Evidence:** clean-checkout bootstrap, staged-only hook behavior with partial staging, fork PR has no secrets, selected Xcode runtime exists, signed device install, screenshot capture manifest, configured name in App Store Connect. GitHub green alone is not proof of signing/hardware.

**Reject:** installing latest unpinned tools at each run; writing `.p8` files to source; inventing SDK availability; privileged PR jobs; hidden manual setup.

## F01 — Contract freeze and domain fixtures

**Owns:** `contracts/`, GLOSSARY.md, technical contract changes. The execution agent keeps both language contracts synchronized.

**Read:** storage-and-tracking.md, backend-and-security.md, http-contracts.md.

**Deliver:** typed Swift/Rust value DTOs using explicit serialized names; schemas for every operation in the HTTP catalog before that route is implemented; fixed wire errors and semantic validators; expanded fixture corpus. Freeze contract version 1 after review. Private code names may differ; wire meaning may not.

**Evidence:** all valid JSON examples validate; malformed/unknown fields, unsafe integers, repeated IDs with differing content, mismatched epochs, unknown enums, and invalid timezone names fail as specified. Tests cover lower-percentile ties, negative duration, midnight/DST, reset ties, out-of-order arrival, and cutoff exclusivity. The coordinator checks client/server parity through fixture results.

**Reject:** deriving fixtures from one implementation's current output; choosing different date formats per language; client-generated totals as input; one ID reused for private generation and competition epoch.

## F02 — Durable journal, private sync, and device experiment

**Owns:** FoldingData persistence/sync/intent integration, source-sequence logic, device experiment record. Domain interfaces from F01 are coordinated, not changed unilaterally.

**Read:** storage-and-tracking.md and ADR 0002; exact setup lease from ui.md.

**Deliver:** transactional recording, outbox, mirror adapter, durable setup receipt, reset/import convergence; the first physical fold through Shortcuts. Save evidence to `docs/experiments/tracking-and-sync.md` with OS/device/build, exact steps, observations, limitations, and pass/fail for every tested context.

**Evidence:** two-process write race, kill before/after commit, read while write, key/file protection while locked and before first unlock, same-ID retry, conflicting-ID rejection, mirror duplication/crash replay, expired test lease, CloudKit account change, concurrent offline reset. Confirm actual Shortcut labels/handoff and partial folds, terminated/background operation, and restart.

**Reject:** UserDefaults counters; actor-only cross-process locking; assuming CloudKit uniqueness; network calls inside write transactions; marking setup complete from device pose.

**Gate:** if exact background triggers/upload contexts differ from expectations, record the smallest viable adjustment. Do not assert that passing a fixture proves physical tracking. Dependent tracking promises wait for evidence.

## F03 — Rust runtime, security, and D1 transaction experiment

**Owns:** initial backend crates, auth operations, transactional mutation helper, staging integration harness. No per-feature crates.

**Read:** backend-and-security.md, http-contracts.md, release runtime gates.

**Deliver:** real staging path from an enrolled device to a durable event receipt; verified Apple identity/App Attest challenge/assertion flow; D1 guarded batches; bounded JPEG/PNG decoding; APNs connectivity experiment. Record crypto libraries/versions and supported target in `docs/experiments/backend-runtime.md`.

**Evidence:** official valid/invalid attestation test vectors where available, wrong app/environment/audience, body tampering, challenge replay/expiry, counter replay, lost-response retry, concurrent CAS updates, forced mid-batch failure, image decompression limits, APNs HTTP/2 request and response handling. Assert no partial event/score/job survives rollback.

**Reject:** a JWT decode treated as signature validation; App Attest treated as physical proof; a zero-row update treated as a successful guard; `BEGIN` on one binding call and `COMMIT` on another; leaking secrets in diagnostics; adding a Node backend to bypass Rust limitations.

**Gate:** runtime incompatibility gets a documented tested alternative, not an assumed library feature. Until APNs route is proven, in-app results can progress but push cannot be marked complete.

## F04 — Personal domain, history, reset, and export

**Owns:** FoldingDomain and FoldingData query/rebuild/export code; immutable read models. Coordinate target manifest edits.

**Deliver:** complete reducer v1; bins/session queries; timezones/DST; active-device selection; local/iCloud reset; CSV/JSON export and migrations. Export JSON includes schema/reducer version, source event data, completeness, timezone, and travel formula; CSV columns are documented. Neutralize spreadsheet formula-leading strings in CSV while preserving raw values in JSON. Write temporary exports with protected file access and delete them after share completion or on next launch if older than 24h.

**Evidence:** shared reducer fixtures, same outcomes after shuffled imports/reopen, history regrouping, two reset orderings, old-device late writes, chart query performance on 100,000 events, streaming export without UI-thread blocking, export contents contain no tokens/internal abuse evidence. Target initial summary query p95 <100ms on the test Duo; measure and record rather than claim before profiling.

**Reject:** storing rendered day strings as keys; stitching sessions across devices; writing a running timer tick every second; using travel as a wear/health metric; rebuilding entire history on the main actor.

## F05 — App shell, setup, and personal screens

**Owns:** app feature views/models/assets, navigation, settings; no storage implementation.

**Read:** ui.md, frozen read models, minimal-copy requirements.

**Deliver:** native tab/stack/form shell, durable setup, Today/History, themes/edit summary, settings/export/reset presentation. Feature models call FoldingData commands and do not recompute authoritative values.

**Evidence:** actual screenshots/recordings for outer/inner widths, light/dark, large text, Reduce Motion, empty/offline/reset/error, and setup interrupted during handoff. Independent reviewer must name actionable deviations, then inspect fixes. Copy pass removes explanatory text without removing accessibility labels or essential confirmations.

**Reject:** custom imitation system navigation; every view wrapped in a “manager”; permanent healthy-sync banners; error-swallowing empty states; fixture success used to mark physical setup tested.

## F06 — Widgets and daily reminders

**Owns:** widget target, widget configuration, local notification scheduling inside FoldingData.

**Deliver:** all four agreed widget families, supported metric selections, system tint-aware appearance, deep links, bounded refresh requests, threshold claims and preferences.

**Evidence:** widget snapshots in supported rendering modes; stale/missing data clearly distinguishable from current; active session display does not require per-second writes; denied permissions and timezone/threshold edits cannot duplicate a daily alert. Real installation and widget gallery configuration tested on device.

**Reject:** promising live refresh; wrong metric labels after fallback; background network polling from widgets as the only upload path; treating permission denial as success.

## F07 — Competition and public account lifecycle

**Owns:** Rust competition domain/Worker operations and migrations; the same execution agent integrates the iOS competition transport model against the frozen contract.

**Deliver:** epochs/transfer, ingestion/receipts, replay/rebuild, weekly/monthly/all-time, percentiles, finalized results, reset/leave/delete, profile moderation lifecycle and share data. Keep schema migration numbering under one coordinator.

**Evidence:** duplicate/lost-response batches, receipt cutoff, late earlier event, approved-after-freeze case, tied podium, same-score pagination, transfer invalidating old epoch, reset concurrent with ingestion/finalization, deletion while jobs/caches exist. Verify public removal without reranking others' historical awards.

**Reject:** adding pending folds to accepted totals; recomputing closed history from live rows; issuing medals with an unstable offset page; using a client clock to override server transfer authority; resetting an identity to clear a ban.

## F08 — Admin and avatar/name moderation

**Owns:** Worker admin templates/assets/handlers, moderation commands, report/blocks endpoints. No SPA.

**Deliver:** tiny protected tables/forms, safe avatars, multilingual names, case evidence, bans/appeals, period correction preview, audit trail. Manual avatar review is the launch default; owner/admin alert route is configured before enabling uploads.

**Evidence:** Access issuer/audience/signature/expiry/allowlist rejection on every hostname, CSRF/origin rejection, HTML escaping, stale revision handling, unauthorized object lookup, oversized/decompression-bomb image rejection, pending-object privacy, cache invalidation, false-positive name examples, idempotent approval/ban/correction.

**Reject:** accepting a “role” header from the public client; raw SQL admin console; pending content publicly served from R2; unrestricted URL-fetch avatar import; permanent automated ban from one rate anomaly.

## F09 — Result notifications and operational jobs

**Owns:** queue/scheduler handlers, APNs adapter, preferences/token endpoints, cleanup/alerting. Coordinate jobs schema with F07.

**Deliver:** unique logical jobs, leased retries, periodic catchup, per-category opt-in, next-09:00 scheduling, token invalidation, cancellation on lifecycle changes, dead-letter handling and runbooks.

**Evidence:** duplicate queue delivery; kill after external send/before acknowledgment; denied/revoked prefs; reset/deletion/ban race; DST/home-timezone change; invalid token; catchup after missed schedule; same logical award not recreated after correction. Describe ambiguous APNs outcomes honestly.

**Reject:** claiming exactly-once device display; logging token payloads; infinite retries; assuming an old queued payload proves current authorization.

## F10 — Localization, tips, assets, and review

**Owns:** String Catalogs, glossary, StoreKit configuration, icon/listing assets, UI screenshot scenarios. Feature owners fix layout defects.

**Deliver:** all agreed locales with stable mapping, native Shortcuts terminology, three consumable tips, review-prompt timing, generated localized screenshots, public support/privacy content matching actual data flows.

**Evidence:** placeholders/plurals and narrow/large-text layouts; sandbox purchase success/cancel/pending/duplicate transaction; no feature gated behind a tip; prompt not triggered during setup/error/purchase; screenshot matrix complete/current; independent UI copy pass. Account holder supplies legal/banking facts.

**Reject:** blindly shipping AI translations; hard-coded dollar prices; reusing stale screenshots; adding a satisfaction gate; claiming private iCloud data is sent to our backend when it is not.

## F11 — Beta and release rehearsal

**Owns:** release manifests and final readiness evidence; coordinator integrates all streams.

**Deliver:** exact signed build tested through TestFlight, real-device check record, security/UI review fixes, verified public pages/support email, production compatibility and recovery tests, dry-run submission preflight.

**Evidence:** every required gate has a passing link/artifact, old-client contract compatibility, backend rollback, state/data recovery preserving reset/deletion fences, secret isolation, same build identity across beta/release, full screenshots and metadata, no production fixture write path. Empty checklist boxes block release.

**Reject:** checkbox completion without evidence; optional smoke tests used instead of physical trigger proof; submitting a new untested binary after beta; clearing a failing screenshot test by blindly recording its output as the baseline.

## F12 — Submit and verify

**Owns:** protected release tag/workflow and immutable submission record.

**Deliver:** submit the exact preflighted build/assets with automatic release after approval, verify Apple review status, save submission/build IDs and workflow evidence, then verify publication after approval.

**Evidence:** Waiting for Review or In Review, not merely successful upload/Ready for Review. Retry follows persisted state and checks Apple before another external write. A rejection is handled against its actual feedback; any code change gets a new build identity.

**Reject:** polling timeout treated as permission to resubmit; release on every merge; asking for repeat permissions at every already-authorized pipeline step; claiming Apple approved before observing it.

## F13 — Deferred post-submission physical-device validation

**Owns:** `docs/experiments/`, device evidence, corrective changes/resubmission if necessary.

**Depends on:** verified App Store submission (F12) and owner access to the Duo.

**Deliver:** run every previously deferred physical check: actual Shortcut creation/handoff, partial/open/close counting, lock/background/terminated/restart, protected storage and sync, real App Attest and upload, sign-in, StoreKit, push, installed widgets, and battery/resource behavior. Update the original work-order evidence links and remove deferrals only after actual passes.

**Evidence:** device/OS/build, exact steps, observed outcomes, and fix build IDs. If a defect affects the submitted build, correct it and update/resubmit according to Apple's current review state. Never claim Apple review itself proves these tests passed.

**Completion:** full shipping goal stays active until these checks and corrective work are resolved, even if Apple has already approved/published.
