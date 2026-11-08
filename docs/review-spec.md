# Folding: complete v1 specification for review


## Owner-approved execution update — November 7, 2026

The owner has authorized implementation through submission/publication and reports Apple account agreements/tax/banking requirements complete. Verify actual App Store Connect state when used; do not request these again unless a concrete account prompt contradicts that report.

Physical-device testing is explicitly deferred until **after App Store submission**. Any earlier wording requiring a real-device pass before feature work/submission is superseded by this scheduling exception. Keep these checks marked **deferred**, never passed; continue simulator, domain, backend, security, UI, and release checks before submission. Do not bypass App Attest or fabricate device evidence to satisfy this schedule. Missing device-only evidence is recorded in the release manifest as an owner-approved deferral, not a successful check. Automatic release after approval remains enabled; approval may occur before device testing is complete.

Immediately after verified submission, run the deferred Duo tests with the owner and fix/resubmit if needed. The full shipping goal remains incomplete until required deferred tests and resulting fixes are resolved. Known functional/security failures are still fixed promptly; this exception defers hardware evidence, not already-known defects.

Version 1 · November 7, 2026 · Product name: Folding

This is the single document to review. It combines requirements already agreed with sensible defaults chosen at the owner's request. These defaults are recommendations for approval, not a claim that each was explicitly approved previously. This document takes precedence over earlier planning notes; no application implementation has started.

## 1. The product

A free, beautifully native iPhone Duo app that quietly records folding activity, makes personal habits interesting, and offers optional friendly competition. Everything works without payment. Tips support development.

The experience has four tabs: **Today**, **History**, **Leaderboard**, and **Settings**. People can finish setup and then rely on widgets, returning when they want detail.

Ship all core capabilities described here in v1. Do not add social feeds, messaging, subscriptions, import, Android support, or a separate iPad/Mac app. No haptic-engine background tracking. The owner selected **Folding** as the final product name. App Store registration is pending; initial public searches found no exact app-name match. Proposed subtitle: **Fold Stats & Leaderboards**. The owner purchased **getfolding.app** and selected **0x63616c/folding** as the private project repository.

## 2. Tracking: simple, consistent counting

Shortcuts-based fold tracking is the established product approach, supported by the owner's observed HingeWorthy workflow. It is not a planning blocker. Implementation tests will characterize exact partial-fold thresholds, locked-device behavior, and supported OS versions; those details have not yet been tested in this project.

- One detected opening is one fold; one detected closing is one fold.
- Opening and closing produces two folds and one completed open–close cycle.
- Opening halfway and closing again should produce two folds if the system emits those transitions; reaching flat is not required.
- Tiny adjustments while already partially open are not promised as additional folds.
- Separate opens, closes, and completed cycles appear in detailed statistics.
- Background Shortcuts events are the authoritative source for counts, including when the app is visible. Live foreground hinge updates drive animation only; this avoids counting the same movement twice.
- Retries with the same stable event ID are ignored entirely. A distinct event repeating the last state adds no fold and marks any spanning session uncertain; a repeated open starts a new candidate session. Apply the same ordered event rules locally and on the server. Explain missing-event uncertainty in history rather than fabricate counts.
- Setup test events are excluded from personal totals and competition.

Fully-flat counts and continuous measured travel are deferred from v1 unless reliable background evidence becomes available. A foreground-only measurement must not be presented as a complete daily total.

### Time unfolded

Time unfolded is elapsed time between a valid open and close, including overnight. The current open session shows a running duration. At midnight, split duration into the appropriate days.

An unmatched close adds a close count only if it is not a repeated state, and adds no invented session duration. A distinct repeated open marks the earlier session incomplete and starts a candidate session without adding another fold. A subsequent valid close can finalize that candidate duration, but the uncertain sequence does not award a completed open–close cycle. Unbounded uncertain time does not enter finalized totals. Persist tracking state across ordinary app launches; only a detected device restart or tracking interruption invalidates a spanning session. Preserve the last observed transition for fold deduplication across interruptions; invalidate duration/cycle continuity, not the physical fold count. If a missing close cannot be detected, the current timer may continue until reconciliation; do not claim the app can always discover missed events.

Use precise timestamps internally. Format durations in friendly units. No manual addition of competition-eligible folds.

### Hinge travel: a playful equivalent

V1 offers **Equivalent travel**, a secondary optional statistic rather than a claim of measured hinge motion:

- Each recorded fold represents one reference 180° swing.
- Equivalent angular travel = fold count × 180°.
- Distance equivalent uses a clearly defined illustrative point 10 cm from the pivot: one reference swing is approximately 31.4 cm.
- Example: 100 recorded folds = 18,000° of reference rotation, or about 31.4 m of equivalent travel.
- A short info sheet says: “A playful full-swing equivalent based on your recorded folds, not measured movement.” Partial folds receive the same equivalent.
- This is never described as physical hinge wear, actual phone-edge distance, or measured travel, and never determines rankings.

This keeps the fun distance idea without introducing an unreliable background sensor dependency. It can be disabled in the summary.

## 3. Guided setup

1. Show the opening automation and its exact Folding action, **Log Duo Opened**. Open Shortcuts, then let the user confirm they added it. Returning from Shortcuts alone does not start a test.
2. Prompt the physical opening and confirm the event. Start checking automatically when a known hinge posture shows the Duo is ready. If hinge state is unavailable or setup resumes at this step, offer a single **Start test** action with the starting posture shown.
3. Repeat for the closing automation, using **Log Duo Closed**.
4. Show a brief success state and the Today screen.

Do not ask for competition login or notification permission before tracking works. If iCloud is unavailable, explain that local tracking works and sync can resume later.

Preserve setup progress across app switches. The user should not watch a countdown. A manual test action is a fallback for unavailable hinge state or resumed setup. While checking, show which movement to make and that the app is waiting for Shortcuts. Failed tests offer Retry and a Shortcuts handoff. Returning users can run setup again from Settings without erasing data or creating duplicate automations unnecessarily.

Status shows “Setup tested,” individual open/close test results, and last received event. Do not imply direct knowledge of an automation's enabled state. No events for a while does not trigger an alarming failure message.

Use native motion and a simple animated device illustration. Respect Reduce Motion and make all steps understandable without animation. Verify actual Shortcuts labels and handoff destinations per supported language/OS.

## 4. Today, History, and widgets

### Today

Default order: today's folds; time unfolded; seven-day trend. A compact setup/sync status appears only when helpful. An Edit Summary sheet allows selection and reordering of opens, closes, cycles, lifetime folds, equivalent travel, and competition rank. Competition cards are absent until the user joins.

### History

Offer day, week, month, and all-time ranges, an accessible chart, and session details. The chart supplies the selected-bin breakdown without repeating every zero-value bin as a list row. Label interrupted sessions clearly. Use two columns for chart and sessions on the wider Duo canvas. No streak pressure or notification barrage.

### Widgets

Ship small and medium Home Screen widgets and rectangular/circular Lock Screen widgets. Supported choices are today's folds, time unfolded, weekly trend where space permits, and daily threshold progress. Use appropriate layouts for each family rather than squeezing every metric into every size.

Each widget has its own metric selection. Use black tint in light mode and white tint in dark mode where system rendering allows, and respect the system's tinted/monochrome appearance. Tapping opens the relevant app destination. Updates are best-effort within WidgetKit limits, not guaranteed live fold-by-fold refreshes.

### Appearance

System appearance is the default; Light and Dark overrides are available. Use white tint in dark mode and black tint in light mode, with no tint setting. Use native typography, controls, navigation, sheets, and chart interactions; Liquid Glass belongs on appropriate system surfaces rather than every card.

Layouts adapt deliberately between outer and inner displays: small count cards pair in two columns, charts expand, and History places chart and sessions side by side when space allows. Equivalent travel defaults to the device's usual unit, with metres/feet override in Settings. Support Dynamic Type, VoiceOver, increased contrast, Reduce Motion, and non-color status cues.

### Minimal UI copy — mandatory review criterion

Prefer familiar SF Symbols, hierarchy, numbers, and short labels. Avoid explanatory paragraphs, repeated captions, implementation details, and unsolicited disclaimers. Settings uses compact rows; deeper explanations belong in optional help. Setup gives one short instruction per step. Retain clear labels for ambiguous actions and concise destructive confirmations. Icon-only controls need VoiceOver labels and appropriate touch targets.

The independent UI reviewer must perform a copy-reduction pass: delete redundant text, shorten labels, replace words with familiar icons where meaning remains clear, and verify that accessibility and setup usability survive the reduction. Technical detail in this spec is not text to paste into the app.

## 5. Data, devices, and timezones

