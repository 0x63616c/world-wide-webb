# Folding work tracker

Current scope and open items only. Earlier batch-by-batch history, including the former
deferred shipping checklist, is in Git history (`git log -- projects/folding/docs/work-tracker.md`)
and in the dated receipts under [experiments](experiments/). Active issues belong to
[`0x63616c/world-wide-webb`](https://github.com/0x63616c/world-wide-webb/issues); old `folding`
issue and PR numbers in historical documents are archival references.

## Current state

Last recorded facts, with the date each was recorded. Check delivery receipts for anything newer.

- **App Store:** version 1.0.0 is publicly listed in the US and UK (November 11).
  `fastlane/app-availability.json` owns country selection.
- **In review:** 1.0.1 (29) was submitted on November 12 with automatic release after approval.
  The review outcome is not recorded here.
- **Environments:** production only. The staging app, data and infrastructure were deleted on
  November 10.
- **App scope (November 12 refresh):** Analytics replaces Today, Leaderboard starts at All Time,
  and widgets and result sharing are removed from the app. Historical results are hidden in the
  app; the backend keeps the records.
- **Delivery:** selected main changes deliver an internal TestFlight build; a `folding/vX.Y.Z` tag
  promotes a processed build to App Review. See [Folding operations](../fastlane/RELEASE.md).
- **Clean-up (November 15):** removed the unused results/sharing client calls, the unused
  summary-card preferences and stale local entrypoints. `scripts/check-backend` now runs clippy.
  The root host test package covers presentation, milestone and update-policy logic without a
  simulator.

## Open items

Each item was open when last recorded. None was re-verified during the November 15 clean-up.

### Release

- Record the App Review outcome for 1.0.1 (29) and confirm automatic publication.
- Add the App Store link to the public site once the owner confirms the listing URL. The site no
  longer says "Coming soon" and carries no store link.
- Final acceptance of the public pages.
- The cause of the intermittent Device Hub startup timeout in screenshot capture is unproven.

### F13: owner-deferred device and provider checks

Local and simulator tests do not substitute for this evidence.

- Physical Duo acceptance of setup, the wide layout and the November 12 Analytics/Settings refresh.
- Shortcuts capture while locked, terminated and overnight.
- Live sign-in and App Attest, iCloud sync, reset, account deletion and phone transfer.
- Rankings and corrections, avatars and moderation, cleanup jobs, APNs and notification preferences.
- All three tip purchases in the TestFlight sandbox.
- Device verification of the November 11 session-refresh recovery. The reason for the original
  refresh rejections on build 23 is unknown.

### Operations

- Watchdog Worker and operational alerts are provisioned but not activated. Activate or delete
  (decision D4 in the [repository clean-up plan](../../../docs/plans/repo-cleanup-2026-11-15.md)).
- The Worker still serves the results and results-share endpoints. Remove the share endpoint after
  request logs confirm no installed build calls it.
- Measure resource use with realistic large histories and populations.
- The 24-hour cost observation after the November 8 API protection rollout was never recorded.

### Review

- Formal visual, accessibility and native-language review across the ten locales.

### Code follow-ups

- `TrackingRuntime` retries and `AppIntegrationTests` still use real sleeps (1.2 s and 6 s).
  Inject a sleeper before moving those tests off the simulator.
- `LeaderboardLoadingSnapshotTests` still renders in the simulator test bundle. Delete it or move
  it to an explicit diagnostic.
- Competition transport, API and upload tests still need the simulator. `CompetitionAPI` and
  `CompetitionTransport` depend on types declared in UIKit files (`CompetitionSignIn.swift`,
  `PushRegistration.swift`) and on `TrackingRuntime`.
- `TrackingDiagnosticEntry.Event` keeps `widgetSnapshotWritten` and `widgetFailed`. Stored
  diagnostics decode as one array, so removing the cases would discard any stored history that
  contains them. Remove them together with a decoder that skips unknown events.
