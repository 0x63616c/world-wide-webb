# Competition cleanup — November 8, 2026

Owner requested immediate signup with retrospective moderation, deletion instead of a separate leave action, simpler leaderboard/results/profile controls and a new internal TestFlight preview.

The app and server no longer offer or handle Leave competition. Obsolete saved leave markers are discarded, never converted into account deletion; deletion recovery remains durable and personal tracking is separate. No admin approve/reject handlers, avatar-review email producer or app approval polling remain. Validated names and sanitized photos publish immediately. Historical migration records and the legacy upload receipt remain compatible with older builds; already queued retired email jobs complete without sending.

Leaderboard content stays mounted during period requests; labels are This Week, This Month and All Time, with no duplicate period heading or UTC menu. Live All Time results are available in Your Results. The gold avatar is larger and centered; crown background is transparent. Signed-in navigation uses the profile avatar on the right. Dark profile forms use black, photo selection has no repeated visible label, and completed Shortcuts show only the green tick. Settings shows installed version/build and labels verified TestFlight transactions.

The combined source includes main's offline/API-protection release. Verification: 109 core tests, 56 app-hosted tests, 34 Rust tests and 15 compiled Worker/D1 tests pass; 203 semantic localization keys across ten locales pass. New coverage checks retained leaderboard content, live All Time results, rejected retired Leave requests, immediate publication and safe persisted-removal migration. No physical-device UI acceptance is claimed.

Internal release and provider receipts will be recorded after Apple processing and exact group readback. CI, storefront review, App Store submission and broader physical-device checks remain deferred.
