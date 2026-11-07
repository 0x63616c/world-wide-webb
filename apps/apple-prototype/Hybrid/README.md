# Control Center native panel

`Panel` is the live iPad SwiftUI app. It shows the native clock, launcher, Home grid, and native full-screen app destinations. The browser dashboard remains available at `https://app.worldwidewebb.co` for ordinary browsers, but the iPad app does not embed or navigate to that site. The hostname remains the default API origin for the native data clients.

## Navigation and data

`PanelApp.swift` owns the scene, live data store, alarm runtime, notifications, update checker, and deep links. `PanelHome.swift` adapts live providers to the shared `HomeView` and native destinations. `PanelAppCatalog` owns launcher identity and order. The Home grid shows a live tile when its provider has data and an unavailable state when it does not; full-screen destinations use the same rule. No route switches to a web board.

The app starts provider reads while active and stops them when the scene leaves the foreground. Alarm data is reconciled separately every second while active. AlarmKit owns ringing, and the next alarm is mirrored into the widget through `PanelAlarms`. An alarm deep link opens the native alarm screen. Notification deep links open the corresponding native screen, including its unavailable state if the provider is down.

The native client reads `PANEL_SERVER_URL` and optional Cloudflare Access credentials from the build configuration, environment, or app defaults via `PanelConfiguration`. A local URL may be used for development. Do not put credential values in this repository or test output. `PanelKit` defines the HTTP contracts and providers. The web app's own build and deployment do not depend on this target.

## Build and verify

The Panel target requires Xcode 26.4 or newer. Generate the project from `project.yml`:

```sh
cd apps/apple-prototype
xcodegen generate
xcodebuild -project WorldWideWebb.xcodeproj -scheme Panel \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build-for-testing
```

Use `-hybridFixtures -hybridStill` in Debug UI tests to serve fixture responses and pause decorative motion. `-hybridUnavailable` makes fixture providers fail so native unavailable states can be tested. There are no module route flags or web-only Settings switch.

The launcher and app destinations are rendered at the wall panel's 1366×1024 point size in the Panel UI suite. Keep screenshot evidence in `docs/screenshots/` and include a pinned raw GitHub URL in PR descriptions.
