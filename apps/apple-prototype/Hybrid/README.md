# Panel hybrid kiosk (WWW-18)

`Panel` is the iPad-only iOS 26+ replacement shell for `apps/panel`, with bundle
ID `co.worldwidewebb.theworkflowengine` and display name **Control Center**.
It is unsigned here. The existing prototype targets are unchanged and none of
their fixture-backed views are compiled into Panel.

## Run and configure

Generate with `xcodegen generate`, select scheme `Panel`, and run on an iPad.
`MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` are ordinary build settings;
a future release lane must set them to the next TestFlight version/build.

Copy `Config/Secrets.example.xcconfig` to the gitignored `Config/Secrets.xcconfig`
and populate it locally when needed. Xcode expands its settings into Info.plist;
the config directory is excluded from the target's resources. **Never commit
populated settings, print them, or attach build logs containing them.** With no
settings, the app loads `https://app.worldwidewebb.co` without Access headers.
Both Access fields must be present to send either header.

| Setting | Info.plist | UserDefaults / launch argument | Launch environment |
| --- | --- | --- | --- |
| Server | `PanelServerURL` | `serverUrl` | `PANEL_SERVER_URL` |
| Access ID | `PanelCFAccessClientID` | `cfAccessClientId` | `PANEL_CF_ACCESS_CLIENT_ID` |
| Access secret | `PanelCFAccessClientSecret` | `cfAccessClientSecret` | `PANEL_CF_ACCESS_CLIENT_SECRET` |
| Alarm token | `PanelAlarmAPIToken` | `alarmApiToken` | `PANEL_ALARM_API_TOKEN` |

Precedence: launch environment, UserDefaults (including launch arguments), plist,
then the public server default / empty credentials. Empty overrides intentionally
clear a field. Unresolved `$(SETTING)` values are treated as empty. Use Xcode's
local environment UI for sensitive development overrides; avoid shell history.
Configuration and flags are read once at launch. For local HTTP development,
use `localhost` (ATS local networking is enabled).

## Module seam

`ModuleFlags` defines `lights`, `climate`, `fan`, `wifi`, `sonos`, `weather`, and
`all`. Every flag defaults to `web`. For example, `-moduleFlag.lights native`
overrides the launch's UserDefaults; invalid values fall back to `web`.
`all` always means the complete web board, even if its flag is set to `native`.

`HybridRouter.route(for:hasLiveData:)` selects native only when the individual
flag is `native` **and** a native implementation has live data. The generic
`HybridModuleHost` receives an optional live view and a web fallback closure;
nil data, a missing implementation, or a `web` flag selects the fallback.
The current root hosts `all` with no native registrations, so even flipping an
individual flag cannot display prototype fixtures.

WWW-11…16 can add provider-backed views to Panel's target (including selected
files from `Sources` via `project.yml`, excluding `Sources/App.swift`). Their
composition owns which module is visible and retains **one** web board for the
remaining modules. Pass a live view only after a successful provider read;
remove it when the provider cannot supply real data. Do not create one full
WKWebView per module or treat a native flag as proof of data availability.
Mixed-module geometry and native views are intentionally deferred.

## Kiosk and bridge behavior

- New launch / recovery URLs carry `boot=<generation>-<launchedAtMs>`, preserving
  existing query parameters and fragments. This follows WWW-18's requested key;
  Expo currently uses `shellBoot=<launchedAtMs>-<generation>`. Immutable asset
  caching is retained.
- The document-start bootstrap preserves `__CONTROL_CENTER_EXPO__` and
  `ReactNativeWebView.postMessage`, so the deployed board needs no changes.
- After document load, the script polls `#root` every 250ms and reports a blank
  boot after 15s. The native watchdog grows from 30s to 120s; remount backoff is
  1/2/4/8/16/30s. A successful render cancels recovery and resets failures.
  Navigation errors and WebContent termination also remount; old generations
  cannot report into a new one. The overlay says “Reconnecting…”.
- Navigation preserves Expo's host allow-list (`localhost`, the server host,
  `*.worldwidewebb.co`, `about:blank`, `blob:`). External HTTP(S) links and
  `window.open` use a system Safari sheet with Done. Safari has no bridge or
  service-token headers. Unsupported schemes are rejected.
- Privileged messages require the main frame's security origin **and** current
  page origin to match the configured server (scheme, host, effective port).
  The broader navigation allow-list never grants bridge access. Access headers
  are attached only to main-frame requests for the configured origin.
- Responses use the existing `control-center-native-response` custom event.
  JSON travels as a JavaScript argument, not interpolated executable code.
  The script rechecks the origin at evaluation time to handle navigation races.
- Device info uses hardware model / identifierForVendor; unknown battery level
  is null; brightness is finite and clamped to 0…1 on the containing screen.
  Share uses UIActivityViewController; browser open/close use SFSafariViewController.
  Share acknowledges presentation immediately, within the web bridge's 5s
  timeout (it does not wait for the user to finish sharing).
- Inline autoplay is enabled, previews/back-forward gestures are disabled,
  same-origin camera/microphone capture is granted at the WebKit layer (iOS
  permission still applies), audio plays in silent mode, and the app stays awake.
- `controlcenter://alarms` dispatches `control-center-open-alarms`. Cold-launch
  links remain queued through recovery until `#root` reports a successful render.

## Before wall install

