# Deferred shipping work

The owner cleared the broader shipping goal. These tasks are retained for a later shipping goal, separately from the current coding backlog. They are not cancelled or accepted.

- [ ] Finalize replacement logo and coherent app/site/light/dark/tinted assets. Butterfly concept exists under `design/brand/concepts/`; it is not installed.
- [x] Create/save the approved CloudKit management token, expiring November 7, 2027. Saved in Folding's 1Password vault on November 7, 2026.
- [x] Promote both initialized, exported and validated Core Data CloudKit schemas to Production and verify exact readback (`cloudkit/README.md`). Development snapshots and Production readbacks are sealed under `cloudkit/`.
- [x] Complete staging/production migrations 0001–0017, Worker deployment, six runtime secrets per environment and API/admin routing. Both live health endpoints returned HTTP 200 with commit `4594f762365962dc0fe0ba662bdeb5559ea4ac2b` on November 7, 2026. This confirms deployment health, not feature acceptance. See `docs/experiments/live-integration-2026-11-07.md`.
- [ ] Deploy/activate watchdog and operational alerts; verify outbound email receipt and outage/recovery.
- [ ] Validate live sign-in/App Attest, iCloud/reset/account/phone transfer, Shortcuts uploads, rankings/corrections, avatars/moderation/cleanup, APNs/preferences and StoreKit purchases. Do not substitute local tests for provider/device evidence.
- [ ] Measure realistic large-history/population resource use and address resulting issues.
- [ ] Complete visual/accessibility/localization review and all ten-locale storefront screenshots/listing.
- [ ] Finish tip reviewer asset processing/readiness. Three products are configured; screenshot capture succeeded in `/tmp/folding-release-assets/build/store-assets/03084e4d55c3e80effedfc28cd6858be93a7ef1f/production/assets`. Upload timed out: read Apple state before retrying.
- [ ] Complete signed archive validation, Apple privacy/age-rating/review details, processed TestFlight build and release rehearsal. Existing profiles/recovery do not prove archive acceptance.
- [ ] Verify public pages. Production site is live; final acceptance remains open. The owner reports personally testing that `support@getfolding.app` forwards successfully; no additional inbox test is requested.
- [ ] Submit app and tips; verify submission and automatic publication after approval.
- [ ] Run owner-deferred physical Duo checks **after submission**, fix/resubmit as needed (#47/F13).
- [ ] Restore CI on owner-provided runners when available (#46); do not retry hosted-CI billing.

The [GitHub Project](https://github.com/users/0x63616c/projects/9) and existing shipping issues remain open. Keep secrets in Folding's 1Password vault, referenced by existing setup evidence; never put their values here. All credential work uses the primary persistent shell.
