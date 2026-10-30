# Panel hybrid kiosk (WWW-18)

`Panel` is the iPad-only iOS 26+ replacement shell for `apps/panel`, with bundle
ID `co.worldwidewebb.theworkflowengine` and display name **Control Center**.
It is unsigned here. The prototype targets still default to their fixtures. Panel
compiles their shared presentation models and views, excludes `Sources/App.swift`,
and injects `LiveHomeDataSource` at its own router. No mock source is instantiated
by the Panel root.

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
The root retains one WKWebView across native navigation. With all flags at their
`web` default, it renders the same full-screen board with no native navigation and
starts no providers. With flags enabled, it initially selects the first enabled
module in registry order; that selection stays on the board until its provider
supplies data. A module strip offers the available native modules and **Web board**.
Each native module opens on its existing tile; **Details** opens its existing
controller. A failed selected provider immediately returns to the board, and a
successful subsequent poll restores the native selection. Deep links select the
web board before delivering the existing alarm event.

### Live composition (WWW-44)

`LiveHomeDataSource` composes the six existing live providers. `hasLiveData(for:)`
requires a successful current provider state, plus a nonempty guest SSID, weather
snapshot, or at least one available Sonos room where applicable. An off light,
fan, or thermostat is still real data. A successful empty response is not enough
for Wi-Fi, weather, or Sonos. Provider errors never fall through to a mock, even
when the provider retains its last successful snapshot internally.

The legacy `HomeDataSource` has nonoptional numeric fields. Unavailable fields
therefore use neutral zero/false values, empty collections, nil credentials and
explicit “Unavailable” text; the router prevents those module placeholders from
being rendered as readings. Climate and fan labels use independently reported
values, including “Unavailable” for a missing fan. Off-mode null setpoints stay
zero instead of inheriting prototype temperatures. Unimplemented providers are
empty and inert. Commands without a live backend (alarms, media-library playback,
seeking) do nothing; they never mutate fixtures.

Sonos identity uses backend IDs independently of room display names. Unknown or
unavailable rooms are omitted. Missing metadata stays nil, and duration/position
stay zero. The native controller is `SonosRoomsPage`, which supports grouping and
volume without the prototype's fixture artwork or unsupported playback scrubber.
Name-based prototype group shortcuts only resolve when the name is unambiguous.
Lights retain the existing provider's group projection; the API does not report
individual lamp RGB or party speed. Unreported lamp colors use neutral values.

Only requested providers poll: every 10 seconds, or 10 minutes for weather.
Controls and Climate also read Fan because their existing controllers include it;
Controls reads Climate for its fan-state presentation. These data dependencies do
not enable the other modules' routes. Structured polling tasks cancel when Panel
leaves the foreground. Writes are owned/cancelled by the existing providers. API
configuration comes from the same launch snapshot as WebKit; Access headers are
sent only as a complete pair. The shared transport is an ephemeral URLSession with
no disk URL cache, credential storage, or cookie storage.

### Small presentation injection seams

No view layout, spacing, hierarchy, animation, or styling under `Sources/` changes.
The exact edits are:

- `HomeDataSource.swift`: weather fields become initializer-injectable `var`s,
  with the same fixture defaults; add an injectable weather symbol. Add optional
  reported climate action/fan label, and optional Sonos metadata with a stable ID
  and nullable track fields. Nil overrides preserve all prototype behavior.
- `HomeView.swift`: `AccessoryFace` accepts optional `fanIsOn`, defaulting to its
  original calculation, so a live fan does not require an invented HVAC mode.
- `Live/LiveLightsProvider.swift`: its initializer accepts `initialLamps`, defaulting
  to the existing fixture state; Panel supplies neutral unavailable state instead.
- `WeatherViews.swift`: the two current-condition glyphs read the injected symbol.
- `ModulePages.swift`: `WeatherPage`'s current-condition glyph reads that symbol.

### Deterministic fixture mode

Debug builds accept `-hybridFixtures`. This is an explicit transport injection,
not a mock HomeDataSource: all six real providers decode their existing PanelKit
JSON fixtures from the bundled `Fixtures` folder. It uses a fixed loopback URL for
WebKit and a transport with no network fallback. No runtime configuration,
Keychain credentials, or home services are read. `-hybridUnavailable` additionally
makes every provider fail, for fallback checks. `-hybridDetail` opens the selected
module directly on its detail page for simctl captures. Unknown writes fail closed; this
is a capture harness, not an interactive home-service simulator. Release builds
compile out the fixture transport and launch switches.

