# Folding work tracker

Repository consolidation is complete. Active issues belong to `0x63616c/world-wide-webb`;
references below to old `folding` issue/PR numbers are historical. That source repository
was snapshotted into private `github-archive` and deleted by owner request.

## App Store country policy — November 11, 2026

Version 1.0.0 is publicly listed in the US and UK. Apple reported 173 available
territories and contests restrictions in Afghanistan and Morocco. Country selection
is now owned by `fastlane/app-availability.json`, with those two territories excluded
and future storefronts enabled. The existing Fastlane availability command reconciles
and reads back the policy; automatic App Store releases apply it before listing work.
Release invariants passed locally: 57 tests, 741 assertions. Live reconciliation is
pending merge and required CI checks.

## Production-only cleanup — November 10, 2026

The owner requested deletion of the staging app, data and infrastructure. All three
Cloudflare staging Workers and 14 managed resources were deleted through the existing
staging state; its remote state/backups and dedicated state/runtime vault items were removed.
Production resources were excluded from the destroy plan. Build/release/configuration
support now accepts production only; the site builds and publishes once. Historical SQL
migrations and dated experiment receipts remain unchanged. Folding Staging was removed from App Store Connect, its dedicated service key was
revoked and both staging provisioning profiles were deleted. All three dedicated staging
vault items were deleted and the shared setup note was updated. The staging widget ID
and app group were removed; revoked profiles were removed from `signing/folding` in
`23ef0fc4b35de6f7e948b9568bb05cfeca13dd70`. Apple refuses deletion of the used main
App ID and does not permit CloudKit container deletion.

## Current scope: internal TestFlight, then App Store preparation

Implementation and live infrastructure are present. The current owner request is to test the
latest app through internal TestFlight, make product changes, then prepare App Store submission.
See the [November 9 delivery checkpoint](experiments/monorepo-testflight-2026-11-09.md). Existing
provider/device and final-store deferrals remain in [deferred shipping work](deferred-shipping-work.md).
Delegated reviews require an explicit owner request.

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
The latest verified internal distribution is **1.0.0 (15)** in **Folding Internal**, with
Apple VALID/group readback in the November 9 checkpoint; earlier
versioned entries below remain historical evidence. A signed archive or upload alone does not
establish Apple processing, internal-group assignment or physical-device behavior. Full storefront,
App Store submission and owner-deferred device checks remain separate from internal beta delivery.