Personal data is local-first with private iCloud sync. No app account is needed for private tracking. Keep all personal history until the user resets/deletes it. Offline operation is normal.

V1 follows **one active tracking phone at a time**. History survives phone replacement and is grouped by device, but the main totals continue across devices. Switching the active phone requires an explicit transfer; the old phone's later events do not count toward competition. Offline personal events remain visible with their source device. Before the first explicit private-device selection, merged initial history is retained and multiple sources prompt a tracking-phone selection; this is a bootstrap exception, not automatic device election. A private transfer captures each inactive source's highest locally known sequence: later unknown observations from it remain in device details/export but are excluded from the main summary. A deterministic transfer marker resolves concurrent private choices. Public transfer accepts old-device submissions only if received before server-confirmed transfer; later old-epoch uploads are ineligible. Resolve the active-device handover server-side for competition and reconcile the private selection through iCloud.

Use a **home timezone**, captured from the device initially, for personal daily charts, thresholds, and calendar boundaries. It remains stable while travelling and stays out of Settings. Store UTC timestamps and original timezone context so export preserves the facts. Use timezone-aware calendar arithmetic for daylight-saving changes.

Global competitions use UTC, independently of personal charts. Show a countdown or date range; use a compact “UTC” only where needed. Keep boundary rules in optional details, not explanatory banners.

### Export

Export a single CSV package (a ZIP containing event, session, and daily-summary CSV files) through the share sheet, without a format chooser. Include raw events, daily summaries, session completeness, device references, timezone context, and the equivalent-travel formula/version. Do not export security tokens or internal abuse evidence. Import is outside v1.

## 6. Competition

Joining is optional, using Sign in with Apple. Suggest the Apple name when the user shares it; otherwise leave the field blank. The user reviews/edits a public name of 3–20 characters before tapping Join. Never publish the Apple account name/email automatically. Apple sign-in supplies no profile photo, so a tappable monogram avatar opens the system photo picker. No biographies or chat in v1.

Only folds recorded after joining and from the active tracking phone count. No retroactive pre-join history or setup-test events. One competition identity per Apple subject identifier; reinstall/reset does not create a fresh identity to evade restrictions.

### Avatars, names, and sharing

Let users crop and preview their own avatar. Accept bounded raster uploads, validate decoded content and dimensions, strip metadata, re-encode, and publish the sanitized derivative immediately after successful processing. Names and photos never require administrator approval. Provide reporting and retrospective admin removal of names/images and suspension/ban controls. Individual hide/block controls are omitted from v1 UI. Deletion removes associated avatar assets and invalidates cached derivatives.

Validate display names server-side on creation and changes. Normalize Unicode for abuse detection, check whole words and common obfuscations against a versioned multilingual profanity/slur policy, and rate-limit changes. Avoid naive substring matching that rejects innocent names. Reject clear violations with “Choose another name”; publish all other valid names immediately. Do not create a human approval queue or hold signup pending review. Administrators can remove abusive public names or ban accounts afterward.

Overlay tasteful gold, silver, and bronze crowns on top-ranked avatars for the selected period. Crowns are app-rendered rank markers, never baked into uploaded images. Preserve rank text/accessibility labels rather than relying only on color. Allow an optional native share-sheet card of the user's own placement, avatar, crown, score, and period. Show a preview; never share automatically. Current placements are identified by period/date, and finalized result cards use the recorded result.

### Periods and ranking

- This Week: Monday 00:00 UTC through the following Monday.
- This Month: UTC calendar month.
- All Time: accepted competition folds since joining or last reset.
- Highest valid fold total ranks first. Equal totals share competition rank: 1, 1, 3.
- Ranks 1, 2, and 3 receive gold, silver, and bronze respectively. Ties can award several of a medal and skip another rank.
- Show a compact podium, ranked list, and a pinned “You” position.
- New users can join mid-period; label their join date rather than prorating scores.

Allow 24 hours after a weekly/monthly period ends for valid late uploads. Attribute events to periods by validated event time; require durable server receipt before the cutoff. During that window results are provisional. Finalization includes only submissions received before the cutoff and approved by finalization; quarantined submissions remain excluded. Later arrivals or approvals can still enter personal history and all-time competition, subject to validation, but never automatically reopen finalized periods. Historical changes require an explicit audited correction. Then send finalized results.

### Competition comparisons

