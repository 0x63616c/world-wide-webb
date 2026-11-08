# Folding work tracker

## Current scope: live integration

The coding checklist below is complete. The active goal is live iCloud and Cloudflare setup and integration evidence for staging and production. Implementation is primary-agent only; subagents may review independently. The remaining shipping tasks and owner deferrals are in [deferred shipping work](deferred-shipping-work.md).

- [x] App Attest enrollment recovery
- [x] Immediate account-change privacy fencing
- [x] Typed upload failures, reconciliation and retry policy
- [x] Widget URL routing through setup
- [x] Effective notification locale and English fallback
- [x] Reset raw-history purge
- [x] Automatic-quarantine approval
- [x] Trustworthy local/named-CI check evidence
- [x] First-release tip submission association/readback
- [x] Interrupted-signing recovery
- [x] Persistent verified deployment readiness
- [x] Asset sealing/candidate manifest fix
- [x] Final focused regression/build checks, fixes and completion report


Local evidence: [coding completion](experiments/coding-completion.md). Broader shipping acceptance remains open.
The latest internal preview is [TestFlight 0.1.10 (build 11)](experiments/shortcuts-partition-busy-2026-11-08.md). Signed app/Shortcuts metadata, local compilation, localization, core checks, backend health and internal distribution passed. Startup/setup behavior and protected Join on the physical Duo remain unverified or failing; the live issue checklists keep those open.
The chronological shipping checkpoints below remain evidence. Live integration has resumed under the active goal; CI, storefront/visual review, submission, and post-submission device checks remain deferred.

