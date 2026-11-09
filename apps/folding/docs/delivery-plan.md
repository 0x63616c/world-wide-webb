# Folding: delivery plan through App Store submission


## Owner-approved execution update — November 7, 2026

The owner has authorized implementation through submission/publication and reports Apple account agreements/tax/banking requirements complete. Verify actual App Store Connect state when used; do not request these again unless a concrete account prompt contradicts that report.

Physical-device testing is explicitly deferred until **after App Store submission**. Any earlier wording requiring a real-device pass before feature work/submission is superseded by this scheduling exception. Keep these checks marked **deferred**, never passed; continue simulator, domain, backend, security, UI, and release checks before submission. Do not bypass App Attest or fabricate device evidence to satisfy this schedule. Missing device-only evidence is recorded in the release manifest as an owner-approved deferral, not a successful check. Automatic release after approval remains enabled; approval may occur before device testing is complete.

Immediately after verified submission, run the deferred Duo tests with the owner and fix/resubmit if needed. The full shipping goal remains incomplete until required deferred tests and resulting fixes are resolved. Known functional/security failures are still fixed promptly; this exception defers hardware evidence, not already-known defects.

Updated November 7, 2026. This is the execution companion to the [product specification](review-spec.md). The specification owns product behavior; this plan owns sequence, deliverables, and acceptance checks. No app or infrastructure implementation is complete yet.

## Confirmed project details