Owner decision, November 8: do not display percentile or “More folds than X%” comparisons anywhere in the app. Show folds, rank, participant count and medals. Existing backend percentile fields may remain for older clients; the current app does not model or render them.

### Historical results

Your Results lives in the Leaderboard tab and shows finalized weekly/monthly rank, score, participant count, and medals, with period navigation. Store finalized snapshots rather than recomputing them from live totals. Show provisional status before finalization.

On reset, leaving competition, or account deletion, remove that person's public scores and their own result history, remove public identity references from historical entries and cached share data, and cancel queued result notifications. A reset may retain the current profile for future participation, but must remove its association with erased results. Leaving/deletion also removes avatar assets and cached derivatives. Preserve other users' already-earned results; anonymize/remove affected public entries rather than silently rerank historical awards. Confirmed cheating can trigger an explicit, audited period correction and medal reissue. Never send duplicate original award notifications after a correction.

## 7. Notifications, daily limit, and reviews

All notification categories begin off. Ask for system permission when the user enables their first category. Settings offers:

- Daily limit reached: On / Off.
- Weekly result: Off / All results / Podium only.
- Monthly result: Off / All results / Podium only.

Send at most one result notification per participant per period; Podium only filters to finalized medal-winning results. Daily limits are reminders; logging continues. Send at most one threshold alert per home-timezone day. Editing the threshold or timezone does not produce another alert for the same already-alerted day. Check a newly lowered threshold on the next real event, not immediately in Settings.

Competition notifications follow finalization and are delivered at the next 09:00 in the user's home timezone. Recheck current opt-in preferences and account state before sending. Provide the results in-app regardless of push delivery. Daily threshold alerts happen when crossed and respect system Focus behavior.

Use Apple's standard review request after setup is complete and three separate days of recorded use, when the user next views a completed summary. No additional seven-day wait applies. Allow at least 30 days between request attempts, including attempts where the system does not display a prompt. Avoid setup, error, reset, and purchase flows. Do not ask a satisfaction question first. Let the system govern whether the prompt appears.

## 8. Reset, privacy, and account deletion

**Reset history** clears personal events, sessions, public scores, own historical placements, and medals. Keep appearance, widgets, notification choices, and the daily threshold. Keep the competition identity and opt-in choice so future valid folds start again from zero. Explain this in a concise confirmation sheet.

A reset creates a new data generation so stale queued events cannot restore erased totals. Persist a small reset marker independently of event cleanup. Order markers by a logical revision (one greater than the highest known revision), then a unique reset ID as a deterministic tie-breaker; do not depend on device wall clocks. iCloud clients and the backend converge on the greatest marker. A later winning marker invalidates older-generation events and competition totals even if they were already synchronized. Never relabel events into a different generation.

Show “Cloud reset pending” until remote operations finish. Keep local tracking in the new generation while waiting; synchronize its reset before accepting its competition submissions. If concurrent offline resets conflict, discard events belonging to the losing generation, including events recorded while that reset was pending. Once reconciled, new events use the winning generation. Show a compact sync notice if pending history was discarded. Old devices must adopt the winning marker before resuming eligible logging. The observable rule is that reset wins over stale data.

**Leave competition** removes public participation and competition data while preserving private personal history. Rejoining starts competition from zero.

**Delete competition account** is available in-app and removes the profile, tokens, and competition data. Explain separately whether the user also wants private history reset. Preserve only narrowly scoped moderation records necessary to enforce an active restriction, with a stated retention policy; no raw personal history in that record.

Keep a minimal keyed subject/operation mapping for deletion-status recovery for 30 days after cleanup, then remove it unless an independent active-ban record is required. Default moderation evidence retention is 90 days after a case closes. Retain a minimal account-linked active-ban record while the ban is in force; review permanent bans annually. This policy must be reflected in the privacy notice and reviewed before public launch.

## 9. Abuse prevention and admin

App Attest verifies installation/request integrity; it does not certify physical folds. Use Sign in with Apple, server-validated assertions, payload-bound challenges, replay protection, stable event IDs, timestamp checks, reset generations, and server-computed totals.

Do not trust a client-supplied “verified fold” flag or submitted total. Rate-limit network requests separately from physical-event plausibility. Batch uploads after offline time are expected. Quarantine suspicious event patterns for review; do not automatically permanently ban someone for a single anomaly. Define and tune numeric thresholds using measured legitimate device behavior during implementation.

