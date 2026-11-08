# TestFlight refinements — November 8, 2026

The owner explicitly resumed app work and internal TestFlight shipping and paused
Penpot work. Implementation is `480725ecb2007c00669eb0e3ff6102eddb584566`, tracked by
[#52](https://github.com/0x63616c/folding/issues/52) and
[#53](https://github.com/0x63616c/folding/issues/53).

This release adds full localized month-selection dates, live main duration and
cross-process event refresh, incomplete-entry deletion with current leaderboard
removal, hour/weekday/month-day patterns, persisted Today card drag/reorder,
bounded History navigation/session scrolling, SF Rounded and consistent stat
insets/corners, monochrome notification controls, resumed name/photo review and
a refreshed tip jar with verified-purchase celebration. Equivalent travel is
removed from visible UI and preferences; legacy export fields remain compatible.
Apple supplies names only when shared and provides no profile photo.

Local verification passed: 79 core tests; 34 app-hosted Duo simulator tests; 30
Rust host tests; Wasm release compilation and eight workerd integration tests;
14 schemas/62 fixture checks; 207 keys across ten locales. Final screenshot target
and distribution archive compiled. Inspected fixtures cover Today card equality,
a running main duration changing from 1h57m2s to 1h57m42s without relaunch, month
History and aligned axis labels, bounded sessions, Patterns with spaced time
labels, monochrome signed-out result settings, labeled Join fields and the tip
jar. Native drag/scrubbing interaction could not be exercised through the available
native UI automation. The ordering/persistence behavior is covered locally;
physical acceptance remains deferred to #47/F13.

Both isolated D1 databases now have all 18 checksum-verified migrations. The
staging table applied before a local Python 3.9 receipt-writing failure; a fresh
attempt under the existing Python 3.15 environment re-read all hashes and
completed successfully without replaying the applied migration. Provider state
and exact configuration were re-read before/after deployment; six secrets and
existing feature flags/bindings/schedules were preserved. Public health returned
the exact source commit, capabilities remain empty, and unauthenticated deletion
requests returned 401 in both environments. The public route checks used curl
following a 403 from the local Python networking client.

- Staging Worker: `87675ae9-c629-47e1-846b-3868b62cdfff`.
- Production Worker: `1bf1a394-6915-4a13-9644-13f055afb150`.
- Production App Attest builds remain explicitly allowlisted, now 2–9.
- Migration/provisioning evidence: ignored `build/migrations/refinements-*` and
  `build/runtime/refinements/*-verified.json`.

Deletion preserves causal observations internally and suppresses their scored
contributions after replay, so a repeated state cannot become a new fold.
Immutable tombstones sync privately, survive offline/sign-out/late-upload cases,
and are participant/epoch ownership checked on the server. Current week/month/
all-time scores and future finalizations honor removals. Published historical
result versions retain the existing formal correction policy.

App Store submission, real Apple/App Attest/notification/purchase flows, full
storefront/accessibility/localization review, and owner-deferred device checks
remain open. This is an internal preview, not broad integration acceptance.

Apple readback confirmed **0.1.8 (9)**, build
`f52a3bad-f074-4764-b6c9-c36a7146b10f`, **VALID**, non-exempt encryption `false`,
and actual membership in **Folding Internal**. Fastlane's persisted release
record is revision 10, state `processed`, with matching source/backend commit,
build ID and distribution group. The private draft
[release artifacts](https://github.com/0x63616c/folding/releases/tag/v0.1.8)
include the signed archive/IPA, manifest revisions, TestFlight notes and immutable
provider/local-check receipts. The final IPA SHA-256 is
`0a6977d2b1ab95b0fa3fdaaa180fde8f28139107d7a16f73cbbc9dc74770cbdb`.

No App Store submission was made. Existing unrelated iOS and Penpot experiments
remain in the original dirty checkout.