- Product: **Folding**. Proposed subtitle: **Fold Stats & Leaderboards**.
- Domain: **getfolding.app**, purchased by the owner. DNS, hosting, and email setup remain pending.
- Repository: **[0x63616c/folding](https://github.com/0x63616c/folding)**, created private for the project.
- Apple Developer account exists; credentials are in 1Password. Login and necessary account/project setup are authorized. Some account actions may need the owner's MFA or legal details.
- Native Swift app; Rust backend on Cloudflare; simple Rust-rendered admin; infrastructure as code; Fastlane and GitHub Actions.
- All core functions free; optional StoreKit tips. Automatically publish after Apple approval.
- Architecture follows the [architecture plan](architecture.md), [domain glossary](../GLOSSARY.md), and [initial decision record](adr/0001-project-structure.md), informed by Matt Pocock's two requested skills.

## Delivery rules

One execution agent implements the project sequentially in substantial feature batches. Do not delegate implementation to subagents. Independent agents may review completed work; the execution agent applies fixes. The detailed milestones and work orders remain scope/acceptance checklists, not instructions to stop after every item.

Use three validation checkpoints:

1. **Foundation proof (M0–M1):** prove real fold → durable local event → verified staging upload, private-sync/storage safety, signing, and a basic CI build/screenshot route. Run the bounded runtime experiments before building features that depend on them. Prove these mechanisms once; repeat only after a relevant change or failure.
2. **Feature-batch validation (M2–M6):** build the personal tracker (M2–M3), then competition/admin/notifications (M4–M5), then polish/localization/tips/release assets (M6). Work continuously within each batch. At its end, run focused integration/UI checks and address findings before calling the batch complete. Reuse prior evidence for unchanged foundations. These are the three substantial batches within the second checkpoint, not per-file or per-button gates.
3. **Integrated release validation (M7–M8):** run full real-device/TestFlight checks, independent UI/security reviews, localization coverage, recovery checks, and the release rehearsal. Submit only after required evidence passes; verify Apple submission and subsequent publication.

Cheap automated checks may run in the background during a batch. Expensive simulator suites, full screenshot matrices, and owner-operated device checks run at checkpoint/batch completion or when a specific new risk justifies them. Fix a discovered foundational/security/data-integrity failure before building dependent work; batching is not permission to ignore known failures. Keep CI and required merge/release checks enforced. Do not repeatedly rerun unchanged passing checks without a reason.

A milestone is complete only when its acceptance checks have evidence. Until batch validation, mark implementation as awaiting validation and keep acceptance boxes unchecked. Link the PR, CI run, recording, or device result when closing them. Do not report simulator fixtures as proof of physical-device behavior. GitHub Issues will track task status and evidence; the delivery plan tracks milestone progress. GitHub Issues are the live execution tracker; issue links are maintained in `docs/work-tracker.md`.

Use `codex/` branches and coherent PRs aligned to substantial changes, with commits at useful recovery points. Do not create a PR or request approval for every tiny edit. Keep `main` buildable. Add CI and Fastlane at the start. Use the [technical specifications and work orders](technical/README.md) to constrain implementation, and deterministic fixtures for routine development. Give progress updates without stopping execution for routine confirmation.

This plan does not set a calendar promise before the first device and build-tool checks. Apple's processing/review time and owner-operated device tests are external dependencies. After M1, estimate remaining work from demonstrated progress. Dependencies below indicate technical ordering, not parallel execution-agent assignments.

## M0 — Accounts, identity, and repository foundation

**Dependencies:** chosen name/domain/repository; secure account access. Local documentation and tooling work can proceed before account access is complete.

- [x] Record Folding and the purchased domain.
- [x] Create `0x63616c/folding` as a private GitHub repository and configure `origin`.
- [x] Commit the planning baseline and link these documents from the repository README; the initial push is verified alongside delivery of this plan.
- [ ] Identify the correct Apple team, Cloudflare account/zone, GitHub permissions, and administrator email allowlist. Read only the necessary 1Password items; do not enumerate unrelated secrets.
- [ ] Create the App Store Connect app record and verify that **Folding** is accepted. If the name is unavailable there, report the exact conflict before changing branding.
- [ ] Register production app identifier `app.getfolding.Folding`, widget identifier `app.getfolding.Folding.Widgets`, App Group `group.app.getfolding.Folding`, and iCloud container `iCloud.app.getfolding.Folding`, subject to team registration availability. Fix spelling/case in one configuration source before signing.
- [ ] Use separate development/staging identifiers and containers; configure Sign in with Apple, iCloud, App Groups, push, and App Attest entitlements for the appropriate targets. Do not accidentally share production competition credentials with staging.
- [ ] Configure scoped App Store Connect credentials, signing assets, and APNs credentials. Store them in 1Password/protected CI secrets, with ownership and rotation instructions. Use a temporary CI keychain. Do not automatically revoke unrelated team certificates.
- [ ] Configure minimal GitHub workflow permissions, protected production environment, required checks where the account plan supports them, and release-tag restrictions. Untrusted PR jobs receive no production secrets.
- [ ] Choose a signing storage approach supported by Fastlane; default to encrypted match storage separate from application source, with readonly access in routine CI.
- [ ] Confirm DNS control for `getfolding.app`, preserving any existing records. Plan root website, `api.getfolding.app`, `admin.getfolding.app`, and isolated staging endpoints.
- [ ] Use OpenTofu; verify Cloudflare provider coverage and state locking, then pin the toolchain. Put remote state in encrypted, access-controlled storage with locking and recovery instructions.

**Done when:** identifiers/account references are documented without secrets, the repo has a recoverable baseline, and a clean machine can follow the bootstrap instructions. Domain purchase does not mean DNS or inbox delivery has been configured.

## M1 — Prove the complete tracking and delivery route

**Dependencies:** M0 signing/device access for physical tests. Highest-priority technical milestone.

- [ ] Pin the installed supported Xcode/Swift toolchain, Rust toolchain, Node/Wrangler build tooling, Ruby/Bundler/Fastlane, and infrastructure tool. Verify the GitHub macOS runner has the required SDK and device simulator. If not, explicitly choose a suitable runner before promising screenshot automation.
- [ ] Create the minimal app, widget target, shared package, Cargo workspace, and HTTP contract fixture directory described in the architecture plan. No empty feature packages or generic framework scaffolding.
- [ ] Add bootstrap, format/check commands, staged-only formatting checks, and focused pre-push checks. Bootstrap installs hooks idempotently without rewriting partially staged files.
- [ ] Add initial GitHub checks: Swift build/domain tests, Rust formatting/clippy/tests, documentation/link checks, and dependency/secret scanning where supported.
- [ ] Add Fastlane build/test lanes and capture one deterministic simulator screenshot through GitHub Actions. Keep screenshot capture, app compilation, and signing configuration reproducible from Git.
- [ ] Create open/close App Intents and a durable shared-store write. Verify the app, intent, and widget can safely access the App Group store without lost writes. Allocate source sequences atomically across writers and preserve them on retries; include an out-of-order fixture proving late events cannot silently revise finalized results.
- [ ] On the owner's Duo, install both Shortcut automations and record results for full and partial open/close, repeated events, app visible/backgrounded, device locked, offline, app terminated, and device restart. Record exact OS, trigger names, run settings, timestamps, and observed limitations.
- [ ] Verify supported handoff to Shortcuts, setup-state restoration, and test-event exclusion. Do not claim the app can silently install automations or inspect whether they remain enabled.
- [ ] Exercise the transactional SQLite3 journal, Core Data/private CloudKit replication, and a reset marker across installations/devices; confirm the data model works with CloudKit's constraints before building all history screens.
- [ ] Build a small Rust Worker integration path that authenticates a real test installation, validates App Attest, and accepts an idempotent event batch into staging. Test repeated delivery and reset generation rejection.
- [ ] Prove when verified uploads can run from actual app/intent execution contexts. Leave the app unopened during a realistic test period, inspect delivery, then test queue draining on activation. Record how the 24-hour competition cutoff behaves.
- [ ] Verify actual outbound APNs connectivity and credentials from the chosen Worker runtime; verify required crypto implementations compile to the selected runtime. If direct APNs delivery is incompatible, document and test the smallest Rust-compatible delivery arrangement before locking infrastructure.

**Done when:** a physical fold is durably recorded once, appears in the app/widget read model, and reaches staging through the verified route; CI can build and produce a screenshot. Exact device behavior is documented. Any gap affecting counting, background delivery, or release tooling has a concrete resolution before dependent features proceed.

## M2 — Personal tracking people can rely on

**Dependencies:** M1 event semantics and storage validated.

- [ ] Implement a single tracking interface for recording, summary queries, export, and reset. The app/intent/widget must not independently calculate folds or session rules.
- [ ] Handle stable event IDs, distinct repeated states, ordered/out-of-order delivery, uncertainty, opens/closes/cycles, incomplete sessions, and running time unfolded according to the spec.
- [ ] Implement Today and History queries, midnight/DST splitting, stable home timezone, regrouping after timezone changes, and device attribution.
- [ ] Implement equivalent travel with versioned formula and optional help; never use it for ranks or physical-wear claims.
- [ ] Implement private iCloud synchronization, local-only operation, sync recovery, active-device transfer, and explicit behavior when iCloud is unavailable or the Apple account changes. Never merge different iCloud users' private history silently.
- [ ] Implement reset markers with deterministic convergence and surviving tombstones. Test offline concurrent resets, old devices, queued events, and new events created during a losing reset.
- [ ] Export the CSV package through a one-tap share action, including interrupted sessions and source/timezone details without security material.
- [ ] Add data-model migration tests and representative large-history fixtures. Keep chart queries and export from blocking the main UI thread.

**Done when:** a user can collect, inspect, export, reset, and recover personal history offline and after sync. Tests exercise public module behavior and real persistence; no private implementation details need to be called from views.

## M3 — Guided setup and polished native experience

**Dependencies:** M2 tracking interface; setup handoff proven in M1.

- [ ] Implement Today, History, Leaderboard entry/opt-in state, and compact Settings using native SwiftUI navigation and controls.
- [ ] Build welcome/device motion, open automation setup/test, close automation setup/test, and success flow. Save progress across app switches and provide retry/resume paths.
- [ ] Exclude test events without suppressing legitimate tracking on another device or leaving a permanent testing mode. Re-running setup preserves history and existing configuration.
- [ ] Add tested status and last event; do not infer failures merely from inactivity.
- [ ] Implement system/light/dark appearance, accessible accent palette, configurable Today statistics, and appropriate Liquid Glass surfaces.
- [ ] Adapt both display layouts, rotation where supported, Dynamic Type, VoiceOver, Reduce Motion, contrast, and accessible chart summaries.
- [ ] Add small/medium Home Screen and rectangular/circular Lock Screen widgets with per-widget selection, appropriate system tinting, navigation, and refresh limits.
- [ ] Implement daily threshold preferences and local notification behavior, including permissions, deduplication, DST/timezone changes, and lowering the threshold.
- [ ] Prepare and review empty, pending, offline, error, disabled-permission, and destructive-confirmation states with minimal text.
- [ ] Have an independent agent review rendered screens and recordings against the visual brief and perform a copy-reduction pass. Fix actionable findings and re-review affected screens.

**Done when:** a new user can complete and test setup without help, understand the main statistics, customize the app/widgets, and rerun setup. The independent reviewer has inspected actual rendered UI, not only source code.

## M4 — Competition, identity, and abuse controls

**Dependencies:** M1 verified upload path, M2 event semantics/reset rules. Implement in the next substantial batch after the personal tracker; frozen interfaces allow fixtures without a second execution agent.

- [ ] Define versioned request/response schemas, limits, structured errors, pagination, idempotency, and cross-language fixtures under `contracts/`.
- [ ] Implement Sign in with Apple validation, session lifecycle, logout/revocation, active-device transfer, and one competition identity per Apple subject. Private tracking remains available without joining.
- [ ] Implement challenge issuance, App Attest enrollment/assertions, payload binding, replay/counter validation, environment separation, timestamp plausibility, and durable batch ingestion. Reinstalls and key loss must not clear bans.
- [ ] Keep attestation failure/outage submissions pending; bound retries/storage and report compact status. No production trust bypass for simulator or reviewer fixtures.
- [ ] Compute accepted totals server-side, enforce post-join eligibility, reject setup/stale-generation submissions, and handle late/offline delivery separately from request-rate limits.
- [ ] Implement This Week, This Month, All Time, tied ranks, podium crowns, pagination, pinned user position, percentiles, and population rules.
- [ ] Implement provisional periods, server receipt cutoff, quarantine exclusion, idempotent finalization, immutable/versioned result snapshots, and explicit audited corrections.
- [ ] Implement historical results and share preview/cards with period context. No automatic sharing.
- [ ] Implement nickname validation, safe generated names, rate limits, normalized multilingual abuse checks, and ambiguous-name moderation.
- [ ] Implement avatar selection/cropping, bounded uploads, decode/re-encode and metadata stripping, private pending storage, manual approval queue for v1, and approved-image delivery. Automated moderation can be added only if it earns its operational cost; a named admin must clear the initial queue.
- [ ] Implement report/hide/block controls and moderation queue; hiding an entry must not change actual ranks.
- [ ] Implement reset, leave, delete, ban, and appeal paths consistently across live scores, historical identity references, avatar caches, queued notifications, and retained moderation records. Revoke Apple authorization tokens as required by the implemented deletion flow.

**Done when:** two real staging participants can join and compete, receive correct tied/late results, reset/leave/delete safely, and cannot bypass server decisions with a changed client total or replayed request. Artificial Shortcut invocation remains an abuse-detection problem, not something App Attest proves impossible.

## M5 — Admin, notifications, infrastructure, and operations

**Dependencies:** M4 competition behavior and contracts. Prepare infrastructure definitions earlier; complete operational checks here.

- [ ] Manage Workers, D1, R2, Queues/schedules, DNS/routes, and Cloudflare Access configuration through versioned infrastructure where supported. Document resources that need an initial account-level action.
- [ ] Keep staging and production data, keys, identifiers, queues, and state separate. Deploy idempotent migrations before dependent code.
- [ ] Publish the small Rust HTML admin at `admin.getfolding.app`. Validate Access JWT and administrator allowlist server-side; block alternative hostname routes from bypassing authorization.
- [ ] Use escaped HTML, POST-only mutations, session-bound CSRF protection, validated origins, explicit reasons, and audit history. Test unauthenticated requests and forged browser submissions.
- [ ] Add participant lookup, reports, avatar/name approvals, flagged-event evidence, quarantine/reinstate, temporary/permanent bans, appeals, and audited period correction. Avoid destructive bulk actions in v1.
- [ ] Implement weekly/monthly preferences: Off / All results / Podium only. Register APNs tokens, invalidate expired tokens, localize payloads, schedule next 09:00 home-timezone delivery, and deduplicate retries.
- [ ] Recheck permissions, profile status, result version, and reset generation at send time; cancellation must work when users reset, leave, or delete.
- [ ] Test scheduled jobs, duplicate queue deliveries, poison-message handling, retry limits, delayed finalization, and recovery without duplicate medals/notifications.
- [ ] Add structured logs with request IDs and minimal personal data, health checks, ingestion/queue/finalization alerts, bounded queries, retention cleanup, and cost alerts against the $25/month target. Confirm actual plan/pricing before enabling billed resources.
- [ ] Document backup/restore, D1 recovery, failed migrations, Worker rollback, key rotation, suspected abuse, Apple sign-in outage, attestation outage, and notification outage. Rehearse restore in staging.
- [ ] Add independently controlled switches to pause new competition submissions and results notifications during an incident while private local tracking remains usable.

**Done when:** an authorized admin can investigate and resolve a test abuse case, unauthorized actors cannot mutate data, each eligible result creates at most one logical notification and retries do not create another award notification, in-app results remain available regardless of APNs delivery, and recovery/runbooks are demonstrated in staging.

## M6 — Languages, tips, and listing assets

**Dependencies:** stable M3 screens; M4 competition screens for complete screenshots. Start source-string discipline in M1, not here.

- [ ] Maintain String Catalogs with context, a translation glossary, plurals, format arguments, and accessibility strings. No hard-coded user-facing strings in feature code.
- [ ] Ship English, German, French, Spanish (Spain and Latin America), Japanese, Korean, Brazilian Portuguese, Simplified Chinese, and Traditional Chinese. Keep a mapping file for app locales, notification language, and supported App Store locales rather than guessing identifiers.
- [ ] AI-draft translations, verify system Shortcuts labels and instructions, run placeholder/completeness checks, and inspect every supported language on narrow/large-text layouts. Seek native beta review for setup and deletion; a failing localization cannot be marked ready.
- [ ] Create an original icon, native launch appearance, screenshot caption style, and concise listing copy around the approved Folding brand. Check icon/screenshot requirements against current Apple guidance.
- [ ] Build the Settings tip jar with three consumable products and localized StoreKit prices. Test success, cancellation, pending, failure, duplicate transaction handling, and unavailable products. Tips never unlock capabilities.
- [ ] Configure product records, localized descriptions, review screenshots, and first-submission inclusion in App Store Connect. Verify agreements, tax, and banking readiness for tips with the account holder.
- [ ] Add the standard review prompt after the specified usage thresholds with no satisfaction gating or recurring donation prompts.
- [ ] Generate screenshots from deterministic app UI for Today, History, setup, customization/widgets where capture is supported, and competition/history. Never fabricate system widgets or claim fixture data is real user activity.
- [ ] Use Fastlane snapshot and reproducible caption/frame composition. Record fixture version, source commit, locale, appearance, capture size, and screenshot hashes. Generate both layout coverage and Apple's required upload dimensions; these are different matrices.

**Done when:** supported locales pass functional/layout checks, tips work in sandbox/TestFlight, and the release pipeline produces fresh localized screenshots and metadata previews that can be reviewed as artifacts.

## M7 — TestFlight, privacy, and submission readiness

**Dependencies:** M2–M6 integrated; release automation already operational.

- [ ] Produce signed release-candidate builds through Fastlane and GitHub Actions. Capture immutable build number/commit provenance; upload to TestFlight and wait for processing.
- [ ] Run internal beta first; use external beta review if inviting external testers. Verify actual Shortcuts, iCloud, sign-in, App Attest, purchases, push, widgets, and lifecycle behavior on supported hardware.
- [ ] Test installation/update, tracking with app unopened, lock/reboot, device replacement, account change, offline queues, notification denial, data export/deletion, and battery/resource behavior. Record evidence and supported OS versions.
- [ ] Review realistic large histories and leaderboard populations for responsiveness, bounded requests, and cost. Set practical performance budgets from device measurements and gate regressions against them.
- [ ] Complete independent rendered-UI review, copy-reduction review, accessibility checks, and a security review of auth, attestation, ingestion, admin, uploads, and deletion. Fix material findings; re-review affected behavior.
- [ ] Deploy `getfolding.app` with concise product, support, privacy, deletion, and appeal information. Confirm HTTPS and public availability without admin login.
- [ ] Configure a working support address, proposed `support@getfolding.app`, including actual delivery and reply capability. DNS forwarding alone is not proof that outbound replies work.
- [ ] Complete App Privacy answers from the implemented data inventory, including competition identity, avatar uploads, diagnostics, providers, and retention. Keep private iCloud storage distinct from data received by our backend.
- [ ] Audit dependency privacy manifests, required-reason declarations where applicable, permission strings, entitlements, and production logging. Avoid adding analytics/advertising SDKs by default.
- [ ] Fill in real seller/contact information, age rating, content rights, storefront availability, and export-compliance questionnaire. The owner supplies legal/business facts; do not infer declarations from app branding.
- [ ] Write reviewer instructions for hardware/Shortcuts setup and tip products. Provide a clearly explained demonstration path for inspecting the UI when hardware/setup is unavailable, isolated from production score ingestion. It must not bypass account security or be hidden from review.
- [ ] Complete localized name/subtitle/description/keywords/release notes and verify current limits, screenshot dimensions, working URLs, copyright, category, and the exact selected build.
- [ ] Rehearse the entire release workflow with submission disabled, including resumability after upload/processing failure. Produce a readiness checklist and immutable artifact manifest.

**Done when:** every required check has evidence, no unresolved release-blocking defect remains, production endpoints are ready, and the exact build/listing/screenshots can be submitted reproducibly. App Store validation remains authoritative for required account fields.

## M8 — Submit the app and publish after approval

**Dependencies:** M7 ready; compatible production backend deployed; release instruction represented by a protected version tag.

1. Freeze a validated commit, version, and unique build number. Verify required backend capabilities and compatibility with any already-released app.
2. Run release checks and generate the current localized screenshots/metadata from that commit. Fail on missing/stale captures rather than reuse unrelated artifacts.
3. Archive/sign once, upload via Fastlane, wait for processing, and select that exact App Store Connect build. If the same immutable build was already uploaded during the release rehearsal/beta flow, reuse its recorded identity instead of uploading a duplicate.
4. Upload the matching metadata/screenshots and attach the first tip products for review as needed. Check all required account and privacy fields.
5. Use Fastlane submission with automatic release after approval enabled. Use official Apple tooling only for gaps Fastlane cannot cover; record any unavoidable one-time console step.
6. Verify the submission actually reaches **Waiting for Review** or **In Review**. A successful binary upload or **Ready for Review** is not the completion criterion.
7. Save the commit, build ID/version, submission identifier/status, timestamp, artifact hashes, and workflow URL in a release record; publish the generated assets to the GitHub release.
8. Report the submitted version and evidence to the owner. Handle Apple requests/rejection with a targeted correction and new build if required; preserve the review conversation and submission state.
9. After approval, verify automatic publication, the public listing, download/update, production setup, tips, leaderboard, and support links. Apple approval timing is outside the pipeline's control.

**Submission goal complete when:** Apple has accepted the exact intended build and its required contents into review, the status is verified, and automatic publication is configured. **Launch complete when:** approval has occurred and the app is publicly available and smoke-tested.

## Repository and workflow deliverables

The detailed directory/module design lives in [architecture.md](architecture.md). Build these workflows incrementally:

- `checks`: unprivileged PR formatting, compile/tests, contract parity, localization, dependency checks, and targeted UI snapshots. Upload failures for diagnosis.
- `staging`: deploy compatible backend changes and migrations from trusted commits, then run integration checks.
- `beta`: Fastlane signed build and TestFlight upload with processing/status evidence.
- `screenshots`: localized deterministic capture and review gallery; runnable independently and required by releases.
- `release`: protected tag, full validation, exact build/assets, production compatibility check, submission, and release record. Use a concurrency lock so two releases cannot race.
- `infra`: validate/plan in PRs; apply only in trusted contexts with scoped secrets. Do not let a PR from a fork run privileged deployment code.

Suggested Fastlane lanes: `verify`, `screenshots`, `beta`, `release_preflight`, and `submit`. Lanes call shared implementation rather than duplicating build-number or signing logic. Every external write must be resumable without creating duplicate submissions, products, or notifications. Keep release screenshots/artifacts available beyond short-lived CI retention.

## What I need from the owner, and when

**For account setup:** the relevant 1Password vault/item references, Apple team selection if multiple teams exist, Cloudflare account access, and the admin email allowlist. Never paste passwords or private keys into chat. The repo and domain are decided.

**For M1 and beta:** a Duo connected for installation/testing, its OS version, and a few guided physical actions that cannot be simulated. Ordinary development uses fixtures so this does not become constant manual testing.

**Before submission:** legal seller/contact facts, working public support destination, any required agreements/tax/banking actions for tips, and approval of final public brand/listing assets. The agent prepares the concrete assets first. MFA/account-holder actions will be requested only when an actual login/setup step requires them.

Everything else has defaults in the spec or this plan. The owner has now authorized full implementation and shipping under an active goal. Choosing this plan does not authorize an unspecified additional purchase.

## Sources and implementation checks

These are current reference points, not substitutes for testing our own app:

- [Fastlane App Store Connect authentication](https://docs.fastlane.tools/app-store-connect-api/), [deliver](https://docs.fastlane.tools/actions/deliver/), and [snapshot](https://docs.fastlane.tools/actions/snapshot/): basis for the planned listing/submission and localized capture lanes. Verify action support against the pinned version when implementing.
- [Apple submission overview](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/overview-of-submitting-for-review), [submission statuses](https://developer.apple.com/help/app-store-connect/reference/app-information/app-and-submission-statuses), and [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications): source of the review-state gate and current required assets.
- [Apple App Review](https://developer.apple.com/app-store/review/), [Review Guidelines](https://developer.apple.com/app-store/review/guidelines/), and [export compliance](https://developer.apple.com/help/app-store-connect/manage-app-information/determine-and-upload-app-encryption-documentation/): check the implemented app and actual account answers before submission.
- [Cloudflare Rust support](https://developers.cloudflare.com/workers/languages/rust/) and [Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/): reference for runtime and admin authentication integration checks.
