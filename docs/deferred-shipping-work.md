# Deferred shipping work

The owner cleared the broader shipping goal. These tasks are retained for a later shipping goal, separately from the current coding backlog. They are not cancelled or accepted.

- [ ] Finalize replacement logo and coherent app/site/light/dark/tinted assets. Butterfly concept exists under `design/brand/concepts/`; it is not installed.
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
- [ ] Finish tip reviewer asset processing/readiness. Three products are configured; screenshot capture succeeded in `/tmp/folding-release-assets/build/store-assets/03084e4d55c3e80effedfc28cd6858be93a7ef1f/production/assets`. Upload timed out: read Apple state before retrying.
- [x] Sign, upload and distribute a production-app TestFlight preview to the owner's internal group; Apple processed version 0.1.1 (build 2) and API readback confirmed exact build/group/tester membership (`docs/experiments/testflight-preview-2026-11-07.md`).
- [ ] Complete Apple privacy/age-rating/review details and final release rehearsal. The preview is not an App Store submission.
- [ ] Verify public pages. Production site is live; final acceptance remains open. Support forwarding is complete based on the owner's test; no additional inbox test is requested.
- [ ] Submit app and tips; verify submission and automatic publication after approval.
- [ ] Run owner-deferred physical Duo checks **after submission**, fix/resubmit as needed (#47/F13).
- [ ] Restore CI on owner-provided runners when available (#46); do not retry hosted-CI billing.

The [GitHub Project](https://github.com/users/0x63616c/projects/9) and existing shipping issues remain open. Keep secrets in Folding's 1Password vault, referenced by existing setup evidence; never put their values here. All credential work uses the primary persistent shell.