1. **Native alarm parity is implemented (WWW-47).** The Expo ActivityKit
   coordinator is ported into `Hybrid/Alarms` without its Expo wrapper.
   `syncNextAlarm` awaits sync and returns `ok:true` on success (including
   `next:null`); malformed snapshots or ActivityKit errors return `ok:false`.
   Launch configuration stores the alarm transport in Keychain only when an
   alarm token is present, using `PanelConfiguration`'s server and Access fields.
   Every foreground refresh waits for configuration before fetching `/api/alarms`.
   Without a token, native transport is skipped; web snapshots still sync.
   The Keychain service/account and device-only after-first-unlock accessibility
   match Expo. The coordinator retains Expo's explicit empty-token revocation
   API; skipping configuration does not delete previously stored credentials.
   Redirects never receive these credentials. The embedded `NextAlarmWidget`
   shares `NextAlarmAttributes` with Panel; `NSSupportsLiveActivities` is enabled
   and the Expo plugin adds no alarm-specific entitlements to copy.
   `CreatePanelAlarmIntent` / `PanelAlarmShortcuts` create alarms through the same
   coordinator. ActivityKit start/update/end behavior, countdowns, stale state,
   and `controlcenter://alarms` links match Expo. Ringing and alarm management
   remain in the web board; this is not an AlarmKit scheduler.
2. A release lane must sign/archive Panel, provide a production app icon and
   private settings, and set a build number above the existing TestFlight build.
   The Expo push/monthly release workflow still owns the same bundle ID and must
   be switched before installing this shell, or a later Expo release can replace it.
3. Validate on the wall device with credentials: Access session/redirects, actual
   board rendering, wake-photo camera permission, audio, backlight dim/wake,
   sharing, and foreground/background recovery. Verify a real alarm's Live Activity
   appears, updates, and ends; its deep link opens the web alarms; and the creation
   Shortcut succeeds. Confirm web ringing still works. Simulator checks without secrets
   cannot establish authenticated end-to-end or physical hardware parity.

## Verification

Source the worktree's `.job.env` before checks on the box. Use a separate checkout
on the Mac mini (`~/wwwebb-hybrid`) and derived data (`~/wwwebb-hybrid-dd`), never
the design worker's directories or simulator. With
`DEVELOPER_DIR=/Applications/Xcode-27.0.app/Contents/Developer`:

```sh
/opt/homebrew/bin/xcodegen generate
xcodebuild test -scheme Panel \
  -destination 'platform=iOS Simulator,name=WWW-18 Hybrid iPad' \
  -derivedDataPath ~/wwwebb-hybrid-dd -parallel-testing-enabled NO
xcodebuild build -scheme WorldWideWebb-iPad \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath ~/wwwebb-hybrid-dd
xcodebuild build -scheme WorldWideWebb \
  -destination 'platform=macOS' -derivedDataPath ~/wwwebb-hybrid-dd
```

`PanelTests` covers flags, native/live-data routing, navigation and bridge origin
checks, boot URLs/backoff, request/response encoding, configuration precedence,
brightness validation, and the actual JavaScript boot scripts in JavaScriptCore.
These tests do not require network or secrets.

The optional `Panel-Smoke` scheme runs `HybridUITests` on the dedicated simulator:
it rotates the device to landscape, launches the actual app against an unavailable
local URL, checks the recovery overlay and landscape window, and attaches a real
simulator screenshot. It does not authenticate or use a fixture board.

```sh
xcodebuild test -scheme Panel-Smoke \
  -destination 'platform=iOS Simulator,name=WWW-18 Hybrid iPad' \
  -derivedDataPath ~/wwwebb-hybrid-dd -parallel-testing-enabled NO
```

Verified on the mini on 2026-10-29: **27 Panel tests passed**, and both existing
`WorldWideWebb-iPad` and `WorldWideWebb` schemes built successfully. Tracked-file
lint, Knip, privacy guards, and Gitleaks passed. The optional UI smoke target
compiled, but its runner exited before test bootstrap; a retry stalled and was
interrupted. No UI smoke assertions ran. The mini was under heavy load, and its
Xcode installation has no Simulator GUI app. After restarting only the dedicated
simulator, the final unit run succeeded. Simulator evidence is captured directly
with `simctl`; authenticated board and physical wall checks remain outstanding.


### WWW-47 alarm verification

Use `~/wwwebb-hybrid-47/`, derived data `~/wwwebb-hybrid-47-dd/`, and the dedicated
`WWW-47 Hybrid iPad` simulator for this ticket. Do not use `~/wwwebb-proto`.

```sh
export DEVELOPER_DIR=/Applications/Xcode-27.0.app/Contents/Developer
cd ~/wwwebb-hybrid-47
/opt/homebrew/bin/xcodegen generate
xcodebuild build -scheme Panel -destination 'generic/platform=iOS' \
  -derivedDataPath ~/wwwebb-hybrid-47-dd CODE_SIGNING_ALLOWED=NO
xcodebuild test -scheme Panel \
  -destination 'platform=iOS Simulator,name=WWW-47 Hybrid iPad' \
  -derivedDataPath ~/wwwebb-hybrid-47-dd -parallel-testing-enabled NO
```

Alarm unit tests decode the actual snapshot contract (next present/null/malformed)
and exercise bridge success/error responses with an injected coordinator, plus
configuration/refresh ordering. They require no credentials or live alarms.
Panel and the extension both target iOS 26.0. The port uses ActivityKit 16.2,
WidgetKit, and App Intents APIs available before iOS 26; no iOS 27 API is needed.
The widget source and shared attributes match Expo; intent metadata uses immutable
static properties for Swift 6 concurrency checking.