[Folding — Ship v1](https://github.com/users/0x63616c/projects/9) is the live delivery board, with 33 linked deliverables under the original work orders. GitHub Issues hold acceptance criteria and evidence. Current execution is primary-agent implementation; subagents are limited to independent review. Physical-device evidence is deferred to F13 after submission by owner instruction.

Update issue-body checkboxes as individual requirements are verified, with commit/evidence links. Progress comments supplement these checklists. Close fully accepted issues and tick their work-order entries below; partial or deferred work remains unchecked. These rules are enforced as agent instructions in `AGENTS.md`.

## Current batch

Foundation and personal persistence are in progress. Reducer, journal and local private-mirror integration are tested; live cloud, app, backend and release acceptance remain pending.

## Work orders

- [ ] [F00 — Account and build foundation](https://github.com/0x63616c/folding/issues/1)
- [ ] [F01 — Contract freeze and domain fixtures](https://github.com/0x63616c/folding/issues/2)
- [ ] [F02 — Durable journal, private sync, and device experiment](https://github.com/0x63616c/folding/issues/3)
- [ ] [F03 — Rust runtime, security, and D1 transaction experiment](https://github.com/0x63616c/folding/issues/4)
- [ ] [F04 — Personal domain, history, reset, and export](https://github.com/0x63616c/folding/issues/5)
- [ ] [F05 — App shell, setup, and personal screens](https://github.com/0x63616c/folding/issues/6)
- [ ] [F06 — Widgets and daily reminders](https://github.com/0x63616c/folding/issues/7)
- [ ] [F07 — Competition and public account lifecycle](https://github.com/0x63616c/folding/issues/8)
- [ ] [F08 — Admin and avatar/name moderation](https://github.com/0x63616c/folding/issues/9)
- [ ] [F09 — Result notifications and operational jobs](https://github.com/0x63616c/folding/issues/10)
- [ ] [F10 — Localization, tips, assets, and review](https://github.com/0x63616c/folding/issues/11)
- [ ] [F11 — Beta and release rehearsal](https://github.com/0x63616c/folding/issues/12)
- [ ] [F12 — Submit and verify](https://github.com/0x63616c/folding/issues/13)
- [ ] [F13 — Deferred post-submission physical-device validation](https://github.com/0x63616c/folding/issues/14)

## Setup evidence

- Private GitHub repo and 14 task issues across six milestones created.
- Folding 1Password vault created; project connections saved. Secret values stay outside Git.
- Local toolchain observed: Xcode 27.2 (27B52), Swift 6.4.2, Rust 1.99.1, Node 26.13.0, Ruby 3.3.13.
- iOS 27.2 iPhone Duo simulator is installed; build/capture checks pending.
- Cloudflare support forwarding applied through OpenTofu; rule/verified destination and public MX/SPF verified. End-to-end inbox delivery remains pending.

## November 7 foundation evidence

- Owner approved the R2 usage-based subscription; activation confirmed in Cloudflare.
- OpenTofu 1.13.9/provider 5.28.1 created the private `folding-infrastructure-state` bucket (one resource added).
- Bootstrap state is AES-GCM encrypted; recovery document and separate key saved in Folding 1Password.
- Two independent OpenTofu clients tested real R2 conditional locking: the contender was rejected while the first held the lock.
- Encrypted backup restored and decrypted by a third client. Evidence key: `verification/f7ddc17a-8cea-48d4-bc5d-f59ef8618b1c/state.tfstate`; encrypted SHA-256 `3f1c04f6cd45b47a3cdbb48238079d4e51a8e5f360ef60bdc4d742e438d7a5c9`.
- Swift package built locally; six tests passed, including all eleven reducer fixtures in forward/reversed arrival order. This is domain evidence only, not UI/device/persistence evidence.
- Contract validator: six schemas, forty example/rejection checks passed.
- Production email apply created two resources. Encrypted remote backup saved at `backups/production/20261107T163852Z-c1a7d48c-ce7a-4cfa-b4e2-aedfc0e45dfc.tfstate`, SHA-256 `ea873526f1e3e948d6d8a5f7ba9792ef518dae832227f4584038c9986c9c3231`.
- Downloaded bootstrap recovery document from 1Password and compared it byte-for-byte with encrypted local state: passed.
- Still pending in F00: Apple identifiers/signing/API setup, build/release CI, staging resources, backup retention enforcement/CI identities, and end-to-end support inbox test.

## Durable journal batch

- Implemented FoldingData's WAL SQLite journal, migrations, transactional sequence/event/outbox writes, durable setup tests, immutable interruption capture/import and reset handling.
- Added mirror-work leases with ownership tokens. Actual CloudKit transport, persistent-history imports/checkpoints and conflict quarantine remain pending.
- Two independent processes recorded 50 observations with unique contiguous sequences and exactly 50 mirror jobs. Reopening/retries and injected outbox-failure rollback were tested.
- Independent review found public-reset reconciliation, stale interruption retry and restored source identity issues; each was fixed with regression coverage. Retired store handles are also fenced.
- Installation identity uses device-only Keychain plus a non-backed-up sentinel; real entitlements/reinstall/locked-device evidence remains deferred, not passed.
- Added local bootstrap, format/check scripts and Git hooks. Staged formatting was exercised against staged/working-copy differences and a filename containing spaces; neither index nor working files were modified.
- F02 remains open: private CloudKit integration, account partition coordination, import quarantine/checkpoints, crash-kill experiment and physical-device checks are not complete. CI/toolchain pinning, Rust parity and app UI are still pending.

## Private mirror batch

- Added the Core Data/CloudKit private mirror adapter and synchronization coordinator; tests use actual on-disk Core Data stores with cloud connectivity disabled.
- Schema v3 adds atomic history checkpoints, durable future-generation imports, conflict quarantine and rejected-reset tombstones.
- Local integration covers history pagination/reopen, duplicate saves, save-before-ack replay, reset convergence, checkpoint-write rollback, replacement mirrors and two-journal conflict convergence.
- Independent review found read-error handling, conflict propagation, reset cursor poisoning and unbounded history fetching issues; fixes include bounded fetching and regression coverage.
- Twenty-eight Swift tests, contract checks and formatting passed. No claim of live CloudKit sync, account switching or device validation.
- Remaining F02 work includes account-partition lifecycle, expired-token recovery, old-mirror cleanup, transfer integration, real crash-kill evidence, Apple capability/schema setup and physical checks.
- Agent instructions now require updating issue-body checklists as each item is verified, plus closing fully accepted issues and updating this tracker. Verified progress has been checked in issues #1–#3.

## Private-history recovery batch

- First attachment and expired Core Data history tokens recover retained records through a pinned, paginated snapshot. Concurrent writes replay from the captured boundary; failed imports/checkpoint writes restart safely.
- Schema v4 indexes deferred generations and bounds their import/migration batches; unrelated future records are not repeatedly decoded.
- Independent review identified first-attachment data loss after history pruning and unbounded deferred decoding. Both were fixed with regression tests; focused follow-up found no new blocker.
- `scripts/check` passed 34 Swift tests (6 domain, 28 data), six schemas/forty contract checks and formatting. Tests include real Core Data history pruning, writes during snapshot pagination, injected failures, 1,100 deferred records and v3 queue migration.
- Account partition/fencing, mirror cleanup/transfer integration, live CloudKit setup and deferred physical checks remain outstanding. This batch verifies local recovery only.

## Account-partition boundary batch

- Added a durable shared/exclusive file-lock fence around every routed journal transaction; suspension invalidates old readers/writers, including an already-open journal in another OS process.
- Added app-owned private partition lifecycle, separate hashed account directories, same-account reuse, safe transition supersession and shutdown/recheck around async mirror loading.
- Returning to a partition preserves its history, invalidates a spanning tracking session and clears stale public enrollment/work/setup leases. Ordinary same-account launch retains valid session continuity.
- Independent review identified restored routing authority on a new installation. Route/lease identity binding and a restoration regression fixed it; focused recheck found no remaining blocker.
- `scripts/check` passed 40 Swift tests (6 domain, 34 data), six schemas/forty contract checks and formatting.
- Still pending: real CloudKit account lookup/notification wiring, app/widget/export cache invalidation, signed capability validation and live account-change evidence. Local tests explicitly disable cloud transport.


## Apple build foundation batch

- Added a reproducibly generated Xcode project linking FoldingKit, a deliberately debug-only launch harness, and an app-hosted journal persistence test. Release compilation is blocked until the production composition replaces the harness.
- Pinned observed tool versions, Ruby/Fastlane dependencies and lockfile; added Fastlane `verify`/`verify_app`, exact Apple toolchain/runtime validation and optional Apple bootstrap.
- Xcode 27.2 (27B52) built the app for the Duo simulator; Fastlane `verify_app` passed its app-hosted persistence test. The 40 core tests/contracts/formatting also passed. This is not signing, physical tracking, product UI or App Store screenshot evidence.
- Independent foundation review found no blocking code defect; architecture documentation now records the XcodeGen decision consistently.
- Added an unprivileged GitHub contract-check workflow. [First run42396408581](https://github.com/0x63616c/folding/actions/runs/42396408581) was rejected before job startup by GitHub account billing/spending limits; owner action requested. No CI pass is claimed. Native hosted CI is not enabled: the current hosted image has Xcode 27B48 and Duo runtime27.1 rather than the verified local pins. No self-hosted repo runners were registered at this checkpoint.
- Owner now permits implementation agents for speed. Backend Rust work is assigned separately; primary retains credential/deployment access and integrates results.

## Owner CI deferral

The owner deferred GitHub CI while arranging runners in another project. Automatic workflow triggers are disabled; no CI retries until requested. Continue local core/backend/simulator/Fastlane validation. Restore CI and verify runner isolation before release acceptance; the earlier billing rejection remains historical evidence, not an active request for owner action.

## Granular delivery tracking

The original fourteen work orders now have 33 linked deliverable issues (#15–#47), with scope-specific completion evidence and status labels. [Deliverables](https://github.com/0x63616c/folding/issues?q=is%3Aissue+label%3Atype%3Adeliverable) distinguish verified local components from live integration and release requirements. Parent issues show their sub-issue progress. A private GitHub Project is requested; creation awaits the owner's Projects-scope authorization. Do not treat an issue-count percentage as an effort-weighted shipping estimate.

## Guided setup state and analytics integration

- Added a durable setup flow with transactional test-lease creation, committed opening/closing receipt correlation, expiry/cancel/restart behavior and preserved prior completion records.
- Independent review found stale cached success after receipt quarantine and the reset/device restart step. Both are corrected with regression coverage; focused recheck found no blocker.
- Added an atomic journal read feeding the new calendar analytics off MainActor. Setup-test events remain excluded. Full UI/intent composition, persisted transfer selection and live account wiring are still pending.
- Package validation passes 57 Swift tests (18 domain,39 data); five new data tests cover setup completion/reopen, cancellation/expiry/reset, atomic rollback, invalidated receipt and journal analytics.

## Native app integration and localization batch

- Replaced the launch harness with the native Today/History/Leaderboard shell, a local development composition root and background opening/closing App Intents that return only after journal commit. Production compilation remains gated until real account/entitlement composition is complete.
- Setup uses committed test receipts; test observations do not affect personal totals. Theme preferences persist, including the initial home timezone; travelling does not silently choose a new home timezone. Existing History refreshes after journal/foreground changes. A cancellable midnight task and system significant-time-change refresh keep the displayed day current.
- Fastlane app-hosted verification passed eight tests, including real local journal setup/count/history/reset and preference regressions. This does not establish physical Shortcuts delivery, locked-device execution, live iCloud or production signing.
- Added 125 localized strings across ten agreed locales; local checks now include catalog validation and ten mutation tests. Xcode compiled the real app catalog and App Intent metadata. Full language/screenshot acceptance remains open.
- Shared timezone vectors now enforce Swift/Rust canonical fixed-offset parity. Contract validation executes fourteen additional auth request fixtures, for 54 schema/example checks.
- Remaining in #27: verified localized automation instructions/handoff, production account composition and integration acceptance. Full release scope remains in the delivery board.

- Follow-up review fixed clock-change rescheduling of midnight refresh and added a clock-only running-duration projection bounded to the home day. The combined Fastlane app-hosted suite passes eleven tests; catalog validation and ten mutation tests also pass. No per-second journal writes or full-history replay were added.

## Protected export integration

- Added a consistent journal export snapshot, generation/account fences, protected backup-excluded temporary files, and streamed JSON/CSV ZIP output. Cleanup runs on share completion/cancellation, foreground expiry, reset and account suspension. Snapshot/document arrays remain materialized; output writes stream off MainActor.
- The app queues only an opaque export ticket while dismissing Settings; the native share host resolves its URL on activation. Reset invalidates queued/active sheets and late preparation results. Last event now reflects the journal's latest local observation.
- Independent integration review found export cleanup failures could hide healthy tracking; isolated maintenance errors from data refresh and added a filesystem-failure regression.
- Evidence: storage commit `605ccbf`, UI commit `ec0d69c`; 74 package tests (27 domain, 47 data), including eight export tests; seventeen combined app-hosted tests pass through Fastlane. ZIP output was independently extracted and compared. No physical file-protection or native share visual acceptance is claimed.
- #31 remains open for public reset/pending-state integration, live account/CloudKit behavior and complete visual acceptance. #30 retains private transfer persistence. Apple account setup is awaiting the user's App Store Connect sign-in; the existing 1Password shell's metadata lookup timed out awaiting authorization, with no credentials read or printed.

## Real simulator startup correction

- Independent native UI QA discovered the unsigned simulator build could not access Keychain (OSStatus -34018), despite injected-journal tests passing. Removed Fastlane's blanket signing disable and added SDK-scoped ad-hoc simulator signing with a synthetic `FOLDINGDEV` application/keychain namespace. This is simulator-only and is not an Apple team, certificate or production entitlement claim. Production composition remains compile-gated.
- Xcode embeds the simulator entitlements in `__TEXT,__entitlements`; the ordinary signature-entitlements output is empty, so it is insufficient evidence on this build. The real default-runtime Keychain/sandbox reopen regression now passes; eighteen combined app-hosted tests passed. Native visual QA is resuming against the corrected build without deleting the existing development data.
- Removed duplicate “Tracking unavailable” copy from the empty error screen.

## Private tracking-phone transfer batch

- Schema v5 persists explicit private phone selections and per-source sequence watermarks. Late unknown observations from inactive phones remain available in raw export but do not enter the main summary. Transfer selection/watermark knowledge survives reset; handover interruptions prevent sessions spanning a transfer away and back.
- Mirror outbox, recovery and replacement paths now carry transfer records. Independent review found an unmirrored-original conflict could diverge across stores; monotonic replicated transfer rejections now supersede stale leases and survive reset/rebuild. Arbitrary unknown source selection is rejected.
- Storage evidence: `2cb5a32`; 27 domain plus 58 data tests pass, including eleven transfer tests with populated two-journal/Core Data convergence, account isolation, migrations and conflict/replacement/reset recovery.
- App composition adds explicit use-this-phone command and selected local identity; the combined app suite passes nineteen tests, including private selection retaining prior known observations while excluding a later old-phone close. Public enrollment is not silently transferred by this private-only command. Settings presentation is pending.
- #30 remains open for bounded obsolete mirror-record cleanup and corrupted-reset recovery UX. Live iCloud/hardware and cached performance are not proven by local tests.

## Apple account bootstrap

- Apple login is complete. The existing 1Password API key works through Fastlane; four production/staging app/widget bundle identifiers are registered.
- Both App Store records are created and verified: production `6832059501` (Folding: Duo Fold Tracker), staging `6832060416` (Folding Staging). Plain Folding was unavailable. Both are Prepare for Submission, with no submitted build.
- Fastlane now provides repeatable scoped inventory and idempotent bundle registration; public identifiers live in `fastlane/app-identifiers.json`. See [bootstrap evidence](experiments/apple-account-bootstrap.md).
- #28 remains open for capabilities, groups/containers, signing/recovery, production entitlements and archive verification. CI remains owner-deferred.

## Private-history recovery and cleanup

- `53ba831` adds bounded obsolete mirror cleanup, migration/backfill coverage and authoritative reset health; 27 domain and 65 data tests passed at that checkpoint. These are local Core Data/journal tests, not live iCloud evidence.
- `943fbb0` adds explicit tracking-phone selection UI. `63bfe7e` adds recovery UI and shared export/reset actions, with authoritative reset eligibility and 137 keys across ten locales. Fifteen presentation tests passed; recovery visual acceptance remains pending.
- Controller health integration and compact incremental analytics are in progress. #30 remains open until integrated recovery acceptance; broader live account and performance requirements remain separately tracked.

## Implementation-first feature integration

The owner explicitly deferred independent reviews and comprehensive verification until the feature flows are implemented. The following are implementation/compilation checkpoints, not final acceptance:

- `1476aa1`, `6f5ec17`: setup guidance, native widget extension, notification settings, StoreKit tip jar, review eligibility and runtime widget publication. Combined simulator build passed.
- `88adea2`, `089c896`: compact derived analytics/history and durable daily-limit claims. `22a1c77` connects CloudKit account lifecycle and OS daily-limit delivery. Real cloud/container/signing and final notification behavior remain pending.
- `5bfaaa1`, `b658fcb`: Rust enrollment, signed competition ingestion/join/transfer, live leaderboard reads and privacy lifecycle implementation; native/Wasm compilation passed, final runtime acceptance deferred.
- `380aea9`, `380beab`, `ea86540`: native Apple authorization, authenticated competition client, core community actions, results/profile media/reporting, and durable leave/delete recovery. Combined simulator build passed. Live API deployment and full event-upload/public-reset integration remain unfinished.
- `d17ee5e`: competition presentation, native Apple sign-in control, results/share/profile/report controls and pending removal states. Final visual/localization acceptance is deferred.
- `05d83a3`: public static website built; not deployed. Fastlane release metadata, isolated screenshot target and release artifact automation are in progress.
- `103fdb1`: device entitlement templates exist; this does not establish registered/associated cloud containers/groups or valid signing profiles.

GitHub deliverables and Project statuses were reconciled for live iCloud, private-history cleanup, widgets/alerts, tips, website and screenshot automation. No broad acceptance issue was closed based solely on a build.

### Infrastructure implementation checkpoint

`3420c30` defines isolated D1/R2/queues/admin Access and opt-in routing for staging/production. Provider validation and additive production plan inspection passed. Production avatar R2 was provisioned with public access disabled; the partial apply is recorded and encrypted remote state backed up with byte-for-byte recovery verification. D1/queues/Access require broader deployment-token scopes (current bootstrap token returns 401/403). Routes remain disabled; no backend deployment is claimed. See issue #32 for backup identity and remaining acceptance.

Infrastructure follow-up: `d672a16` manages the deployment credential with OpenTofu; securely saved in the Folding vault. Staging and production D1/private R2/queues/admin Access now provisioned successfully with no destructive changes, and both encrypted states backed up. The token-scope blocker is resolved. Worker deployment, routing, runtime secrets and final acceptance remain open in #32. Private `0x63616c/folding-signing` repository exists; signing assets remain pending.

## Latest shipping checkpoint — November 7

This supersedes pending-state descriptions in earlier chronological checkpoints above.

- Apple groups, containers and required capabilities are configured. Fastlane generated the distribution certificate and four profiles; profile entitlements and encrypted signing recovery were checked. Signed archives and CloudKit schema deployment remain pending (#28–29).
- Separate app-scoped Apple sign-in/APNs keys and independent runtime cryptographic keys are saved and recovery-verified in Folding 1Password. See [Apple setup](experiments/apple-account-bootstrap.md) and [runtime recovery](experiments/runtime-credential-bootstrap.md). Secret installation and live integrations remain pending.
- Both website Workers are uploaded; staging is publicly routed and returned HTTP 200. Production routing remains disabled. Scoped canonical-redirect permissions and Access issuer discovery are now applied through OpenTofu (#32, #41).
- Runtime bindings include explicit admin access, APNs configuration and the Rust jobs queue consumer. D1 migration checksum tooling is implemented; remote migration/rollback acceptance remains pending (#32).
- Backend batches `943c358`, `08edcc7`, `2e4bea8` implement avatars/moderation/APNs, queue dispatch/operational controls, and previewed historical corrections. Compilation and SQL preparation passed; runtime/service/concurrency acceptance remains deferred. Remaining case/job management is in progress (#35–37).
- Native pending-avatar recovery and moderation status are committed in `e4e41d9`; app/widget compilation passed. Tip jar review scene is committed in `f1f7711`; screenshot build-for-testing passed. Actual captures and final UI review remain pending (#35, #40, #42).
- App Store territory availability is configured and read back. Small and medium tip products have verified ten-locale metadata, US prices and availability. Large-tip reconciliation is in progress. Apple still reports incomplete metadata until reviewer assets and remaining requirements are satisfied; no purchase/submission acceptance is claimed (#40).

GitHub #28, #32 and #40 checklists reflect these partial completions. CI and physical-device deferrals remain unchanged. No build has been submitted to Apple.

## Automatic tint update

- [x] [#50 — Automatic white/dark and black/light tint](https://github.com/0x63616c/folding/issues/50): removed tint settings; verified 74 core tests, 29 simulator tests, localization and light/dark captures; Apple confirmed TestFlight 0.1.6 (7) VALID and distributed to Folding Internal. Implementation `187a05d`. App Store submission/device acceptance remain separate.

## Today and Join follow-up

- [x] [#51 — Card heights, chart alignment and profile prefilling](https://github.com/0x63616c/folding/issues/51): shipped TestFlight 0.1.7 (8), Apple VALID and confirmed in Folding Internal. Implementation `a8a6e85`; 74 core tests, 30 simulator tests, localization and rendered fixtures passed. Device authorization/Join/upload acceptance remains separate.

## TestFlight refinements — November 8

- [x] [#52 — Live stats, History and presentation](https://github.com/0x63616c/folding/issues/52): implementation `480725e`, shipped as TestFlight **0.1.8 (9)**, Apple **VALID** and confirmed in **Folding Internal**. Includes full month-selection dates, ticking main duration, patterns, persisted card reordering, bounded History, retired travel UI and presentation/account/tip refinements.
- [x] [#53 — Incomplete-entry deletion](https://github.com/0x63616c/folding/issues/53): local/private replay, offline ownership retries and current leaderboard suppression implemented and locally verified; migration 0018 and matching Workers verified on staging/production; same signed TestFlight build distributed. Published historical results retain versioned correction policy.

[Release evidence](experiments/testflight-refinements-2026-11-08.md) distinguishes the 79 core / 34 simulator / 30 Rust host / eight workerd checks and rendered fixtures from unverified native drag/scrub interaction and real device/provider flows. Broader #25/#27/#33/#35/#37/#40/#47 acceptance stays open; no physical-device or App Store pass is claimed. The owner resumed app shipping and paused Penpot work. Existing unrelated experiments remain preserved in the original checkout.

## TestFlight crash investigation — November 8, 2026

- [x] [#54 — Fix shared-storage suspension crashes](https://github.com/0x63616c/folding/issues/54): retrieved all three Apple crash-feedback submissions (builds 2, 6 and 8), identified `0xdead10cc`, and implemented storage-wide background execution protection, expiry/rollback and main-thread UIKit acquisition. Seven regression tests and all 86 core tests pass; 38 app-hosted simulator tests pass; TestFlight **0.1.9 (10)** is Apple **VALID** and verified in **Folding Internal**, from `7782c16`. [Evidence](experiments/testflight-crashes-2026-11-08.md). Physical suspension/Shortcuts confirmation remains deferred to #47/F13.

## Shortcuts busy-error fix — November 8, 2026

- [x] [#58 — Shortcuts partition-busy failures](https://github.com/0x63616c/folding/issues/58): reproduced the reported `FoldingData.PartitionError error 3` through concurrent account startup and brief route-lock contention. Same-account callers now share initialization; bounded recording retries retain observation identity/time and respect account/reset fences. All 89 core and 41 app-hosted simulator tests pass. TestFlight **0.1.10 (11)** is Apple **VALID** and verified in **Folding Internal**, from `da0ac00`. [Evidence](experiments/shortcuts-partition-busy-2026-11-08.md); physical overnight/Shortcuts acceptance remains deferred to #47/F13.


## API cost and abuse protection — November 8

- [ ] [#55 — API resource protection and idle-cost reduction](https://github.com/0x63616c/folding/issues/55): local code implemented and verified; staging/production activation and updated client distribution remain open. Includes pre-D1 burst limits, selective/hourly maintenance, ten-message queue batches, indexed score deltas, shared one-minute uploads, persisted cooldowns, bounded read caching and sampled safe route logs. See [implementation and evidence](experiments/resource-protection-2026-11-08.md). Existing physical-device/load/CI/shipping deferrals remain unchanged.


## App compatibility and offline startup — November 8

- [x] [#56 — Minimum supported app build](https://github.com/0x63616c/folding/issues/56): whole-app gate chosen by owner; local implementation verified (31 Rust, 11 Worker/D1 and eight focused simulator tests). Provider activation and updated TestFlight/device evidence remain separate. See [compatibility contract](technical/client-compatibility.md).
- [ ] [#57 — Reliable offline cold startup](https://github.com/0x63616c/folding/issues/57): local implementation verified through 93 core and 51 app-hosted tests, including cold reopening with cloud lookups unavailable, continued recording/history, same-account availability notifications and account/installation fences. See [evidence](experiments/offline-cold-start-2026-11-08.md). Updated TestFlight, physical airplane-mode/Shortcuts and cloud reconnection acceptance remain open in #47/F13; do not mark them passed.

### App copy cleanup — November 8, 2026

- [x] [#25](https://github.com/0x63616c/folding/issues/25): review shipped app/view, widget, notification and Intent wording; remove repeated setup/join/tip explanations, duplicate profile labels and daily-limit body; shorten errors, results and removal copy across ten locales. Persist the product-copy rule. Local app compilation, 207-key catalog validation, ten localization regressions and compiled ten-locale/40-plural runtime checks pass. Final display/device acceptance remains open in #25/#47.
