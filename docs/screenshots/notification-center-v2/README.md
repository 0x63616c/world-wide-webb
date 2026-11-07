# Notification Center v2

Captured from the native Panel app in the iOS 27.2 iPad Pro simulator, at the
panel's 1366×1024 logical resolution. XCTest screenshots were orientation-normalized
and exported at 1×. These are the existing Debug-only notification fixtures; no
production notifications were created or cleared.

- `inbox.png`: compact inbox, source grouping, quiet reading surface and glass header.
- `expanded.png`: expanded source group and notification hierarchy.
- `empty.png`: cleared inbox.
- `banner.png`: incoming banner with separate dismiss and history controls.
- `banners.png`: expanded stack with controls directly below the cards.
- `dark-inbox.png`: dark appearance over the Climate app, above app navigation.
- `accessibility.png`: largest accessibility text size.
- `interaction.mp4`: 19-second recording of opening, expanding, clearing and closing.

The final captures include right-aligned timestamps with a single completed age
unit and no seconds. All four history UI scenarios passed again after this change,
including largest text, dark appearance and saved-history deep links; all 33
notification/presentation/update unit tests passed, including age-unit boundaries.

Validation includes workspace `bun run typecheck`, native notification state and
presentation unit tests, and simulator UI coverage for banner gestures, deep links,
timeouts, stack expansion, saved history, source/row/all clearing, app-overlay order,
large text. The release retains persistent update notices and the app’s always-enabled animations.

UI test commands use `xcodebuild -project WorldWideWebb.xcodeproj -scheme
Panel-Smoke` with `-only-testing:PanelUITests/NotificationBannerTests`,
`-only-testing:PanelUITests/NotificationHistoryTests` and
`-only-testing:PanelUITests/UpdateReadyBannerTests`. Notification unit tests use
the `Panel` scheme and `PanelTests/NotificationCenterTests`,
`PanelTests/NotificationBannerPresentationTests`, and `PanelTests/UpdateCheckerTests`.