Intents durably queue events in the shared store before completing. Attempt verified uploads from supported execution contexts, retry with backoff, and drain the queue on app activation. Show a compact pending count when useful; widgets are not a guaranteed upload scheduler. Prove the attested upload route, including locked/background execution and users who rarely open the app, in the first device spike. If routine background delivery cannot be achieved, resolve the impact on the 24-hour cutoff before shipping competition; do not silently promise weekly credit for locally queued events.

Attestation outages leave local tracking intact and public submissions pending. Never silently bypass verification in production. Simulators use isolated development fixtures only.

An app community ban removes the profile from public views and blocks leaderboard, upload, profile-edit, and sharing-data endpoints server-side. It does not disable private local tracking, export, account deletion, or appeals. Offer a concise restriction explanation and support/appeal link. Reset cannot clear a ban. Do not promise that all artificial Shortcut invocation can be detected.

### Admin application

A small admin site at admin.getfolding.app, protected by Cloudflare Access with an explicit administrator allowlist. Validate JWT signature, issuer, expiry, audience, and role on the backend; protect mutation endpoints as well as the page. No public route may bypass authorization. All mutations require POST, a session-bound CSRF token, and validated same-origin requests. GET requests never mutate data. Escape user-supplied names, reports, and other content in rendered HTML; never render it as trusted markup.

Use simple Rust-rendered HTML tables and forms with a small stylesheet; no SPA or separate frontend framework is needed for v1. Include participant lookup, flag queue, event-pattern evidence, exclude/reinstate submissions, temporary suspension, ban/unban, nickname/avatar moderation, reports, period correction, and audit history. Require a reason for moderation actions. Prevent accidental destructive bulk actions. Log actor, timestamp, reason, before/after state, and affected period.

## 10. Technical direction

Use SwiftUI, Swift Charts, WidgetKit, App Intents, AuthenticationServices, StoreKit, UserNotifications, and DeviceCheck/App Attest. Use a shared App Group store for app/intent/widget access.

Selected persistence: a transactional system SQLite3 App Group journal with immutable event IDs/reset generations, plus a private Core Data/CloudKit replication mirror. [ADR 0002](adr/0002-atomic-tracking-storage.md) specifies the cross-process atomicity and asynchronous reconciliation. Treat sync as eventual; do not make foreground UI depend on a network round trip. Validate the multi-process store and CloudKit constraints in an early implementation spike.

The backend is Rust, compiled to WebAssembly for Cloudflare Workers using workers-rs. Keep business logic in a platform-independent Rust crate and platform bindings in a thin Worker crate. Verify cryptographic, APNs, storage, and job integrations against this runtime early. Use D1 for competition and moderation records, scheduled work and Queues for reliable period processing/notifications, and APNs for remote results notifications. Use transactional/idempotent operations, unique submission constraints, a finalization cutoff, and versioned results so retries cannot produce duplicate awards.

Use OpenTofu for supported Cloudflare infrastructure resources and versioned Worker configuration/migrations. Separate staging and production. Verify provider coverage and remote state locking in the infrastructure spike; the tool choice is now OpenTofu. Store secrets and sensitive state outside Git. Start with a $25/month operating target, usage alerts, bounded queries, and ingestion limits; actual pricing/capacity must be checked before provisioning and this target is not purchase authorization.

Keep third-party dependencies small: evaluate Swift Snapshot Testing for visual tests and Swift Dependencies for deterministic fixtures. Adopt only if they simplify the project. Use native animation rather than adding an animation framework by default.

Target iOS 27 on Duo, with the exact minimum minor version set to the first verified version supporting required triggers. Do not invent an SDK availability guarantee. No separate Mac/iPad/watch app in v1.

## 11. Languages and monetization

Launch language resources: English (US source, suitable for other English regions), German, French, Spanish (Spain and Latin America, mapped to supported storefront locales), Japanese, Korean, Portuguese (Brazil), Simplified Chinese, and Traditional Chinese. Use supported locale identifiers consistently across app, push, and listing configurations.

AI drafts translations using a glossary and per-string context. Verify localized system labels, plural rules, interpolation, accessibility, and layouts. Generate localized App Store screenshots. App language follows system preferences with Apple's per-app language control. Native-speaking beta review is desirable for onboarding and destructive actions; failed language QA blocks that localization's release rather than silently shipping broken instructions.