```sh
xcrun simctl launch <own-simulator-id> co.worldwidewebb.theworkflowengine \
  -hybridFixtures -moduleFlag.weather native
```

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
on the Mac mini (`~/wwwebb-hybrid-44`) and derived data (`~/wwwebb-hybrid-44-dd`), never
the design worker's directories or simulator. With
`DEVELOPER_DIR=/Applications/Xcode-27.0.app/Contents/Developer`:

```sh
/opt/homebrew/bin/xcodegen generate
xcodebuild test -scheme Panel \
  -destination 'platform=iOS Simulator,name=WWW-44 Hybrid iPad' \
  -derivedDataPath ~/wwwebb-hybrid-44-dd -parallel-testing-enabled NO
xcodebuild build -scheme WorldWideWebb-iPad \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath ~/wwwebb-hybrid-44-dd
xcodebuild build -scheme WorldWideWebb \
  -destination 'platform=macOS' -derivedDataPath ~/wwwebb-hybrid-44-dd
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
  -destination 'platform=iOS Simulator,name=WWW-44 Hybrid iPad' \
  -derivedDataPath ~/wwwebb-hybrid-44-dd -parallel-testing-enabled NO
```

Verified on the mini on 2026-10-29: **27 Panel tests passed**, and both existing
`WorldWideWebb-iPad` and `WorldWideWebb` schemes built successfully. Tracked-file
lint, Knip, privacy guards, and Gitleaks passed. The optional UI smoke target
compiled, but its runner exited before test bootstrap; a retry stalled and was
interrupted. No UI smoke assertions ran. The mini was under heavy load, and its
Xcode installation has no Simulator GUI app. After restarting only the dedicated
simulator, the final unit run succeeded. Simulator evidence is captured directly
with `simctl`; authenticated board and physical wall checks remain outstanding.


### WWW-44 checks

The composition suite can also run without a simulator on the mini's macOS 15.6:

```sh
DEVELOPER_DIR=/Applications/Xcode-27.0.app/Contents/Developer \
  bash scripts/test-hybrid-models.sh
```

This generates a temporary macOS framework/test project and executes the same
`HybridTests/LiveHomeDataSourceTests.swift` against the original composition,
provider, and model sources. The only extraction is the unchanged model prefix
of `TeslaProvider.swift`, whose unrelated views require macOS 26. Set
`WWW_HYBRID_CHECK_DIR` to an owned directory to retain/reuse the generated project,
derived data and result bundle. It does not modify the production project.

Verified on 2026-10-30: all **12 composition tests passed**, PanelKit's **1 XCTest
and 26 Swift Testing tests passed**, and both `Panel` (iOS Simulator) and the
existing `WorldWideWebb` (macOS) app built. `Panel-Smoke` also built. The simulator
hosted unit run stalled before executing tests and was interrupted; the UI runner
was killed before establishing its test connection, so no UI assertions ran.
The module captures use the actual Panel app launched directly with `simctl`,
`-hybridFixtures`, each `-moduleFlag.<module> native`, and `-hybridDetail` for the
controller. Authenticated home-service and physical wall-device checks remain
outside this fixture verification.

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


Verified on 2026-10-30 with Xcode 27.0: the unsigned iOS device build passed with
`NextAlarmWidget.appex` embedded and validated, and App Intent metadata generated.
Both built products report `MinimumOSVersion=26.0`. **All 35 PanelTests passed**
on the dedicated iOS 26.3 iPad simulator. The initial runner launch failed before
any tests ran (Mach error -308); after restarting only that simulator,
`xcodebuild test-without-building` passed. The SSH connection later reset, but the
completed `PanelTests-retry.xcresult` and `test-retry.log` confirmed success.
Repository typecheck, tracked-file lint, Knip, privacy guards, and Gitleaks passed.
Only Xcode 27 is installed on the mini; an Xcode 26.x build was not run there.

Build and test output screenshots are in `Verification/` (excluded from Panel's
resources), within this ticket's allowed paths. They document build and test
results, not authenticated Live Activity rendering on the wall.
