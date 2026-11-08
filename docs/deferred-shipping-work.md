# Deferred shipping work

The active goal covers live iCloud and Cloudflare integration. This list also preserves broader shipping tasks for later. CI, storefront/visual review, submission, and post-submission device checks remain deferred.

- [x] Install the owner-selected white twin-panel logo on black in the app and website; all three icon appearance assets are reproducibly generated from the selected source (`ccdaf43`). Final Home Screen appearance review remains deferred.
- [x] Create/save the approved CloudKit management token, expiring November 7, 2027. Saved in Folding's 1Password vault on November 7, 2026.
- [x] Promote both initialized, exported and validated Core Data CloudKit schemas to Production and verify exact readback (`cloudkit/README.md`). Development snapshots and Production readbacks are sealed under `cloudkit/`.
- [x] Verify synthetic private fold and reset convergence through live CloudKit export/import on the iCloud-signed Duo simulator, in both containers with Development and Production CloudKit entitlements (`docs/experiments/live-integration-2026-11-07.md`).
- [x] Complete staging/production migrations 0001–0017, Worker deployment, six runtime secrets per environment and API/admin routing. Both live health endpoints returned HTTP 200 with commit `4594f762365962dc0fe0ba662bdeb5559ea4ac2b` on November 7, 2026. This confirms deployment health, not feature acceptance. See `docs/experiments/live-integration-2026-11-07.md`.
- [x] Provision isolated staging/production watchdog D1, checksum migrations and disabled Workers; verify no Cron/public endpoint and byte-verified encrypted state backups (`docs/experiments/live-integration-2026-11-07.md`).
- [x] Configure `getfolding.app` as an outbound Cloudflare Email Sending domain through OpenTofu; verify provider acceptance of an alert test message. Owner separately confirmed that `support@getfolding.app` forwarding works. Neither confirms alert delivery to the owner's inbox.
- [ ] Activate watchdog and operational alerts; verify outbound email receipt and staging outage/recovery first.
- [ ] Validate live sign-in/App Attest, iCloud/reset/account/phone transfer, Shortcuts uploads, rankings/corrections, avatars/moderation/cleanup, APNs/preferences and StoreKit purchases. Do not substitute local tests for provider/device evidence.
- [ ] Measure realistic large-history/population resource use and address resulting issues.
- [ ] Complete visual/accessibility/localization review and all ten-locale storefront screenshots/listing.
- [x] Finish tip reviewer asset processing/readiness. Apple readback shows all three exact consumables `READY_TO_SUBMIT`, each with a completed review screenshot of the same native Tip jar capture (`docs/experiments/testflight-preview-2026-11-07.md`).
- [ ] Exercise all three tip purchases in TestFlight's sandbox with the owner; `READY_TO_SUBMIT` and screenshot processing do not prove a purchase works.
- [x] Sign, upload and distribute a production-app TestFlight preview to the owner's internal group; Apple processed version 0.1.5 (build 6) and Fastlane confirmed internal distribution (`build/releases/v0.1.5/release.json`, ignored local evidence). This remains a preview, not App Store submission.
- [x] Fix reproduced Shortcuts partition-busy startup/recording failures and distribute 0.1.10 (11) internally; all 89 core and 41 app-hosted simulator tests pass. [Evidence](experiments/shortcuts-partition-busy-2026-11-08.md). Actual overnight/locked-Duo/Shortcuts confirmation remains deferred to #47/F13.
- [x] Fix the shared-storage lock paths behind the three TestFlight `0xdead10cc` reports and distribute 0.1.9 (10) internally; all 86 core and 38 app-hosted simulator tests passed. [Evidence](experiments/testflight-crashes-2026-11-08.md). Physical suspension/Shortcuts confirmation remains deferred to #47/F13.
- [ ] Review/merge and ship #59 durable capture, with schema-v9 forward-compatible rollback planning. Local 105 core / 43 simulator checks pass ([evidence](experiments/durable-capture-2026-11-08.md)); locked/terminated/overnight Shortcuts acceptance remains deferred to #47/F13.
- [ ] Resolve the startup alert that the owner reproduced on build 5 and confirm opening/closing setup tests on build 6 on the Duo. Simulator layout and packaging checks do not establish device behavior.
- [ ] Resolve the owner's production Join failure on a physical Duo. Sign in created one not-joined participant and two enrolled App Attest keys, but production D1 has zero joined epochs and both keys remain at assertion counter zero (aggregate readback, November 7). Build 6 exposes the exact transport error code; do not treat Apple sign-in or key enrollment as a successful Join. After the owner retries, inspect the code/request path and fix the failing boundary.
- [ ] Accept the redesigned setup and wide-Duo UI on the physical device. Current source confirms each automation before testing, starts the test automatically when hinge posture is known, and offers a manual fallback when it is not. It names Shortcuts actions **Log Duo Opened/Closed**, uses a dedicated Settings tab, and reduces chart/profile clutter; simulator screenshots and compilation are preliminary evidence only.
- [ ] Complete Apple privacy/age-rating/review details and final release rehearsal. The preview is not an App Store submission.
- [ ] Verify public pages. Production site is live; final acceptance remains open. Support forwarding is complete based on the owner's test; no additional inbox test is requested.
- [ ] Submit app and tips; verify submission and automatic publication after approval.
- [ ] Run owner-deferred physical Duo checks **after submission**, fix/resubmit as needed (#47/F13).
- [ ] Restore CI on owner-provided runners when available (#46); do not retry hosted-CI billing.

The [GitHub Project](https://github.com/users/0x63616c/projects/9) and existing shipping issues remain open. Keep secrets in Folding's 1Password vault, referenced by existing setup evidence; never put their values here. All credential work uses the primary persistent shell.

- [x] Deploy API resource protections and default-disabled minimum-build policy to staging then production, verify all 19 checksum migrations/settings/health, and distribute **0.1.11 (12)** to Folding Internal with exact Apple membership readback. Includes offline cold startup, current Shortcuts capture/retries and concise app copy. [Evidence](experiments/api-offline-release-2026-11-08.md). Post-rollout 24-hour cost observation and physical-device behavior remain unverified.

- [x] Move required-update policy exclusively into protected Operations, remove the deployment-variable control, apply/verify migration 0020 in both environments, test staging activation/rollback through the live form and verify production stays at 0. [Evidence](experiments/admin-minimum-build-2026-11-08.md). Existing TestFlight build 12 needs no replacement for this server-only change.

- [x] Merge and ship competition cleanup in **0.1.12 (13)** to Folding Internal, with exact Apple build/group readback. Remove active Leave/manual approval paths and simplify leaderboard/profile/results/Shortcuts; preserve private tracking. Both API environments verify the merged source and minimum 0. [Evidence](experiments/leaderboard-cleanup-2026-11-08.md). Actual installed visual acceptance remains open.


November 8 App Store preparation: all ten-locale screenshot templates/listing sources
now cover current-main profiles, milestones and Patterns. The saved App Privacy
answers are published with owner approval; age ratings and owner-confirmed content
rights are saved, and the new review phone is verified across all eight existing
non-staging app versions. These components no longer await setup. Full rehearsal,
formal native-language/accessibility acceptance, the signed 1.0 candidate and full
backend acceptance remain open. See [exact storefront evidence](experiments/app-store-preparation-2026-11-08.md).