All functions are free. Offer three consumable tip products targeting US $0.99, $2.99, and $4.99 equivalent storefront tiers, displaying actual localized StoreKit prices. A tip unlocks nothing and gives no competition advantage. Place the tip jar in Settings; no repeated donation popups.

## 12. Repository, CI, and release

### Repository layout and hooks

Use the private `0x63616c/folding` monorepo. The [architecture plan](architecture.md) defines the initial modules and the [delivery plan](delivery-plan.md) defines execution through submission. Application directories below will be created with their first implementation:

- `apps/ios/`: Swift app, widgets, shared code, resources, and tests.
- `backend/`: Cargo workspace with domain and Worker crates; admin HTML templates/assets live with the Worker.
- `backend/migrations/`: ordered D1 schema migrations.
- `contracts/`: versioned API schemas and cross-language fixtures.
- `infra/`: Cloudflare infrastructure definitions and environment configuration.
- `fastlane/`: lanes, localized metadata, screenshot capture configuration, and review assets.
- `scripts/`: bootstrap, formatting, checks, and release helpers.
- `.githooks/`: versioned local hooks, installed by the bootstrap script.
- `.github/workflows/`: PR, release, and infrastructure workflows.
- `docs/`: specification, architecture decisions, delivery plan, and operational instructions.
- `GLOSSARY.md`: consistent domain terminology.
- `web/`: public product, support, and privacy site for `getfolding.app`.

Provide one format command for Swift, Rust (`cargo fmt`), infrastructure, and supported document/config files, using pinned tools. A fast pre-commit hook checks staged content formatting and whitespace; it never silently stages unrelated edits or changes partially staged files. On failure, show the format command and require restaging. Pre-push runs focused Rust/domain checks; full simulator tests stay in CI. CI enforces formatting, Rust clippy/tests, and the other required checks even if local hooks are bypassed. Hook installation is explicit in bootstrap and idempotent.

### Release ownership

Fastlane is required for signing/build/TestFlight/listing/screenshot/submission orchestration, invoked by GitHub Actions. Use official APIs only to fill documented fastlane gaps, not replace the agreed workflow.

The owner already has an Apple Developer account and stores credentials in 1Password. Once a final name is chosen, the owner has authorized logging in and performing the account/project setup needed for this app. Use securely scoped credential references and CI secrets; never commit credentials or expose them in logs. User intervention may still be needed for MFA or an account action that cannot be delegated. The name is now selected: Folding. Account/project setup can proceed under this authorization; this is not authorization to purchase an unspecified domain.


The repository owns source, tests, localized strings, infrastructure, migrations, workflows, fastlane configuration, App Store metadata, screenshot fixtures/templates, review notes, and release instructions. Credentials and signing keys live in protected secrets.

PR checks cover builds, formatting, core domain tests, backend authorization/idempotency tests, localization checks, infrastructure validation, and targeted UI snapshots. Test retries versus distinct repeated states, missing events, midnight/DST, concurrent offline resets and losing-generation events, stale sync, transfer of active phone, ties, receipt cutoffs and quarantine approval, bans, privacy removal with queued notifications, forged admin submissions, and repeated finalization jobs. UI tests cover both display sizes, themes, large text, and setup recovery. Pin toolchains and dependencies.

Use deterministic sample data and fixed clocks for screenshot capture. Screenshots must come from the actual release app and include localized captions where applicable. Store generated output as GitHub release artifacts; keep generation sources in Git. Fail release if required screenshots are missing or stale. Verify simulator and capture-size support on the chosen runner.

A version tag starts the release workflow: validate, capture screenshots, archive/sign, upload to TestFlight, upload the matching listing, submit the selected build for review, and **automatically publish after Apple approval**. Treat the release tag as the deliberate release instruction, not every merge. Use fastlane snapshot/deliver and official APIs where fastlane lacks coverage. Keep a record of the exact commit, build, listing, and assets.

Deploy backward-compatible, additive backend/schema changes before submitting an app that needs them. Keep the currently released app supported throughout review and rollout; do not assume users update immediately. Version contracts and verify compatibility in CI. Remove old fields/endpoints only through an explicit retirement plan. Document and rehearse rollback to the previous compatible Worker; leave additive migrations in place, and prefer a forward repair over destructive database rollback. App release automation verifies required backend capabilities before submission.