[Folding — Ship v1](https://github.com/users/0x63616c/projects/9) is the live delivery board, with 33 linked deliverables under the original work orders. GitHub Issues hold acceptance criteria and evidence. Current execution is primary-agent implementation; delegated reviews require explicit owner authorization. Physical-device evidence is deferred to F13 after submission by owner instruction.

Update issue-body checkboxes as individual requirements are verified, with commit/evidence links. Progress comments supplement these checklists. Close fully accepted issues and tick their work-order entries below; partial or deferred work remains unchecked. These rules are enforced as agent instructions in `AGENTS.md`.

## Join verification and Settings build identity — November 8, 2026

The owner reproduced unauthorized Join after fresh signup. Production readback confirmed successful Apple sign-in/key enrollment and two unused session-bound Join challenges at assertion counter zero. A signed assertion using Apple’s documented assertion extension names reproduced a local verifier rejection. [Fix `35a98d6`](https://github.com/0x63616c/folding/commit/35a98d6f4f30d05fc7d092bcd234a7895618854d) separates assertion/enrollment metadata names while preserving required distribution/build policy, signature/body/counter/challenge checks. Seven domain contracts, 24 Worker unit tests and nine compiled runtime tests passed, including valid Join, body tampering and replay. The first fix deployed as Cloudflare version `81519196-59e7-49f6-a396-cb978ae141dd` did not resolve the owner’s retry. Live rejection diagnostics then captured 99 authenticator bytes and flags `0xc0`, which the parser rejected before signature verification. [Correction `0abd207`](https://github.com/0x63616c/folding/commit/0abd207bb5fc2dcefdbff19c70308bbe892147d8) supports that signed assertion layout and either complete Apple metadata naming scheme without relaxing required metadata, distribution/build, signature, body, challenge or replay checks. Seven domain contracts, 25 Worker unit tests and ten compiled runtime tests passed, including a red-before/green-after HTTP Join regression. It is live as Cloudflare version `817c62ed-ed8e-4bc6-85c8-ef6aa6fff8cc`; health/readback verified the exact source and unchanged remaining runtime bindings. Owner-device Join is verified in #33: the owner reported success, live enrollment returned 200 and production showed joined membership, one epoch and an advanced assertion counter. Raw device proof bytes were not retained; reset/leave/delete and broader device checks remain open. [Evidence](experiments/join-verification-2026-11-08.md).

[Settings change `079f64b`](https://github.com/0x63616c/folding/commit/079f64b) shows the installed version/build and verified TestFlight environment. Debug simulator and unsigned Release device builds plus localization checks passed. It is implemented for the next app build, not yet distributed. Existing Reset history confirmation was verified in source. Broader UI/device and shipping acceptance stays open in #25/#47.

## Immediate profiles and black admin pages — November 8, 2026

The owner removed mandatory manual approval. [Implementation `bb44be8`](https://github.com/0x63616c/folding/commit/bb44be8e54f4abaf00e403ff270ce36a31493c92) publishes valid names and processed photo derivatives immediately, retains retrospective removal/ban controls, shares full navigation and a black theme across every admin page, and redirects the admin root to `/admin`. Seven domain contracts, 25 Worker unit tests, 11 compiled runtime tests and the app build passed; local browser checks covered People and Failed jobs. Production version `2f7665d8-9c91-4541-8b79-f48ba7354276` serves that exact source; remaining provider bindings/compatibility were read back unchanged. The owner's already-validated pending name/photo were released in a guarded audited batch (`3391048d-f53b-46e9-a307-84dd58fcf77e`); readback showed zero pending names/avatars. No personal-history mutation or schema migration. [Evidence](experiments/profile-publication-admin-2026-11-08.md). Broader #35/#36 and deferred shipping acceptance remains open.

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

- [x] [#55 — API resource protection and idle-cost reduction](https://github.com/0x63616c/folding/issues/55): implemented, staging/production deployed with preserved settings and all 19 checksum migrations; Fastlane-distributed 0.1.11 (12) to Folding Internal with exact Apple readback. See [release evidence](experiments/api-offline-release-2026-11-08.md). Includes pre-D1 burst limits, selective/hourly maintenance, ten-message queue batches, indexed score deltas, shared one-minute uploads, persisted cooldowns, bounded read caching and sampled safe route logs. See [implementation and evidence](experiments/resource-protection-2026-11-08.md). Existing physical-device/load/CI/shipping deferrals remain unchanged.


## App compatibility and offline startup — November 8

- [x] [#56 — Minimum supported app build](https://github.com/0x63616c/folding/issues/56): whole-app gate chosen by owner; local implementation verified (31 Rust, 11 Worker/D1 and eight focused simulator tests). Default-zero policy is deployed in both environments and policy-aware 0.1.11 (12) is internally distributed; later floor activation and device evidence remain separate. See [compatibility contract](technical/client-compatibility.md).
- [ ] [#57 — Reliable offline cold startup](https://github.com/0x63616c/folding/issues/57): local implementation verified through 93 core and 51 app-hosted tests, including cold reopening with cloud lookups unavailable, continued recording/history, same-account availability notifications and account/installation fences. See [evidence](experiments/offline-cold-start-2026-11-08.md). Updated TestFlight 0.1.11 (12) is distributed; physical airplane-mode/Shortcuts and cloud reconnection acceptance remain open in #47/F13; do not mark them passed.

### App copy cleanup — November 8, 2026

- [x] [#25](https://github.com/0x63616c/folding/issues/25): review app/view, widget, notification and Intent wording; remove repeated setup/join/tip explanations, duplicate profile labels and daily-limit body; shorten errors, results and removal copy across ten locales. Persist the product-copy rule. Local app compilation, 207-key catalog validation, ten localization regressions and compiled ten-locale/40-plural runtime checks pass. Final display/device acceptance remains open in #25/#47.

## Review request timing — November 8

- [x] Owner-approved local policy update in [#40](https://github.com/0x63616c/folding/issues/40): remove the seven-day wait, retain three separate recorded-use days and completed-summary safeguards, and allow another request attempt after 30 days. Existing persisted attempt timestamps are retained.
- Verification: compiled and ran the actual `ReviewEligibility.swift` policy in a temporary native Swift harness; insufficient use, eligibility before day seven, future setup, immediate repeat, just-before/exact 30-day boundary, persisted cooldown and clock rollback checks passed. Focused Swift formatting passed; no simulator required.
- Source/spec changes are committed on `codex/review-request-timing`; distribution remains pending. Apple controls prompt display; StoreKit/visual/device acceptance and the broader #40 remain open.

## Durable capture — November 8, 2026

- [x] [#59 — Durable Shortcuts capture and persistent retries](https://github.com/0x63616c/folding/issues/59): verified local component delivered for PR review, with protected schema-v9 inbox, persisted FIFO leases/backoff and context-preserving replay. All 105 core and 43 app-hosted simulator tests pass, including actual kill/reopen recovery. [Evidence and rollback constraint](experiments/durable-capture-2026-11-08.md). Not merged or shipped; broader #27/#43 integration/release and #47/F13 physical acceptance remain open. Offline startup remains #57.

### Combined rollout — November 8, 2026

- [x] [PR #61](https://github.com/0x63616c/folding/pull/61) merged as `4f8180d`. Combined checks: 109 core, 53 app-hosted, 34 Rust and 15 Worker/D1 tests. Both API environments preserve current bindings/flags and expose minimum 0; Apple confirms VALID build 12 in Folding Internal. [Release evidence](experiments/api-offline-release-2026-11-08.md). No forced-update activation, physical acceptance, CI, storefront review or App Store submission is claimed.

November 8 competition cleanup: removed the active Leave and manual profile-approval flows; simplified period switching, live All Time results, podium/profile and Shortcuts status. Combined local verification passes 109 core, 56 app-hosted, 34 Rust and 16 Worker/D1 checks. Version **0.1.12 (13)** is VALID and independently confirmed in Folding Internal; staging/production health, 20 checksum migrations, preserved controls and build-13 App Attest support are verified; broader #25/#35/#36 and physical-device acceptance remain open. See [cleanup evidence](experiments/leaderboard-cleanup-2026-11-08.md).

### Admin-managed required updates — November 8, 2026

- [x] [#65](https://github.com/0x63616c/folding/issues/65): Operations owns the persisted minimum build, with existing Access/CSRF/revision/audit safeguards, default 0, bounded policy caching and no deployment-variable override. Local Rust/Wasm checks and 16 Worker/D1 tests verify activation, rollback, authorization, bounds and replay/stale edits; staging/production now have all 20 checksum migrations, the old variable is absent, and both policies remain 0. Actual staging admin activation/rollback and the production form are verified. See [evidence](experiments/admin-minimum-build-2026-11-08.md).

November 8 follow-up: omit the misleading “Building a comparison” fallback from live and finalized results when population is below 20 or no percentile is available. Folds/rank remain visible and the comparison threshold is unchanged. Swift formatting and 202-key × ten-locale checks pass; not yet included in an installed TestFlight build.

## Profiles and milestones implementation — November 8

- [ ] [#71](https://github.com/0x63616c/folding/issues/71), **Deferred formal acceptance**, under F07/#8: implementation/internal 0.1.13 (14) complete; retain the two unchecked formal criteria in the [single-release plan](technical/profiles-and-milestones.md). All profile, progress, collection, featuring and celebration behavior ships together.
- [x] Implement and verify the six stable catalog IDs, next-target reveal, accumulated awards, distinct UTC days, correction thresholds, safe-count validation and contribution-delta cancellation. The Rust workspace passes 44 tests (six domain units, seven contracts, 31 Worker units), including ten new milestone/projection/schema tests.
- [x] Add an unapplied additive migration defining bounded projection/backfill state, counted-event/day indexes, grants, optional featuring and durable acknowledgments. Local schema test rejects unearned featuring, clears the feature on grant revocation and cascades account deletion while retaining acknowledgment across revocation.
- [x] Implement guarded service routes, bounded backfill and scoring/lifecycle projection integration, typed client models, full profile/milestone UI, artwork/localization, privacy/accessibility and integrated release evidence. The HTTP amendment defines intended operations; no new route or migration is deployed.

This is an internal implementation checkpoint, not a feature release or broad acceptance. No simulator, credential lookup or deployment was used. Existing CI/storefront/visual/submission/device deferrals remain.

### Profile service and client model checkpoint

- [x] Implement locally verified owner/member profile and milestone routes, featured-badge/acknowledgment commands, generation/revision/visibility guards, bounded resumable backfill and scoring/deletion/moderation/reset integration. Shared Rust/Swift fixture, typed client models/API, optional leaderboard badge field and migration 0021 are present.
- [x] Pass 46 Rust host tests, optimized Wasm build and 21 compiled Worker/D1 tests. Unsigned device build and generic-simulator build-for-testing pass; actual Swift model validation/encoding passes a native harness. No simulator boot or app-hosted execution is claimed.
- [x] Complete UI navigation/progress/collection/featuring/celebrations, account-scoped caches, badge artwork, localization/privacy/accessibility, broader lifecycle/load checks and staged integrated release verification.

[Detailed evidence and remaining requirements](experiments/profile-milestones-implementation-2026-11-08.md). #71 remains **In progress** and all product parts remain one release; nothing was deployed or distributed by this checkpoint.

### Profile interface and account cache checkpoint

- [x] Implement profile summaries/member browsing and Settings/podium/tie-group navigation; next-only progress, complete earned collection, badge detail/featuring and grouped safe unlocks. Add six reproducible template vector artworks, account/generation/revision-fenced caches, durable feature/ack retry identity, offline save behavior and pending reset/deletion guards.
- [x] Pass 65 app-hosted tests and direct production-view renders; retain 46 Rust/21 Worker checks from the service checkpoint. Verify 237 keys × ten locales, ten localization regressions, Swift formatting and website build. Initial unsigned Keychain test configuration was corrected; final signed tests pass. Preserve existing simulators and verify shutdown/deletion of every task-created test device.
- [x] Add six unchecked, explicitly owner-deferred physical feature checks to #47/F13. Update join/reset and privacy/deletion source copy, including badge retention and competition-data access.
- [x] Finish realistic large-history/lifecycle/race checks, release capability gating, integrated staging verification and the single combined internal release. No provider deployment or distribution at this checkpoint; formal visual/native-language/accessibility/CI/submission/device deferrals are not passes.

See [UI evidence and exact limits](experiments/profile-milestones-implementation-2026-11-08.md#app-interface-and-cache-checkpoint). #71 stays **In progress** under F07.

### Milestone corrections and lifecycle checkpoint

- [x] Verify compound-keyset backfill with 100,000 folds, 391 pages, hidden partial awards and retained valid featured choice across bounded correction; earned dates reconcile to corrected history. Local resource measurements are not provider acceptance.
- [x] Verify phone transfer/old-epoch rejection, reset during backfill, account deletion of ready/partial projections and protected admin quarantine/reinstatement with no repeated acknowledged unlock. 47 Rust checks, ten milestone and 17 general/admin runtime cases pass.
- [x] Gate internal preview archive/distribution on accepted `profiles.milestones`, contract 1 and matching source; seven release regressions / 20 assertions pass.
- [x] Complete staging acceptance and one integrated TestFlight release; reconcile exact provider/Apple evidence. #71 remains In progress; all recorded broader shipping deferrals remain open.
November 8 crown/results follow-up: selected cartoon crowns now sit clockwise at the top right with a closed brim. Podium medals have matching rings; gold alone shimmers/emits small particles, respecting Reduce Motion. Percentile displays and unused client fields are removed. All 57 app-hosted checks and 201-key × ten-locale validation pass; direct native previews and a verified 48-frame animation are exported. [Evidence](experiments/leaderboard-crowns-2026-11-08.md). This component is locally verified; internal distribution and broader #25/#34/#47 acceptance remain open.

November 8 follow-up: the owner removed crowns after preview review. Crown artwork, fitting/mask/rotation components and all avatar/result/share crown renderers are removed. Keep podium rings and gold-only motion; renamed the direct-render snapshot to cover the leaderboard. This supersedes the crown appearance choice above; no new TestFlight distribution is claimed.

- [x] Verify #71 staging schema (21 checksums), exact service source, unchanged bindings/limits/policy and isolated live owner/member/feature/ack/correction/restriction behavior; actual Swift models validate returned payloads and fixture cleanup is confirmed. Production and Apple distribution remain unchanged at this checkpoint. See [staging evidence](experiments/profile-milestones-implementation-2026-11-08.md#staging-acceptance-checkpoint).

### Profiles and milestones delivered internally

- [x] Merge #74 at `091b09f`; ship the entire feature in **0.1.13 (14)**. Apple VALID build `08771b6f-1dcf-451e-8a4e-03fd5ac0efd1` is independently confirmed in **Folding Internal**; immutable archive/IPA/dSYM and feature/Apple proof hashes are sealed and read back.
- [x] Verify both API environments at the same source, all 21 checksum migrations, scoped milestone capability, preserved bindings/limits/preview flags and minimum 0; publish/read back badge policy copy. Live staging Queue finishes backfill without owner-read polling; fixtures are removed.
- [ ] #71 remains **Deferred formal acceptance** for its two original unchecked visual/accessibility/native-language criteria, preserved in #25 and #47. Implementation/internal release is complete; broader shipping, CI, submission and physical acceptance remain open.

[Exact release evidence and limits](experiments/profile-milestones-implementation-2026-11-08.md#single-integrated-internal-release).

## November 8 owner follow-up — #76 / #77 / #78

- [x] #76: flat progressive badges, private awards, direct profile edits, shared/responsive dashboard cards and leaderboard polish.
- [x] #77: original pre-join history import for new and existing accounts, with the local 18 + 41 = 59 regression.
- [x] #78: opt-in grouped private badge push and owner-only Milestones routing.

Verified local component delivery: [PR #80](https://github.com/0x63616c/folding/pull/80). Implementation evidence: [owner follow-up](experiments/owner-polish-2026-11-08.md). Live deployment/TestFlight, final visual/native-language review and #47/F13 APNs/device acceptance remain separate and unverified.

### App Store listing preparation on current main

- [x] Adapt Tendr's templates to all five current scenes including Patterns and Milestones, with committed copy/frame/fixtures and app/widget privacy manifests. Clean source `6a768f3` produces 150 images in ten locales using actual native Duo Open/Closed geometry.
- [x] Complete independent visual review of all 150 gallery images and the separate English Tip jar reviewer image; no blocking geometry/clipping/fallback findings. This does not pass formal native-language or accessibility acceptance.
- [x] Publish owner-approved App Privacy answers, save calculated age rating and owner-confirmed content rights, and verify the new review phone across eight existing non-staging app versions and secure release sources.
- [x] Verify Apple’s draft listing and all 150 processed images across ten locales, including exact order, dimensions and file checksums. #42 stays In progress for final release sealing/native-language acceptance. No 1.0 binary selection or App Review submission; broader #12/#43, #25/#71, #46 and #47/F13 gates stay open.

[Exact source and evidence](experiments/app-store-preparation-2026-11-08.md). Original shared worktree changes and other chats' booted devices are preserved.

### November 9 — stalled competition upload recovery

A fresh server confirmation of the existing tracking enrollment now clears a saved
terminal upload pause even when the epoch is unchanged. The pending operation ID,
body, event identities and private history remain intact. Previously only an epoch
change or the specific `restricted` reason cleared the pause, so relaunch/sign-in
could leave both original-history import and new folds permanently stopped.

The regression reproduces a stopped queue across journal reopen, confirms the same
enrollment, and drains 34 pending live folds plus 32 newly discovered historical folds, retaining
the 21 previously accepted folds, without reset or
rewriting records. It failed before the fix and passes afterward; 19 focused
history/tracking checks and all 114 core tests pass. This proves recovery of the persisted-pause case,
not the original error on the owner's phone. Device reconciliation remains unverified until the updated app is installed.

The leaderboard omits the pending-upload count at the owner’s request.


### Upload recovery delivered internally — November 9

[PR #979](https://github.com/0x63616c/world-wide-webb/pull/979) merged after all
required and selected checks passed at `dce556abaf0a9a477deaedec4f7af64cbc3c9641`.
[Main Folding CI](https://github.com/0x63616c/world-wide-webb/actions/runs/42686705141)
passed contracts, localization, backend, storage and native app validation.
[Automatic delivery](https://github.com/0x63616c/world-wide-webb/actions/runs/42689828634)
then archived, uploaded and distributed **1.0.0 (16)**. The immutable release
manifest records Apple build `7a3af840-bd22-4e15-b62b-1945c8e66c0d`, processing
state `VALID`, and verified Folding Internal assignment at `2026-11-09T20:17:14Z`.
The release remains an authenticated draft. It includes upload recovery and removal
of the leaderboard pending count in every locale. Production health remains `ok`
at the existing compatible backend revision `8ed02ee`; this app-only delivery
reused its verified backend receipt and did not deploy another Worker.

The owner confirmed build 16 still shows 97 personal folds versus 21 on the
leaderboard. Read-only production observations showed successful leaderboard reads
but no event, history or attestation requests after reopening. The initial recovery
change did not resolve the handset failure; its stopping point remains unverified.

### Foreground upload and TestFlight diagnostics — November 9

The follow-up runs the existing uploader before a first-page leaderboard refresh,
then invalidates cached community reads. The actual controller/runtime/transport
regression fixture first failed with only GET requests and 21 folds; with the
change it preserves a pending operation, uploads 34 live observations, then imports
32 original history observations across refreshes (55 then 87). This fixture proves
the foreground path, not the owner's private device reconciliation.

TestFlight/debug Settings adds a bounded, persistent local diagnostics report with
Copy, Share, Clear logs and an explicit connection check. It records closed metadata
for capture processing, upload queue/leases/retries, session and attestation state,
HTTP outcomes and correlation IDs, iCloud, widgets, notifications, lifecycle,
build/OS/layout and cached personal/leaderboard totals. Reports omit credentials,
raw errors, names, photo data and captured event bodies. Genuine history reset
clears the logs; repeated reset markers preserve them. Diagnostics reads do not
wait for background upload or replay.

The shared metric value uses larger Dynamic Type-aware text, and empty leaderboards
retain all three podium placeholders. [PR #983](https://github.com/0x63616c/world-wide-webb/pull/983)
merged at `6b56a75a181001f4601aa13cd06c1522f11493aa` after required gates and
Folding build/tests passed. Feature delivery is verified below. The separate optional
screenshot target initially omitted the new Diagnostics screen; the follow-up
adds that shared view to its explicit source list. Local validation passed 116 package tests, 75 app-hosted
tests on the pinned Duo runtime, 48 backend Rust tests and 30 actual Worker/D1
runtime tests, strict Swift formatting and localization (236 keys across ten
locales plus ten regression checks). Direct production-view renders verified the
large value and empty podium; the owned simulator was shut down and deleted.
Existing App Store and physical-device acceptance deferrals remain open.


### Diagnostics delivered internally — November 9

[PR #983](https://github.com/0x63616c/world-wide-webb/pull/983) shipped the upload,
diagnostics and UI changes at `6b56a75a181001f4601aa13cd06c1522f11493aa`.
[Main CI](https://github.com/0x63616c/world-wide-webb/actions/runs/42702812655)
passed every Folding check. [Delivery attempt 2](https://github.com/0x63616c/world-wide-webb/actions/runs/42705246215/attempts/2)
archived and uploaded **1.0.0 (17)** once. Its immutable manifest records Apple
processing `VALID`, build `6acbb8fb-8fc9-4af2-94e3-d1eaba7be056`, and verified
Folding Internal assignment at `2026-11-09T22:06:44Z`. The release remains an
authenticated draft. [PR #985](https://github.com/0x63616c/world-wide-webb/pull/985)
also merged the separate screenshot target's source-list fix; its actual
FoldingStorefront test build passed locally.

The first delivery attempt stopped before deployment because its reviewed runtime
configuration still approved the previous backend inputs. The existing readiness
generator and source-bound validator passed after reviewing the logging-only
Worker diff and refreshing the approved source. Existing resource bindings,
runtime flags, capability claims and acceptance hashes were preserved. The failed
publishing job was then retried. Production health now returns `ok` at `6b56a75`;
the normal delivery validator also verified the new immutable backend receipt.

The owner has been directed to install build 17 and refresh the leaderboard, then
copy Settings → Diagnostics if it remains stale. The original background stopping
point and the owner's post-update totals remain unverified; fixture success and
Apple distribution do not establish private-device reconciliation. Existing App
Store and physical-device acceptance deferrals remain open.


### Upload contention repair and structured support export — November 9

A device support report isolated a local busy deferral with a persisted retry delay
approaching an hour. An actual uploader/transport regression fixture reproduces a
concurrent account-read session refresh causing the upload to defer without sending
its batch. Sharing the in-flight session refresh makes that fixture pass and send
the original batch. Local signing contention now retries after two seconds without
increasing the failure count; normal transient backoff is capped around five minutes,
while explicit server retry windows remain authoritative. Foreground refresh can
resume a legacy local-busy deferral only when the saved typed diagnostic outcome
proves it was local; server and network deadlines are preserved. Operation IDs,
bodies and captured observations remain unchanged.

Support exports are now versioned JSON with named context and typed events, including
session-refresh sharing, App Attest generation/enrollment/assertion boundaries and
retry reason, attempt and delay. Raw errors, credentials and captured bodies remain
excluded. Share exports a named JSON file with app version, build and captured
date. Local validation passed 78 app-hosted tests, 118 package tests, and the
separate FoldingStorefront test build; seven targeted app checks and the focused
queue/JSON checks passed after final review and the named-file change. The contention fixture failed at the real
seam before the fix and passed afterward. Publication, replacement TestFlight and
the owner's post-update totals remain pending.

The owner now requests App Store review submission after the fix and automatic
on-merge review delivery matching Tendr's behavior. That submission work is active;
no App Review submission is claimed by the TestFlight-only delivery above.

### Automatic App Review handoff — November 9

The upload contention, bounded retry and named JSON export fix merged in WWW
[PR #990](https://github.com/0x63616c/world-wide-webb/pull/990) at
`2b348c171c59a0872970bdde94f24e087b310ab6`. Required PR checks and the actual
Folding native check passed. Main CI and the replacement internal build are pending.

The local automatic-release candidate extends the existing single publisher through
version planning, exact-build App Store metadata/gallery readback and joint app/tip
submission. It reuses Tendr's latest-source and waiting-review replacement rules,
preserves active review, and resumes a failed submission after successful TestFlight
distribution without rebuilding that reservation. Already-approved tips are retained.

The release gate now follows the owner's documented post-submission device-testing
exception. Missing broader capability acceptance remains explicitly deferred in the
manifest; runtime capability claims are unchanged. Source CI, matching backend CI and
immutable provider deployment, enabled production push/avatar bindings, exact signed
artifacts, Apple processing/group membership and storefront verification remain required.
A live read-only check verified the current backend receipt/source, enabled features
and all public pages. This is deployment evidence, not device/provider feature acceptance.
Local release and shared review fixtures passed; publication and actual Apple submission
remain pending. A cold hosted screenshot job exposed Fastlane's three-second build-settings
timeout; product Fastlane now uses a 60-second base timeout with three bounded attempts.

The final listing review also found all ten descriptions still promising a featured
public badge after the owner paused that feature. Sources and Apple metadata files
now describe private badges and community profiles accurately. All ten sources match
their files and meet Apple limits; localization and its ten regressions pass. Formal
native-speaker acceptance remains unverified.

PR CI reproduced a date-dependent late-insertion fixture failure at the UTC week
boundary: direct SQL seeded only the all-time score, so moving a fold out of the
current week attempted to decrement a nonexistent weekly score. The local test
failed with the same 409 using the accepted, byte-verified Worker artifact. It now
seeds through real signed ingestion, always crosses the active week boundary and
verifies weekly 1 → 0 while preserving all-time folds and correcting days used.
The focused fixture passes; runtime behavior and deployed inputs are unchanged.

Automatic listing preparation validates the saved Apple review contact in place.
It does not forward those private provider values into Deliver's printed options;
only review notes are updated. A focused regression checks preservation and rejection
of incomplete contact details.


November 9 upload recovery candidate (PR #992): build 19 diagnostics show repeated
registration 401s after a successful session refresh. A deterministic real Worker/D1
regression reproduces expired enrollment returning `challenge_expired` before retention
cleanup but 401 afterward. The candidate preserves success-receipt replay, reports a
missing challenge as expired only after session/device authorization, and retains 401
for existing challenges with another binding. The client replaces an expired one-shot
proof once in the same attempt and continues the original queued upload. Local upload
backoff is capped at 60 seconds including jitter; explicit server cooldowns remain
honored. Existing local waits migrate to this limit, and leaderboard refresh retries
local failures immediately without changing fold history or upload operation identity.
Diagnostics use a separately scrolling report, UTC/local timestamps with timezone,
separate challenge/enrollment routes, error codes, pending-proof state and per-attempt
request-ID correlation. Server rejection logs identify the validation stage and cause.
An additional reproduced Swift Mutex closure stack-growth issue is fixed with a stored
provider value. This is a local candidate, not verified TestFlight delivery or App Store
submission; device totals still require live confirmation after shipping.


November 9 live recovery and submission validation: PR #992 merged as
`1d1e142aaa1c491e0e3705fc6f1bbd4dd45767e5`; all seven main Folding CI jobs passed.
Production Worker version `177bea3a-071c-478f-8413-404160d90202` and processed build
1.0.0 (20) are directly verified, including actual Folding Internal membership.
The owner's build 20 diagnostics confirm expired-proof recovery, accepted historical
and queued live uploads, zero pending work and matching personal/month totals of 130.
Read-only production SQLite confirms all-time 130, month 130 and current week 52.
This is real installed-account upload evidence; broader F13 device/provider checks
remain deferred.

App Review is not submitted. Hosted capture timed out before retaining diagnostics;
local exact-source capture subsequently passed all 20 locale/display tests and sealed
150 screenshots plus the tip review screenshot. Apple processed all 150 images and
metadata precheck passed. Direct Apple validation then exposed missing free pricing,
a missing content-rights value despite recorded owner approval, and an iPad screenshot
requirement. Inspection of the signed IPA confirmed unintended UIDeviceFamily [1,2]:
XcodeGen's target defaults overrode the project-level iPhone-only setting. The local
replacement sets the production app and widget target families explicitly and rejects
wrong-family signed artifacts. It also explicitly attaches the exact processed build,
saves/readbacks approved rights and free pricing, retains nested Apple validation codes,
and separates native capture from provider credentials with scoped failure diagnostics.
The controller now selects its owned simulator explicitly. Native controller compilation,
generated iPhone build settings and release regressions pass locally; replacement
source CI, TestFlight and actual review submission remain pending.


### November 10 verified build 21 delivery

[WWW #997](https://github.com/0x63616c/world-wide-webb/pull/997) merged as
`66a37a32b4d191e5384a4e0d04c0f627e49ee7ac`. All seven selected
[main Folding checks](https://github.com/0x63616c/world-wide-webb/actions/runs/42781130440)
passed. The automatic publisher delivered **1.0.0 (21)**, Apple build
`15d56e44-0361-43e3-91ac-33ff5baad4bd`, processing `VALID` and
`APP_STORE_ELIGIBLE`. Independent Apple readback confirms actual Folding Internal
membership. Downloaded immutable IPA hash verification and both signed app/widget
plists confirm iPhone-only device families `[1]` and the exact source revision.

The owner's build 21 diagnostics at 00:52:56 PST (08:52:56 UTC) show personal and
All Time leaderboard totals of **130**, no pending uploads/captures and fresh successful
leaderboard responses. This verifies persistence and retrieval after the update;
the report contains no new build 21 fold capture, so a fresh capture/upload is not
claimed. One cancelled milestone request (`-999`) was followed by success.
The production Worker remains `177bea3a-071c-478f-8413-404160d90202` from
`1d1e142aaa1c491e0e3705fc6f1bbd4dd45767e5`; the new native release changes no
backend inputs. Broader physical-device/provider acceptance remains deferred under F13.

[WWW #960](https://github.com/0x63616c/world-wide-webb/pull/960) also merged after
required checks passed; its semantic-title action update selects no app delivery.
All previously open PRs are merged. The hosted publisher's first attempt stopped
before submission when the native screenshot controller timed out before XCTest
startup. The retained logs establish the startup stage, without identifying its cause.
Exact-source local capture then passed all 20 language/display runs, including the
additional tip review test; all 150 screenshots and review assets are sealed under
build 21. The [publisher](https://github.com/0x63616c/world-wide-webb/actions/runs/42783358465/attempts/2)
restored those immutable assets and verified the exact processed build and listing.
A subsequent verification failed because the SDK's editable-info helper excludes
`READY_FOR_REVIEW` after review preparation. Recovery rechecked the sealed metadata,
all ordered screenshot bytes/dimensions, live backend/source prerequisites, exact
build and app/three-tip relationships against Apple's prepared bundle before one
submission write. Independent Apple readback confirms **WAITING_FOR_REVIEW** for
submission `e84499a5-8bee-4deb-93f0-6cfbf5fc4bb3`, version
`461e7aec-0cf3-4a57-a899-99b38e36c252`, exact build 21 and automatic release
`AFTER_APPROVAL`. Submission acceptance (#44) is verified; Apple approval and
public storefront/production acceptance (#45) remain open.

The readback correction retains Apple's app-information identity from its first
verification, then checks that same record after review preparation. It fails
closed when the identity is missing or ambiguous, preserves all metadata/category/
ordered-gallery checks and ignores unrelated published information. The regression
reproduces the exact missing-editable-info failure before the fix and passes after it;
all 53 release tests / 730 assertions pass locally.
This release-tooling-only change selects no native delivery, preserving the pending
build 21 review. The hosted controller startup timeout remains a separate delivery
hardening follow-up; its underlying cause is unverified.


November 10 follow-up: [#1005](https://github.com/0x63616c/world-wide-webb/issues/1005) tracks automatic
profile-picture content filtering. It is deferred from the blocking/account-deletion release;
no paid provider signup, manual approvals or preset-avatar replacement is authorized.


### November 10 leaderboard loading follow-up

Period changes now clear old podium entries, list rows and the pinned current-user
score synchronously. First-page loads show a shimmering podium placeholder and
list progress; Reduce Motion keeps the placeholder static. The period picker
remains available during loading and after failure, and failed requests offer retry
without restoring stale results. Loading another page retains the current entries.
The period-switch regression failed before the fix and passes after it; the native
PresentationTests suite and changed-source Swift formatting checks pass locally.
This is a local implementation; no new TestFlight delivery or device acceptance
is claimed.

November 11 authentication recovery: build 23 diagnostics showed repeated rejected
session refreshes followed by rate limiting. This change stops retries after a definite
refresh rejection, preserves pending uploads, recovers interrupted token rotation, and
extends active sessions. Local tests cover delayed refresh recovery, token reuse,
interrupted client persistence, the sign-in fallback, and the upload queue. Device
verification and the reason for the original refresh rejection remain open.

November 11 release simplification: owner requested removal of global feature
switches and the manual source-approval gate, while retaining minimum app build.
The implementation removes deployment/admin switches, makes implemented API
operations discoverable by default, and keeps notification consent, leases,
bounded retries, provider-error reporting and audited update-policy changes.
Existing legacy database columns remain unused for rollback compatibility.
The authentication fix in #1035 passed main CI but its delivery stopped before
Worker publication because of the old source-approval gate. This follow-up must
pass checks and deliver the combined source before TestFlight is claimed complete.
App Store submission is requested after TestFlight verification; screenshot approval
and physical-device acceptance retain their existing requirements/deferrals.

PR #1036 merged as `933c119230eac19261d7f3e5609a9bfdd57bd5a7` after all
checks passed. Production CI passed and delivery run 43132130930 published the
Worker and immutable receipt. Independent health/capability and provider-binding
readbacks confirm that source and absence of feature-toggle bindings. The release
then archived build 24, but Apple rejected its 1.0.0 upload with errors 90062/90186:
1.0.0 is approved and its pre-release train is closed. Preserve that immutable
attempt. Bump app.yml to 1.0.1 and reserve a new build through ordinary delivery;
no backend rebuild/redeployment is required for the version-only change.

November 11 follow-up: #1037 merged as
`23f3d2a066f7ac0b1a516e9c03410f9040aaf6c8`; delivery 43135668026 processed
**1.0.1 (25)** as VALID and read back its assignment to Folding Internal. The owner
confirmed that the leaderboard loads. App Store submission remains pending screenshot
review/approval; the other recorded device/provider deferrals remain deferred.

Screenshot CI diagnosis: run 43135057621 failed twice at Device Hub window startup.
Its workflow skipped failure artifacts. Diagnostic branch `codex/folding-capture-diagnosis`
adds stage markers and retains the existing native controller logs on failure.
Run 43140054741 passed controller startup and the inner-pose request, then reproduced
two deterministic screenshot-target compile errors: its duplicated
`CompetitionTransportError` fixture omits `unauthorized`, and its explicit source list
omits `LeaderboardPodiumPlaceholder.swift`. Required native CI compiles the normal
Folding scheme, so these fixture-target errors were not checked. The earlier startup
timeout remains intermittent and its underlying cause is unproven; do not label the
later controller cleanup interruption as its cause. Next: share the transport error
definition, include the placeholder source, compile the screenshot scheme in native
CI without booting a simulator, then verify capture. Diagnostic changes pass actionlint,
diff checks and all 34 portable capture tests; no product fix or new submission is
claimed at this checkpoint.

The local generic-simulator `FoldingStorefront` build reproduced both errors before
the fix and now reports `TEST BUILD SUCCEEDED`. The fixture reuses the production
error definition and includes the missing view; required native CI also builds
the screenshot app/tests without booting a device. Its budget increases to 20 minutes
to accommodate both schemes (the diagnostic screenshot build alone took 469 seconds).
This changes screenshot composition/build verification, not production app behavior.
Remote capture, the intermittent startup failure and App Store submission remain open.
The store-check artifact now retains raw captures, reviewer image/map and metadata
alongside composed screenshots/manifests, so successful captures can be validated and
sealed by the existing release handler instead of requiring a second capture.


November 11 native screenshot correction: the owner identified square screen corners
inside the synthetic rounded frame and questioned Liquid Glass fidelity. The previous
pipeline used hosted `drawHierarchy` renders with safe areas removed; Tendr uses actual
screen captures. The owner requested the same native approach for Folding and explicitly
removed screenshot approval as a release gate going forward. Preserve build 26 and its
sealed rendered assets as historical receipts; do not alter them or claim they are native
screen captures.

The replacement uses the real fixture app/window and `XCUIScreen.screenshot()`, keeps
native safe areas/materials, switches only configured scenes within each device/locale
session, and captures both Duo displays plus an actual iPhone 18 Pro for the required
medium gallery. It removes the frame compositor, caption copy, resized Duo substitutes,
old snapshot helper and obsolete preview entrypoints. PNG packaging preserves original
RGB bytes; fully opaque alpha is removed only after a pixel/color-space round-trip check.
Transparent or wrong-size captures fail. Local pixel-preservation regression failed
before the change and passes after it; 60 release-tool tests (300 assertions) and the
capture app/UI-runner build pass. Next: self-review, source-bound remote capture, visual
comparison with the running native app, green required CI and the ordinary release flow.
The reason for the flat rail remains unproven until this native comparison; no production
glass styling has been changed. Existing provider/device deferrals remain deferred.
