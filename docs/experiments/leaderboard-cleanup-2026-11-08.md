# Competition cleanup — November 8, 2026

Owner requested immediate signup with retrospective moderation, deletion instead of a separate leave action, simpler leaderboard/results/profile controls and a new internal TestFlight preview.

The app and server no longer offer or handle Leave competition. Obsolete saved leave markers are discarded, never converted into account deletion; deletion recovery remains durable and personal tracking is separate. No admin approve/reject handlers, avatar-review email producer or app approval polling remain. Validated names and sanitized photos publish immediately. Historical migration records and the legacy upload receipt remain compatible with older builds; already queued retired email jobs complete without sending.

Leaderboard content stays mounted during period requests; labels are This Week, This Month and All Time, with no duplicate period heading or UTC menu. Live All Time results are available in Your Results. The gold avatar is larger and centered; crown background is transparent. Signed-in navigation uses the profile avatar on the right. Dark profile forms use black, photo selection has no repeated visible label, and completed Shortcuts show only the green tick. Settings shows installed version/build and labels verified TestFlight transactions.

The combined source includes main's offline/API-protection release. Verification: 109 core tests, 56 app-hosted tests, 34 Rust tests and 16 compiled Worker/D1 tests pass; 203 semantic localization keys across ten locales pass. New coverage checks retained leaderboard content, live All Time results, rejected retired Leave requests, immediate publication and safe persisted-removal migration. No physical-device UI acceptance is claimed.

Staging then production verified all 20 checksum migrations, healthy merge commit `ccb1a63c27d95a33343ecaaca9fd5d1380dcfec4`, unchanged resource/secret bindings, rate limits, CPU/log settings and minimum build 0. Production retains App Attest builds 2–12 and adds 13. The obsolete minimum-build environment value was removed; main's Operations control is authoritative and remains disabled.

- Staging Cloudflare version: `ecc4538d-e390-422a-bfe7-7a9c9c1d4d07`.
- Production Cloudflare version: `2ba49977-5da9-449e-a489-57ea2294bf43`.

Fastlane reserved and readonly-match signed **0.1.12 (13)** from that exact main commit. Apple processed the immutable IPA as **VALID** (`407fca14-dc66-4491-9029-0980c0d755a6`) and independent App Store Connect readback confirmed exact membership in **Folding Internal**, with non-exempt encryption false. No external beta review or App Store submission was requested.

Archive SHA-256: `709b58baefea1d1e96afe681cf10d6d4883db3025f023cc68a23caba76a6b1b5`.
IPA SHA-256: `64a83bd4b50471abf5bc8d2370f865258945a9eca3f6996ffe0e53c16a247cf8`.
dSYM SHA-256: `cc10e9fc72b1119a73660dae06216f01ff8382b1713781448b6993d3fed51360`.

Release record/artifacts are retained in private draft `v0.1.12`. Ignored provider receipts/configuration are under `build/ship-cleanup`; immutable release receipt is `build/releases/v0.1.12/release.json`. Actual installed Settings appearance remains for the owner to verify. CI, storefront review, App Store submission and broader physical-device checks remain deferred.
