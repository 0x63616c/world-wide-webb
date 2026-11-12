# Screenshot composition contract

Historical fixture spike. Superseded on November 11 by actual simulator-screen capture through `FoldingStorefront` / `StorefrontCaptureTests`; see [current release operations](../../fastlane/RELEASE.md#screenshots-and-localization).

Fixture version **1**, fixed clock **2026-11-02T10:09:00Z**.

Scheme `FoldingScreenshots`, configuration `Screenshots`, app target
`FoldingScreenshots`, UI test target `FoldingScreenshotTests`. Tests are
`testToday`, `testHistory`, `testLeaderboard`, and `testSettings`; raw Fastlane
snapshot names are `today`, `history`, `leaderboard`, and `settings`.

Launch arguments:

- `--folding-screenshot-scenario`: today, history, leaderboard, or settings.
- `--folding-screenshot-locale`: one of the ten app resource locales.
- `--folding-screenshot-appearance`: light or dark.

Fastlane supplies matching Apple language/locale arguments through its pinned,
unmodified SnapshotHelper. Tests append their scenario after helper setup and
require the screenshot-root accessibility identifier before capturing. Unknown
scenario/locale/appearance fails startup rather than producing mismatched assets.

The screenshot application compiles the actual UI sources with Release
optimization. Its explicit source whitelist excludes the normal app entry point,
controller, runtime, network transport, CloudKit composition, purchase store,
notification services, and credentials. Actions use immutable in-memory fixtures
or throw a read-only error; no journal, App Group, production account, network,
notification, or purchase service is instantiated. The tip destination is injected
in the real app and absent in the fixture. Gallery badges/totals are fixture data,
not evidence that physical setup or competition services have passed.

The target supports only the simulator and has a compile-time simulator/flag guard.
The normal device app rejects screenshot activation arguments. Screenshot-specific
flags are not a hidden shipping preview or App Review bypass.

`xcodebuild build-for-testing` succeeded for this scheme/configuration with both
the app and four-test runner. Log: `/tmp/folding-screenshot-build.log`; build output:
`build/screenshot-harness`. Actual capture execution, display-size correctness,
localized layout review, status-bar normalization, captions, and hash manifest
validation remain with the release orchestration/final review pass. No screenshot
acceptance is inferred from compilation.