App Store default category is Utilities, with Productivity secondary where appropriate; age rating comes from truthful questionnaire answers. Offer distribution in eligible supported storefronts after checking service access and required account obligations. Support/privacy pages and review instructions must be ready for submission. Include a reviewer-friendly demonstration path that cannot submit simulated scores to production.

Apple enrollment, agreements, credentials, and review itself are external dependencies. Signing/release setup must not claim those can all be generated from Git. TestFlight and real-device testing must cover authentication, tips, App Attest, notifications, and actual Shortcuts execution.

## 13. Quality bar and delivery order

An independent agent reviews rendered screens and recorded flows against this spec: both displays, navigation, animations, localization, accessibility, widgets, empty/error/offline states, and setup. Fix actionable findings and re-review before release. Snapshot tests complement this review; they do not replace visual judgment.

One execution agent performs all implementation; subagents are limited to independent review. Use the [delivery plan's larger batches and three validation checkpoints](delivery-plan.md#delivery-rules). Build continuously within a batch; run expensive checks at its completion or for a specific new risk, while preserving all release acceptance requirements.

Implementation order after spec review:

1. Establish the native shell, basic CI, Fastlane build/signing lanes, and a screenshot smoke capture. Add persistence, intent logging, physical-device trigger tests, and the attested upload spike.
2. Deliver guided setup, personal statistics, sync, reset/export, and themes.
3. Add widgets and complete localized flows.
4. Deliver competition, security, historical results, notifications, and administration.
5. Add tips and review timing; complete CI coverage, localized screenshot generation, and release/listing automation on the foundation established in step one.
6. Run independent UI review, device/beta checks, and the release rehearsal.

If device testing exposes a Shortcuts edge case, bring back the specific product impact and smallest workable adjustment. Do not silently redefine counting or claim unsupported background measurement.

## 14. What still requires owner input

Only choices that cannot sensibly be invented remain:

- DNS/account access for the purchased `getfolding.app` domain. Product name and repository are decided; App Store registration remains an operational check.
- Final account/access references and administrator identities when needed. Apple Developer ownership and permission to perform setup after naming are already confirmed; credentials are in 1Password.
- Support contact details and real business/privacy information for the listing.
- Access to the owner's Duo for guided real-device testing during implementation.

Everything else above has a recommended default. Review this document by pointing to anything you disagree with; there is no need to answer another technical questionnaire. The owner has now authorized implementation and shipping under an active goal.

## Owner follow-up — November 8, 2026

The owner explicitly resumed app implementation and internal TestFlight shipping,
leaving Penpot proposals outside this work. This update supersedes older UI
details: use SF Rounded, consistent rounded cards and equal stat insets; remove
Equivalent travel from visible UI/preferences. The main Time unfolded value
includes the active bounded session and ticks in the foreground. Today cards
support persisted drag-and-drop ordering and a native accessible editor.

History navigation stops at the first recorded period. Its session area scrolls
within a bounded height. Month scrubbing shows the full localized month/day in
the lower-left readout. Patterns aggregate countable folds by home-zone hour,
weekday and month day. Incomplete entries can be deleted with confirmation;
their contributions leave personal totals and current leaderboards, with
durable offline retry. Published historical result versions remain immutable
and retain the existing correction policy.

Only successful Shortcuts checks use a small green tick. Notification switches
use monochrome contrast. Competition result notification choices require joining;
local daily-limit alerts remain independent. Authenticated unjoined users can
continue name/photo review without another Apple grant. The tip jar thanks indie
developer supporters and celebrates verified purchases, respecting Reduce Motion.
Broader App Store and physical-device acceptance remain deferred.

Owner decision, November 8: leaving competition is not a separate action. Users who want to stop participation delete their competition account; personal tracking remains separate. Remove the Leave UI, transport, polling state and server handler. The leaderboard uses This Week / This Month / All Time, retains displayed content while refreshing, and Your Results includes live All Time totals/rank rather than a fabricated finalized award.

## Owner compatibility decision — November 8, 2026

The owner explicitly selected a whole-app required-update screen once a confirmed remotely configured minimum build exceeds the installed build. This supersedes earlier guidance that a release handshake never disables private UI. Unknown/unreachable policy alone must not block offline use; a known requirement remains cached. Saved history/background observations must not be erased or terminally rejected. Policy rollback and a supported new installation can recover access. See [client compatibility](technical/client-compatibility.md), #56 and the separate offline cold-start caveat #57. This is not provider/device acceptance.
