# Deferred shipping work

The owner cleared the broader shipping goal. These tasks are retained for a later shipping goal, separately from the current coding backlog. They are not cancelled or accepted.

- [ ] Finalize replacement logo and coherent app/site/light/dark/tinted assets. Butterfly concept exists under `design/brand/concepts/`; it is not installed.
- [ ] Create/save the approved CloudKit management token, expiring November 7, 2027. Approval received; creation not completed. Check existing tokens before retrying the pending Console form.
- [ ] Initialize/export both exact Core Data CloudKit schemas, promote both containers to Production and verify readback (`cloudkit/README.md`).
- [ ] Complete staging/production migrations, Worker deployment, secrets and routing. Only staging migrations0001–0015 have been verified. Regenerate bindings for the actual committed deployment.
- [ ] Deploy/activate watchdog and operational alerts; verify outbound email receipt and outage/recovery.
- [ ] Validate live sign-in/App Attest, iCloud/reset/account/phone transfer, Shortcuts uploads, rankings/corrections, avatars/moderation/cleanup, APNs/preferences and StoreKit purchases. Do not substitute local tests for provider/device evidence.
- [ ] Measure realistic large-history/population resource use and address resulting issues.
- [ ] Complete visual/accessibility/localization review and all ten-locale storefront screenshots/listing.
- [ ] Finish tip reviewer asset processing/readiness. Three products are configured; screenshot capture succeeded in `/tmp/folding-release-assets/build/store-assets/03084e4d55c3e80effedfc28cd6858be93a7ef1f/production/assets`. Upload timed out: read Apple state before retrying.
- [ ] Complete signed archive validation, Apple privacy/age-rating/review details, processed TestFlight build and release rehearsal. Existing profiles/recovery do not prove archive acceptance.
- [ ] Verify public pages and support-email forwarding end-to-end. Production site is live; final acceptance remains open.
- [ ] Submit app and tips; verify submission and automatic publication after approval.
- [ ] Run owner-deferred physical Duo checks **after submission**, fix/resubmit as needed (#47/F13).
- [ ] Restore CI on owner-provided runners when available (#46); do not retry hosted-CI billing.

The [GitHub Project](https://github.com/users/0x63616c/projects/9) and existing shipping issues remain open. Keep secrets in Folding's 1Password vault, referenced by existing setup evidence; never put their values here. All credential work uses the primary persistent shell.
