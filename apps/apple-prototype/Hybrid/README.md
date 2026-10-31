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

## Home launch and Classic (WWW-64; Refs WWW-63)

Panel launches the approved `Sources/HomeView.swift` with `LiveHomeDataSource`
on every normal launch, including when every module flag is Web. This is the
same wallpaper, four faces, FacePicker and zoom presentation used by the design
app. The separate prototype target still uses fixtures. Panel never instantiates
`MockHomeDataSource`.

Home starts every provider represented by `HomeTile.panelProviders`, independently
of controller flags: lights, climate, fan, Wi-Fi, weather, Sonos, photos, walk,
alarms, calendar, media, Tesla and cameras. Reminders has no Home tile and does not
start. Reads stop with the scene lifecycle. Provider failure shows **Unavailable**,
empty collections or a missing complication rather than invented readings.
Photos is a locked launcher; the existing live photo controller requires a fresh
PIN. The Home music face uses the production Sonos artwork/playback adapter.
Only LakeWallpaper and CloudPhoto image sets are linked into Hybrid's asset
catalogue; prototype photo fixtures and local video stay out of Panel.

The small bottom-trailing **Classic** entry (`safari`) opens the full legacy web
board. The existing WKWebView remains mounted behind Home and native controllers.
Classic and module fallbacks hide the module strip and always show a top-leading
glass **Home** button, including during loading and reconnection. No rollout flag
is needed. iOS Settings > Panel > **Web board only** (`hybrid.webOnly`) restores
launch directly into the web board, starts no Home providers and hides Home
navigation. Settings changes take effect on next launch.

Module flags still select controllers: shipped native defaults remain lights,
climate, fan, weather and walk (`ModuleFlags.shippedNative`). Other controllers
use the web fallback unless opted into native. A native controller also requires
current live data; alarms additionally require native ringer ownership. A failed
provider returns its open controller to Classic. `all` always means the complete
web board. `-moduleFlag.lights native` overrides the launch's UserDefaults;
`default` uses the shipped value and invalid values fall back to `web`.

`HomeIntegration` supplies optional tile, preflight routing and destination hooks.
Web fallbacks select Classic before starting a native cover transition. Hybrid owns live
adapters, Classic, the alarm ring overlay, deep links and UpdateBanner; Sources
keeps the design layout and zoom transitions. Ringing and updates are also shown
above Home's full-screen controllers. `controlcenter://alarms` retains its native
ownership/live-data check and existing web event fallback. XCTest unit-test hosts
still render `Color.clear` without starting WebKit or providers.

`HomeViewLaunchTests` covers launch → HomeView → Classic → Home, unavailable
readings and the Settings rollback. Existing Hybrid UI suites enter from Home
before exercising their provider/controller paths. `Panel-Smoke` reaches the real
offline recovery screen through Classic. Fixture runs freeze decorative animation through the existing `motionPhase` seam
while keeping interactive transitions. Fixture alarm ownership ignores retries of
the deliberately unreachable loopback web board. Wi-Fi purges credentials on
backgrounding and keeps its controller mounted behind a loading state until the
foreground read finishes. Captures are synthetic XCTest attachments,
not committed binaries; authenticated production rendering remains a device check.

### Live composition (WWW-44)

`LiveHomeDataSource` composes the six existing live providers. `hasLiveData(for:)`
requires a successful current provider state, plus a nonempty guest SSID, weather
snapshot, or at least one available Sonos room where applicable. An off light,
fan, or thermostat is still real data. A successful empty response is not enough
for Wi-Fi, weather, or Sonos. Provider errors never fall through to a mock, even
when the provider retains its last successful snapshot internally.

Media's production adapter currently reports unavailable because the backend has
no catalogue or playable video route. See the WWW-33 section below.

The legacy `HomeDataSource` has nonoptional numeric fields. Unavailable fields
therefore use neutral zero/false values, empty collections, nil credentials and
explicit “Unavailable” text; Home replaces unavailable tiles before they can render those values as readings. Climate and fan labels use independently reported
values, including “Unavailable” for a missing fan. Off-mode null setpoints stay
zero instead of inheriting prototype temperatures. Unimplemented providers are
empty and inert. Commands without a live backend (media-library playback) do nothing; they never mutate fixtures.

Sonos identity uses backend IDs independently of room display names. Unknown or
unavailable rooms are not actionable. Missing metadata stays nil. Now Playing
uses a complete coordinator position/duration/sample-time tuple when present;
otherwise its scrubber is hidden. The full-screen Rooms controller includes
join/leave/join all, TV/Beam and line-in actions, per-room mute and calibrated
volume. See WWW-30 below. Name-based prototype shortcuts only resolve when
unambiguous.
Lights retain the existing provider's group projection; the API does not report
individual lamp RGB or party speed. Unreported lamp colors use neutral values.

Every Home provider polls while Home is enabled: every 10 seconds, 10 minutes for weather, or one second for alarms.
Controls and Climate also read Fan because their existing controllers include it;
The fan's on/off state is injected independently of HVAC mode. This data dependency
does not enable the Fan route. Structured polling tasks cancel when Panel
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
  and nullable track fields/coordinator name. Nil overrides preserve all prototype behavior.
- `HomeView.swift` and `Controllers.swift`: `AccessoryFace` and `ControlsController`
  accept optional `fanIsOn`, defaulting to their original calculations, so a live
  fan does not require an invented HVAC mode.
- `Live/LiveLightsProvider.swift`: its initializer accepts `initialLamps`, defaulting
  to the existing fixture state; Panel supplies neutral unavailable state instead.
  Each snapshot resets a missing scene/color slot to that injected fallback, so
  later null fields cannot retain a previous scene or saved color.
- `WeatherViews.swift`: the two current-condition glyphs read the injected symbol.
- `ModulePages.swift`: `WeatherPage`'s current-condition glyph reads that symbol.
- `SonosRoomsPage.swift`: the group label reads the injected coordinator display
  name; grouping commands continue using stable backend IDs.

### Deterministic fixture mode

Debug builds accept `-hybridFixtures`. This is an explicit transport injection,
not a mock HomeDataSource: the HTTP providers decode their existing PanelKit
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

## Tesla live provider (WWW-36)

Tesla is opt-in: the new tesla module defaults to web, including shipped builds.
It is not part of ModuleFlags.shippedNative. Settings > Panel > Car offers Web
and Native, applied at next launch. The equivalent launch argument is
-moduleFlag.tesla native; -moduleFlag.tesla web restores fallback.
The global Web board only switch still wins. Select Car in the module strip
when other native modules are enabled.

PanelKit TeslaAPI reads tesla.state and posts tesla.command. LiveTeslaProvider
conforms to the existing TeslaProvider without changing its protocol, mock,
tile, or controller. Hybrid injects the provider and wraps the unchanged
controller with lock/unlock and a full-page PIN confirmation. Every command
requires a fresh six-digit panel PIN; cancellation, navigation away, or
backgrounding clears the prompt. PINs are held only for the current submission,
never stored in defaults/Keychain or put into URLs. Server verification uses the
same persisted panel PIN and fails closed when settings cannot be read.

Backend PR: https://github.com/0x63616c/world-wide-webb/pull/829 (separate main PR,
left unmerged). Missing endpoint, unconfigured mapping, incomplete telemetry,
network/HA failures, or stopped providers all route to web. Poll recovery
restores the route only while the native flag is enabled. No mock data appears
in live mode. HA acceptance does not optimistically alter battery, locks,
charging, or climate: the provider re-reads reported state. Commands are never
automatically retried. HA owns telemetry refresh timing; this module does not
wake the vehicle.

Fixture launch checks (use only a simulator owned by this job):

    xcrun simctl launch <own-simulator-id> co.worldwidewebb.theworkflowengine \
      -hybridFixtures -moduleFlag.tesla native

Add -hybridDetail for the controller, or -hybridUnavailable to verify the web
fallback. The fixture transport runs the real API decoder/provider using
synthetic JSON and refuses all commands by default. For real rollout, configure
the backend's optional TESLA_ENTITIES mapping and a persisted panel PIN, verify
the HA integration, then launch without -hybridFixtures and opt in with
-moduleFlag.tesla native. No Tesla credentials belong on the client.

The only Sources file added by WWW-36 is Live/LiveTeslaProvider.swift. No
existing design-worker Sources, UITests, scripts, or design docs are changed.
The existing views require all numeric readings, so missing odometer/cabin
temperature/power also falls back instead of rendering invented values.
Location/name metadata is deliberately absent; the label is simply Tesla.
Production HA integration presence and real vehicle command execution remain
rollout checks, not claims made by fixture tests.

## Live Calendar (WWW-31)

Source decision: `apps/api/src/trpc/routers/index.ts`, the generated feature
router, and `features/*/api.ts` have no calendar event feed (the settings calendar
time zone is unrelated). Calendar therefore reads **on-device EventKit** from
the calendars already configured on the iPad. No backend, web, Expo, credentials,
or server-side calendar integration changes are needed.

`PanelKit/CalendarAPI.swift` owns the read-only value boundary and actor-isolated
EventKit adapter. Apple requires **full access** to read existing events; there
is no read-only permission level. The API exposes no save/delete operations.
Only `Hybrid/Info.plist` gains `NSCalendarsFullAccessUsageDescription`. The
prototype targets keep their mock providers and do not request access.
`project.yml` is unchanged; its `Panel` scheme already includes `PanelTests` and
`WorldWideWebbTests` for one simulator test invocation.
See [Apple's EventKit access guide](https://developer.apple.com/documentation/eventkit/accessing-calendar-using-eventkit-and-eventkitui).

`LiveCalendarProvider` conforms to the existing `CalendarProvider`. It reads
from local midnight through the next seven calendar days in the device time
zone, including events that overlap midnight. Calendar arithmetic handles DST;
all-day events have an explicit label, timed events retain actual durations,
and recurring occurrences use the EventKit item ID plus occurrence start.
Canceled events are omitted. No notes, attendees, URLs, account identifiers or
credentials are read. Event values stay in memory and are never logged.

The existing Home **Up Next** tile (`ModuleTile`) and Calendar page (`AgendaPage`)
receive this same provider via `LiveHomeDataSource` and `HybridNativeModule`.
The page lists today and upcoming events, with dates on entries outside today;
Up Next prefers ongoing/upcoming timed events, then all-day events. Completed
events remain visible on today's list. Empty or denied/unavailable data routes
to the retained web board. Calendar still defaults to `web`; the default launch
does not open EventKit, read events or prompt. When explicitly enabled, permission
is requested only if undetermined. Denied/restricted/write-only states do not
prompt repeatedly. Foreground polling every 10 seconds catches edits, midnight,
time-zone and permission changes. Backgrounding clears events and invalidates
in-flight results; foregrounding reads and checks access again.

Minimal presentation injection seams (no layout, style or hierarchy changes):

- `Sources/ModuleProviders.swift`: optional time/period/duration labels on
  `AgendaEvent`, plus provider heading/date formatting requirements with defaults
  matching the mock's original labels and fixture time zone.
- `Sources/ModulePages.swift`: the Calendar heading, date and duration texts read
  those injected values.
- `Sources/ModuleTiles.swift`: the Calendar tile's weekday/day texts use the
  provider's date formatter.
- `Sources/Live/LiveCalendarProvider.swift`: new live implementation; no existing
  live provider is edited.

Check first using the dedicated simulator and synthetic fixtures (Debug only):

```sh
xcrun simctl launch <own-calendar-simulator-id> co.worldwidewebb.theworkflowengine \
  -hybridFixtures -moduleFlag.calendar native
# Calendar page: add -hybridDetail. Denied feed: add -hybridUnavailable.
```

The Calendar fixture store reads `Fixtures/calendar/events.json` at a fixed
2026-10-30 10:30 PDT. It never creates EventKit or contacts home services.
`-hybridUnavailable` exercises the web fallback with a denied source. To check
real calendars, configure Calendar accounts on the device, then relaunch Panel
with **`-moduleFlag.calendar native`**, without `-hybridFixtures`, and grant the
system Calendar request. Select Calendar in the module strip (other live modules
may also be enabled). Validate the tile and Details against Calendar, then
revoke access in Settings and confirm web fallback. Restore the wall's default
with `-moduleFlag.calendar web` (or remove the native override). Do not persist a
native override on the wall until that device check passes.

Fixture checks cannot establish account sync or actual iPad consent behavior;
those remain a physical-device acceptance check. No backend PR is needed.

Verified on the shared mini on 2026-10-30 with Xcode 27: PanelKit's **40 Swift
Testing tests and 2 XCTest tests passed**. One `xcodebuild test -scheme Panel`
invocation passed **50 Panel tests and 27 app tests**, including all 9
`LiveCalendarProviderTests`, the existing mock Calendar test, routing/fallback,
and real SwiftUI render captures at 1366×1024. The app test selection was
`LiveCalendarProviderTests`, `ModuleProviderTests`, and `HomeDataSourceTests`.
Screenshots live at the repository root under `docs/screenshots/calendar-live/`.

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
   remain in the web board by default. WWW-37 adds the opt-in AlarmKit scheduler below.
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
controller. `scripts/capture-hybrid.sh <own-UDID> <output>` waits for a marker from
mounted fixture content before each capture, including the two web fallback cases.
Authenticated home-service and physical wall-device checks remain
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

### WWW-35 Photos

`photos` defaults to `web`. Opt in with `-moduleFlag.photos native`; remove the
argument or use `-moduleFlag.photos web` to return to the complete web board.
Native routing requires successful `boothPhotos.list`, `wakePhotos.list` and
`sessions.list` reads with at least one photo. Empty/unavailable listings keep
WebKit mounted. Only opted-in Photos polls (60 seconds).

The native frame cycles captures every 12 seconds, pausing automatic rotation
for Reduce Motion. Previous/Next remain available. Details show the capture,
remove/clear-filter controls for booth groups, and read-only Activity sessions.
Wake photos have no delete or clear endpoint, and expose no such actions.
Remove acts on the entire booth group, with confirmation; clear means the
existing non-destructive `boothPhotos.clearFilter`, never a collection-wide wipe.

Because this combined surface includes private booth captures, **every opening**
(including the frame) requires the synced six-digit panel PIN from `settings.get`.
No PIN default is embedded in native code. Like the web (ADR-0004), this is a
client-side gate. It deliberately applies booth's stricter private policy to
wake photos too; it does not import or extend WebKit's shared Activity PIN
session. Closing, switching face/details, backgrounding, or losing live data
relocks it. The prototype and its mock provider are unchanged.

Images use `PanelAPIClient` media requests with paired CF Access headers, a
redirect-rejecting ephemeral transport, and a bounded memory/disk cache (24
images). Source bytes remain immutable, protected on disk and excluded from
backup; no credentials are cached. Removal purges the cache. No backend changes.
GIF captures currently display their first frame; four-frame/burst captures
cycle as individual frames. Native capture/upload and session event drill-down
remain on the web. Stored booth color effects are applied at display time;
Core Image hue/color processing may differ slightly from browser CSS.

For credential-free fixture checks, launch Panel with:

```sh
-moduleFlag.photos native -hybridFixtures -photosFixturePIN 135790
# Add -hybridDetail for the detail page; omit -photosFixturePIN to check the gate.
# Add -hybridUnavailable to check fallback. The PIN above is synthetic fixture data.
```

The debug-only fixture argument submits the supplied PIN through the actual gate
against bundled `settings.get` data. Fixture mode fixes the server/transport to
local data. It cannot unlock a configured live server. Never pass a real PIN or
Access token via a shell command. Physical-panel/authenticated production checks
require local configuration and are separate from these fixture checks.

Verified 2026-10-30 with Xcode 27.0 on the dedicated iOS 26.3
`WWW-35 Photos iPad` simulator: 48 Panel tests and 102 app tests passed in one
combined test run. PanelKit passed 5 XCTest tests plus 35 Swift Testing tests.
Repository typecheck and push quality/privacy/secret checks passed. Direct
simulator captures exercise the native frame, automatic rotation, details,
fresh PIN gate and unavailable fallback using the launch arguments above.
See `docs/screenshots/photos-live/` at the repository root. Authenticated home
photos and physical-panel behavior were not tested.

## Dog Walk composition (WWW-49)

The shared PanelKit coordinator and walk provider adoption are documented in
[../PanelKit/SYNC.md](../PanelKit/SYNC.md). `LiveHomeDataSource` now constructs
`LiveWalkProvider` with the same PanelKit configuration and memory-only transport
as the other modules, and identifies starts as `ipad`. `walks` exposes that provider.
Only `.live` state enables the native route; an idle state and empty history are
valid. An absent endpoint, missing configuration, or failed state refresh returns
to the retained web board even when the provider retains its last known walk.
A later successful refresh restores the selected native surface.

`refresh(.walk)` refreshes state/history. `run(modules:)` activates the existing
four-second SyncCoordinator only when walks are requested, retaining its bounded
backoff. Cancellation or `stop()` deactivates it; returning to the foreground reads
immediately. Submitted mutations keep their existing provider-owned lifecycle.

`HybridNativeModule` reuses `DogWalkTile` and `DogWalkPage` unchanged, disabling
their controls during pending writes. `HybridWalkDataSource` projects only those
views onto server time and converts command dates back to local time before the
provider applies its offset. Other modules keep the local clock. No `Sources/`
files, prototype views, or flag defaults change. `ModuleFlags()` and fixture runs
still default to web; the shipped native set established by WWW-48 still includes
walk. The route requires both a native flag and live data.

Check with synthetic data and no credentials or home-service access:

```sh
xcrun simctl launch <own-walk-simulator-id> co.worldwidewebb.theworkflowengine \
  -hybridFixtures -moduleFlag.walk native
# Add -hybridDetail for the page, -hybridWalkActive for an active walk,
# or -hybridUnavailable for the web fallback.
```

The fixture transport uses `walks/state-idle.json` (or `state-active.json`) and
`walks/hybrid-history.json` from PanelKit fixtures. Unknown mutations fail closed.
After that check, launch against the configured API with **`-moduleFlag.walk native`**
and no fixture arguments. Force rollback with **`-moduleFlag.walk web`**, or the
existing Settings > Panel > Web board only switch. No defaults are persisted by
this work. Authenticated home-service behavior and physical wall-device acceptance
remain device checks; simulator evidence uses only synthetic records. No backend
change or PR is needed.

### Reminders (WWW-32)

No reminders/todo router exists in `apps/api` or `features`; the source is the
panel device's EventKit Reminders database. No backend change is required.
`PanelKit/RemindersAPI.swift` requests full reminders access only when the
opted-in module first refreshes. It lists incomplete reminders across accessible
lists, completes by EventKit's stable calendar-item identifier (writable lists
only), and adds to the device's default writable reminders list. It never creates
accounts/lists or uploads, logs, or persists reminder data. EventKit owns sync.
Full access is required by Apple's API for reading reminders:
https://developer.apple.com/documentation/eventkit/accessing-the-event-store.

The new protocol, live provider, and preview mock live in
`Sources/Live/LiveRemindersProvider.swift`; existing design files are untouched.
Hybrid injects that provider into `RemindersModule` for both tile and detail.
The module defaults to web. Opt in at launch with `-moduleFlag.reminders native`
(or `defaults write co.worldwidewebb.theworkflowengine moduleFlag.reminders native`
on an appropriate device defaults domain). Remove that override to restore web.
Grant the system Reminders prompt; denied/restricted/unavailable/fetch or write
failure immediately selects the existing web board, with no mock substitution.
A successful empty list is live data and permits adding the first reminder.
Every opted-in foreground poll refreshes permission and data; other launches
never request Reminders permission. The prototype targets do not start this provider.

Debug `-hybridFixtures -moduleFlag.reminders native` injects synthetic reminders
without touching EventKit or personal data. Add `-hybridUnavailable` to verify
fallback. Fixture writes intentionally fail closed. Unit fixtures separately
exercise successful list/complete/add, empty success, denial/recovery and read-only
completion. Real permission UI, iCloud sync, default-list availability and physical
wall behavior require on-device verification; simulator fixtures do not prove them.

WWW-32 verification (2026-10-30, Xcode 27.0): `cd PanelKit && swift test`
passed 2 XCTest tests and 35 Swift Testing tests. One `xcodebuild test -scheme Panel
-only-testing:PanelTests -only-testing:WorldWideWebbTests/LiveRemindersProviderTests
-parallel-testing-enabled NO` run passed all 48 Panel tests and 4 provider tests
on the owned iOS 26.3 simulator, with derived data in
`~/wwwebb-reminders-live-dd`. The Panel scheme includes the app unit-test target
so the two relevant suites can run in one build. Repository typecheck and push
checks passed. Captures use an owned 13-inch M4 iPad simulator (1376×1032 points) and the
real Panel app with explicit synthetic source injection. The exact-size
12.9-inch simulator (1366×1024 points) stalled on the OS boot spinner, including
a restart; it was removed without touching other jobs. The simulator display remained portrait, so its unmodified screenshots show
the landscape app letterboxed. Exact panel-size and physical landscape visual
verification remain gaps.


### WWW-37: live Clock & Alarms

`-moduleFlag.alarms native` enables the live alarm provider; its code default is
still `web`. The API adapter implements `alarms.list/create/update/setEnabled/
delete/snooze/stop` without any backend changes. Occurrence IDs and versions stay
separate from definition IDs. Polling is every second while active, successful
writes refetch, stale polls cannot replace writes, and conflicts refresh rather
than replay a mutation. The server's `next` is authoritative, including snoozes,
exact dates and DST; the native clock does not compute a competing schedule.

The module becomes native only with current live data, configured native alarm
transport, AlarmKit authorization, and a successful web ownership acknowledgement.
An empty alarm list is valid live data. Missing endpoints, malformed responses,
transport errors, denied authorization, or an old web bundle keep the web fallback.
The backward-compatible web seam is PR
[#820](https://github.com/0x63616c/world-wide-webb/pull/820), merged into main by
`@0x63616c` during verification. This job did not issue a merge. It changes
`features/events/web`, not `apps/web` or
`apps/panel`. Either deployment order is safe: an old bundle has no handoff and
the app cannot activate its native ringer.

There is one audible owner: the web promise acknowledges after its sound cue and
repeat timer have stopped, then the app schedules AlarmKit. Releasing ownership
cancels AlarmKit before resuming the web. Main-frame navigation cancels native
scheduling before the next document runs; a failed cancellation rejects navigation.
The native UI has no separate audio loop. AlarmKit schedules the server's next
absolute instant and can alert while locked. Existing NextAlarmWidget/ActivityKit
receives that same live snapshot, and web `syncNextAlarm` updates are ignored while
native owns alarms. The scheduled system UUID is persisted for replacement and
cleanup across launches; it is never used as a backend ID.

System Stop/Snooze intents use the existing Keychain transport and
`/api/alarms/action`. They resolve only the exact scheduled occurrence and send its
current version. A brief worker-claim delay is tolerated; a later occurrence is
never substituted. API errors are surfaced by the intent rather than being
reported as success. The API token must be configured through the existing local
configuration mechanism for these background actions. No values are committed or
logged. A network connection is required for backend Stop/Snooze; after an offline
system action, reconnect and confirm the server state in the app.

`controlcenter://alarms` opens native details only after native ownership is ready;
otherwise it opens the web alarms page. With the native flag, a cold-launch link
also remains pending until live data and ownership are ready, then opens native
details. Explicit module navigation cancels that pending request.
The ring view uses occurrence snapshot labels/snooze settings, not edited definition
values, and the editor waits for server acknowledgement before closing.

#### Presentation seams

Existing `Sources/` edits are limited to:

- `HomeDataSource.swift`: make the existing `upcomingAlarm(at:)` default implementation
  a protocol requirement so live sources can provide the server result.
- `ClockViews.swift`: inject a new-alarm seed and optional async save handler, both
  retaining prototype defaults; inject clock timezone/location text and read next-alarm
  display through the provider method. With
  the injected save handler, keep the editor open on errors and disable duplicate
  saves while pending.
- `Design.swift`: inject the timezone into `AnalogClock` and `fixtureTime`, retaining
  their original prototype timezone defaults. Panel uses the device timezone, also
  the initial timezone for a new alarm; existing alarms retain their backend timezone.
- `AlarmRingView.swift`: inject the caption, defaulting to `Fixture data`; Panel
  supplies an empty caption. No layout or styling changes.
- `Live/LiveAlarmsProvider.swift` is new. Hybrid composes the existing clock dial and
  controllers and supplies all live data; no mock source is used by Panel.

#### Opt-in and wall check

After deploying #820, configure the existing server, Access headers and alarm token
privately. In Xcode's launch arguments use **`-moduleFlag.alarms native`**. Grant the
AlarmKit prompt on the wall. No code default is changed. To roll back, relaunch with
**`-moduleFlag.alarms web`**; startup cancels any persisted native schedule before
returning ringing to the web runtime.

Before enabling the flag on the wall, verify: create/edit/enable/delete; real next
alarm and Live Activity; lock and wait for the system alert; snooze/re-ring/stop from
both the lock screen and native page; two concurrent occurrences; no web sound
while native owns alarms; deep link; network loss and recovery; and rollback to web.
A locked/suspended app mirrors only its last fetched next instant. Changes made by
another client while it is suspended are reconciled on foreground, not by a push
channel. Device authorization, signed installation, and physical wall behavior
cannot be established by fixture tests.

For isolated simulator captures, Debug accepts `-hybridFixtures -moduleFlag.alarms
native`, plus `-hybridDetail` for the page or `-hybridAlarmRinging` for the ring state.
These switches use synthetic JSON, a fixture clock for the ring, and a no-op system
scheduler; they read no credentials and schedule no real alarm. Release builds do
not include these switches or the fixture scheduler.

#### Verification commands

Use only `~/wwwebb-alarms-native/`, `~/wwwebb-alarms-native-dd/`, and the job's own
`WWW-37 Alarms iPad` / `WWW-37 Alarms 1366` simulators. The `Panel-Alarms` scheme groups the Panel unit tests
and prototype-hosted provider tests into one serial run. Run with Xcode 27:

```sh
export DEVELOPER_DIR=/Applications/Xcode-27.0.app/Contents/Developer
cd ~/wwwebb-alarms-native/PanelKit
swift test
cd ..
/opt/homebrew/bin/xcodegen generate
~/bin/www8-simlock xcodebuild test -scheme Panel-Alarms \
  -destination 'platform=iOS Simulator,name=WWW-37 Alarms iPad' \
  -derivedDataPath ~/wwwebb-alarms-native-dd -parallel-testing-enabled NO -jobs 2 \
  -only-testing:PanelTests -only-testing:WorldWideWebbTests/LiveAlarmsProviderTests \
  -only-testing:WorldWideWebbTests/HomeDataSourceTests \
  -only-testing:WorldWideWebbTests/AlarmPerimeterTests CODE_SIGNING_ALLOWED=NO
~/bin/www8-simlock xcodebuild test -scheme Panel-Smoke \
  -destination 'platform=iOS Simulator,name=WWW-37 Alarms 1366' \
  -derivedDataPath ~/wwwebb-alarms-native-dd -parallel-testing-enabled NO -jobs 2 \
  -only-testing:PanelUITests/HybridAlarmsTests CODE_SIGNING_ALLOWED=NO
```

Verified on 2026-10-30 with Xcode 27 and iOS 26.3: **56 PanelTests and 23 app
unit tests passed** (6 live-alarm provider, 15 existing HomeDataSource, 2 existing
alarm perimeter tests). PanelKit passed **39 Swift Testing tests and 1 XCTest**.
The landscape UI smoke test passed: clock, cold native deep link, ring controls,
default web mode and unavailable-data fallback. Original 1366×1024-point captures
are in `docs/screenshots/alarms-native/` at the repository root. Earlier UI runs
exposed a cold-launch link arriving before native ownership; the pending-link
handoff fixes that race. A stale simulator URL confirmation required a simulator
restart, and the fallback assertion now checks the web route directly rather than
waiting for an unrelated network-status message.
Repository typecheck, Biome, Knip, privacy guards and Gitleaks passed. The web
compatibility PR #820 passed 23 targeted tests plus CI and was subsequently merged
by `@0x63616c`; this job did not issue a merge. Physical wall checks remain pending.

## WWW-33 media capability and playback

The source investigation found **no current video library**. `features/booth/http.ts`
and `features/wakes/http.ts` serve still photos from the NAS-backed media volume;
`features/sound/api.ts` controls Sonos but supplies no playable stream. Plex and the
former media feature were removed in ADR-0013. `apps/web` has no surviving library
caller. The NAS mount in `infra/src/services.ts` is storage, not a catalogue API.

[WWW-50](https://tickets.worldwidewebb.co/t/WWW-50) records the missing additive
endpoints and blocks WWW-33's production completion:

- A catalogue query (proposed `media.list`) with stable IDs, real titles, types and
  availability, backed by a selected NAS directory or existing service.
- Playback resolution (proposed `media.playback({id})`) to a same-origin relative
  progressive MP4 stream, with H.264/AAC-compatible content.
- `GET/HEAD /media/library/<id>/stream` with bounded NAS I/O, correct byte ranges
  (`206`, `Content-Range`, `416`), `video/mp4`, no redirects, and explicit missing/
  unavailable responses. Upstream credentials and filesystem paths stay server-side.

These names are proposals, **not existing endpoints or an invented wire contract**.
No backend change or backend PR accompanies this app change. `MediaAPI.videos()`
reports `sourceUnavailable` without making a speculative request. Replace that
adapter and add fixtures matching the eventual zod contract when WWW-50 lands.
`PanelMediaVideo` is only the client-side capability model; the synthetic MP4 and
injected Swift values are playback fixtures, not alleged production API responses.

`LiveMediaProvider` implements the existing `MediaProvider`, starts empty, validates
unique IDs and stream origins, and clears stale data on failure, cancellation or
stop. The prototype `MockMediaProvider` and all existing `Sources` views remain
unchanged. The only new Sources file is `Live/LiveMediaProvider.swift`. Hybrid uses
its own small adapter because the prototype MediaPage assumes fixture music,
artwork and room playback. Video selection opens a full-page system `VideoPlayer`;
returning to the library, leaving the module or backgrounding stops its player and
resource requests. A failed stream shows “Video unavailable”.

`MediaPlayback` retains an `AVAssetResourceLoaderDelegate` and serves progressive
MP4 data in at most 256 KiB requests. It uses a memory-only URLSession, accepts
only the configured origin (HTTPS, or loopback HTTP for development), attaches a
complete Access header pair to every range request, refuses redirects and rejects
login HTML, incorrect ranges and changing lengths. Credentials never enter a URL
or diagnostic. It does not use the unsupported `AVURLAssetHTTPHeaderFieldsKey`.
See [Apple's resource loader API](https://developer.apple.com/documentation/avfoundation/avassetresourceloader)
and [Apple's header-key guidance](https://developer.apple.com/forums/thread/671139).
HLS, transcoding, album/playlist playback, Sonos library commands, AirPlay and
background playback are outside this capability. External playback is disabled.

### Flag check and rollback

Media always defaults to **web**, including shipped builds. It appears natively
only when `moduleFlag.media == native` **and** the provider has validated, nonempty
current data. Today's production source therefore stays on the web board even
with the flag enabled. No wall configuration has been changed.

For an eventual real source, launch with `-moduleFlag.media native` or select
Settings > Panel > Media > Native and relaunch. Select Media in the module strip.
Rollback is `-moduleFlag.media web`, Settings > Panel > Media > Web, or the shared
Web board only switch. Do not enable on the wall until authenticated playback and
seek have been checked on the physical iPad with the real source.

For the explicit debug check, use only an owned simulator and checkout:

```sh
export DEVELOPER_DIR=/Applications/Xcode-27.0.app/Contents/Developer
cd ~/wwwebb-media-live
# Separate terminal, foreground process; serves only an 8-second synthetic clip.
python3 PanelKit/Tests/PanelKitTests/Fixtures/media/server.py
# Substitute the ID returned when creating the owned WWW-33 Media iPad simulator.
xcrun simctl launch <own-UDID> co.worldwidewebb.theworkflowengine \
  -hybridFixtures -moduleFlag.media native
# Library:
xcrun simctl launch --terminate-running-process <own-UDID> co.worldwidewebb.theworkflowengine \
  -hybridFixtures -moduleFlag.media native -hybridDetail
# Playback (debug-only switch, gated by -hybridFixtures):
xcrun simctl launch --terminate-running-process <own-UDID> co.worldwidewebb.theworkflowengine \
  -hybridFixtures -moduleFlag.media native -hybridDetail -hybridMediaPlay
# Absent-source fallback:
xcrun simctl launch --terminate-running-process <own-UDID> co.worldwidewebb.theworkflowengine \
  -hybridFixtures -moduleFlag.media native -hybridUnavailable
# Flag-off fallback with available fixture data:
xcrun simctl launch --terminate-running-process <own-UDID> co.worldwidewebb.theworkflowengine \
  -hybridFixtures -moduleFlag.media web
```

Fixture mode injects a loopback-only media capability with **synthetic** Access
header values that the test server requires; it reads no runtime secrets or home
services. Other providers continue to use the network-free fixture transport.
`GET http://127.0.0.1:18733/stats` returns only request counts. The MP4 is generated
from FFmpeg's `testsrc2`, has no personal content and is never a production fallback.
The localhost server is a verification tool, not an additive backend implementation.

Verification commands (one Xcode build at a time on the shared mini):

```sh
cd ~/wwwebb-media-live/PanelKit && swift test
cd ~/wwwebb-media-live && /opt/homebrew/bin/xcodegen generate
xcodebuild test -scheme Panel -destination 'platform=iOS Simulator,id=<own-UDID>' \
  -derivedDataPath ~/wwwebb-media-live-dd -parallel-testing-enabled NO -jobs 2 \
  -only-testing:PanelTests \
  -only-testing:WorldWideWebbTests/LiveMediaProviderTests \
  -only-testing:WorldWideWebbTests/ModuleProviderTests
```

PanelKit tests include a loopback server on an OS-assigned port to verify actual
header delivery, denial of partial credentials and redirect refusal. The iPad test
feeds the same MP4 through the resource loader, asserts playback time advances,
seeks to five seconds and stops. Provider tests cover unavailable/empty/duplicate/
foreign data, recovery and late results after stop. This evidence does not establish
real NAS availability, production Cloudflare Access playback or physical wall parity.

Verified on the mini on 2026-10-30 with Xcode 27.0: **11 XCTest + 41 Swift Testing
PanelKit tests passed**. The full requested iPad run passed **56 Panel tests + 8
selected app tests**. A focused incremental run after the stream-URL observation
fix passed **4 media Panel tests + all 6 LiveMediaProvider tests**, including the
new replacement-URL regression. Both runs built the Panel and prototype iPad
hosts. Repository typecheck, tracked-file lint, Knip and privacy/secret guards
passed. Real Panel captures at 1366×1024 points (@2x PNGs) show the tile, library,
AVKit playing the test pattern, and both web fallbacks. The unavailable web
captures show the reconnecting overlay against an intentionally unavailable
loopback page, not an authenticated production board. The flag was explicitly
flipped only in this synthetic simulator check; physical-iPad and real-source
validation remain outstanding under WWW-50.

### Cameras (WWW-34)

Home Assistant `camera.*` entities are the source. The additive backend PR is
[#828](https://github.com/0x63616c/world-wide-webb/pull/828), targeting `main` and
left unmerged. It adds `cameras.list` (`[{id,name,state}]`) and
`GET /media/cameras/:id/snapshot`, backed by HA's authenticated camera proxy.
The device uses the existing Panel server/Access configuration; HA credentials
and camera URLs stay server-side. Either deployment order is safe: a missing
procedure, malformed response, empty/offline camera list or fetch failure marks
the provider unavailable and retains the existing web route.

`LiveCamerasProvider` conforms to the existing `CamerasProvider`. It preserves
HA entity IDs, omits off/unknown/unavailable feeds, and keeps decoded frames only
in memory. `Hybrid/CamerasModule` owns the live tile, overview and enlarged view;
all existing design-worker `Sources/` views and the mock are untouched. The only
new `Sources/` file is `Live/LiveCamerasProvider.swift`; its empty asset field is
never rendered through the prototype's mock `CameraPreview`.

Discovery follows the existing 10-second foreground polling. Snapshot tasks
belong to the visible camera view: every 3 seconds on the tile/overview and
every second for the selected enlarged feed, after the prior request completes.
Tap the tile to open the overview; tap a camera to enter its full-page live view;
**All cameras** returns to the overview. Only visible selections request images.
Navigation/background cancels those tasks; background also clears frames. A
failed image removes the prior frame and timestamp and shows “Snapshot
unavailable”; it does not present a stale image as current. Frames are downsampled
to 2048 pixels. There is no video/audio streaming session: HA/camera caching may
limit the source's actual update rate.

The camera transport is an ephemeral URLSession without disk cache, cookies or
credential storage. It rejects HTTP redirects (including Access login redirects)
rather than forwarding custom Access headers. It accepts only validated camera
IDs and JPEG/PNG/WebP responses; ImageIO rejects undecodable image data. The
server sets `private, no-store`. No camera images are written to disk by the app.

#### Opt in after checking

Cameras remains **web by default**, including in shipped defaults. After the
backend is deployed and the existing private Access configuration is installed,
check list availability, real snapshot updates, tapping/enlarging, background
and foreground, network failure/recovery and rollback on the target iPad.
Then launch with **`-moduleFlag.cameras native`** and choose **Cameras** in the
module strip. To restore the web route, launch
with **`-moduleFlag.cameras web`** (or use the existing **Web board only** setting).
No wall configuration or code default was flipped by this work.

Debug simulator check: **`-hybridFixtures -moduleFlag.cameras native`** uses
synthetic JSON and an explicitly labeled color-bar PNG with the real API decoder
and provider. Add `-hybridDetail` for the overview or `-hybridUnavailable` for
fallback. No home imagery, configuration or credentials are read in fixture mode.

#### Verification

Use only `~/wwwebb-cameras-live/`, `~/wwwebb-cameras-live-dd/`, and the owned
`WWW-34 Cameras iPad` simulator. `Panel-Cameras` groups both unit-test targets
and the camera UI check for one serial build:

```sh
export DEVELOPER_DIR=/Applications/Xcode-27.0.app/Contents/Developer
cd ~/wwwebb-cameras-live/PanelKit
~/bin/www8-simlock swift test
cd ..
/opt/homebrew/bin/xcodegen generate
~/bin/www8-simlock xcodebuild test -scheme Panel-Cameras \
  -destination 'platform=iOS Simulator,name=WWW-34 Cameras iPad' \
  -derivedDataPath ~/wwwebb-cameras-live-dd -parallel-testing-enabled NO -jobs 2 \
  -only-testing:PanelTests -only-testing:WorldWideWebbTests/LiveCamerasProviderTests \
  -only-testing:WorldWideWebbTests/ModuleProviderTests \
  -only-testing:PanelUITests/HybridCamerasTests CODE_SIGNING_ALLOWED=NO
```

Fixture checks cannot establish physical-camera availability, production Access
configuration, source caching or wall-device performance; those remain deployment
checks before enabling this module on the wall.

Verification (2026-10-30, Xcode 27.0, including the Calendar/Media/Photos base):
**54 Swift Testing + 15 XCTest PanelKit tests**, **70 PanelTests**, and **7 app
tests** (4 camera provider + 3 existing module provider tests) passed. The camera
UI test passed at **1366×1024 points**, checking snapshot updates, tile-to-overview
navigation, tap-to-enlarge, continued live refresh, return navigation, default-web
routing and unavailable-backend fallback. The test explicitly opts into native
with the launch arguments above; the production default remains web.

On the shared Mac, coordinate exclusive simulator UI access for this check. The
two-slot capture helper allowed overlapping automation; those runs missed taps.
The same built test passed with both existing capture locks held, without touching
other simulators. Earlier resource-limit launch failures were environmental.
Screenshots in `docs/screenshots/cameras-native/` at the repository root are direct
XCTest captures (2732×2048 pixels, @2x) from the passing run, with synthetic imagery
only. The fallback assertions check routing with an intentionally unavailable
fixture origin; they do not validate rendering of the authenticated production
web board.

## Update ready Banner (WWW-53)

Hybrid checks `releases.latest({app: "panel"})` on launch, whenever the scene
becomes active, and every 15 minutes while active. The shared PanelKit transport
uses the configured server and complete Cloudflare Access header pair. It compares
the positive integer build with `CFBundleVersion`; equal/older builds, missing
releases, malformed responses and network errors clear the Banner. Cancelling a
foreground task prevents a late response from publishing.

The persistent **Update ready: build N** Banner is root-level Board Chrome, above
both the native modules and KioskWebView fallback. Tap it to open `itms-beta://`.
No Apple ID is assumed and no URL-scheme query permission is required: the app
opens the URL directly without `canOpenURL`.

A local notification is scheduled only when authorization is already authorized
or provisional. The app never requests notification permission. Successful
scheduling saves `panel.update.lastNotifiedBuild` in UserDefaults; retries, older
builds and app restarts do not notify again. A scheduling failure can retry on the
next check. The system may suppress foreground notification presentation; the
persistent Banner is the in-app notice.

Debug builds support explicit, launch-only verification overrides:

- `-updateCheckFakeBuild 999999` substitutes a server build without making a
  releases request.
- `-updateCheckIntervalSeconds 2` shortens the foreground polling interval.
- `-hybridFixtures -moduleFlag.lights native` renders synthetic native content
  without home service access for a Banner capture.

The two update-check overrides are compiled out of Release builds. No flag changes
the installed build number. Backend and upload recording live in additive
[PR #836](https://github.com/0x63616c/world-wide-webb/pull/836), targeting main.

The exact HTTP release path is sent to the API by the Cloudflare tunnel;
[PR #837](https://github.com/0x63616c/world-wide-webb/pull/837) adds that narrow
route without changing web nginx or the existing Access policy.

Verified on the shared Mac with Xcode 27.0 on 2026-10-30: PanelKit passed
**15 XCTest + 62 Swift Testing tests**. One serial `xcodebuild test` of scheme
`Panel` passed **81 PanelTests + 140 app unit tests**, with no failures:

```sh
export DEVELOPER_DIR=/Applications/Xcode-27.0.app/Contents/Developer
cd ~/wwwebb-update-ready/PanelKit && swift test
cd .. && /opt/homebrew/bin/xcodegen generate
xcodebuild test -scheme Panel -destination 'platform=iOS Simulator,id=<owned-UDID>' \
  -derivedDataPath ~/wwwebb-update-ready-dd -parallel-testing-enabled NO -jobs 2 \
  -only-testing:PanelTests -only-testing:WorldWideWebbTests CODE_SIGNING_ALLOWED=NO
```

Repository typecheck and Biome passed. Comparison tests cover equal, newer, older
and nonnumeric installed builds. Injected polling tests verify immediate launch
and foreground checks, the default 900-second interval, a shorter debug interval,
error recovery and cancellation. Notification tests cover authorized/provisional
states, denied/undetermined/ephemeral states, persistence across restarts, retries
and overlapping checks. API tests decode the exact tRPC fixture and reject bad
builds, mismatched app IDs, invalid timestamps, missing endpoints and Access HTML.

The focused `Panel-Smoke` UI check `PanelUITests/UpdateReadyBannerTests` passed,
asserting the exact build label and a 1366×1024-point app frame on both native and
web routes. Direct `simctl` screenshots are in `Verification/WWW-53-banner.png`
and `Verification/WWW-53-banner-web.png` (@2x, 2732×2048 pixels). The native capture
uses the synthetic Lights fixture; the web capture intentionally shows the local
unavailable board reconnecting. It verifies the Banner's placement, not production
Cloudflare Access rendering. No physical TestFlight handoff or permission prompt
was used for simulator verification.

## Mac window policy (WWW-39)

The existing Panel iOS target runs on Apple Silicon as Designed for iPad; Catalyst
remains off. On `isiOSAppOnMac` only, `PanelWindowAttachment` applies equal minimum
and maximum scene sizes of **1366 × 1024 points**, matching the wall panel in
landscape. The app's landscape-only Info.plist and full-screen requirement are
covered by a hosted PanelTests assertion. Mac keeps automatic system overlays for
pointer access; the wall iPad keeps its hidden kiosk overlays. No module flags are
changed by this policy and no launch argument is required.

iPhone support is deferred: Panel remains device family `2`. Hybrid's native tile
and Fan detail use fixed 660 × 520 frames, and Dog Walk has no live hybrid view.
The reused `SonosRoomsPage` in `Sources/SoundViews.swift` also lays out both
groups and their room controls in horizontal rows without a compact branch; making
that page safe at the smallest phone size needs a design-view layout change.
Enabling family `1` would expose clipped content and an incomplete module set. Compact navigation and smallest-phone validation remain follow-up work; the
design worker's Sources and UITests are unchanged. No new snapshot/UI suite is
added because these tests are not run by the existing CI.

## Guest Wi-Fi full-screen QR (WWW-29)

Wi-Fi stays **web by default**, including shipped builds. WWW-29 removes Wi-Fi
from the inherited `shippedNative` list; every other module keeps its existing
default. The existing WWW-14 `WifiAPI` / `LiveWifiProvider` and WWW-44 composition
already handle `wifi.guestQr`, polling, SSID parsing and unavailable fallback.
No backend change is needed. No design-worker view is changed.

`Hybrid/WifiModule.swift` displays the live SSID with a password button hidden
until tapped (tap again to hide). Open networks say “No password required”. Tap
the tile to open a system full-screen cover with a CoreImage QR, white quiet
zone and no panel navigation over it. The QR encodes the original validated
server payload, preserving optional fields. Brightness is set to 1 on the
containing window's screen and restored on tap, the 60-second timeout,
backgrounding, provider changes or removal. Returning from background never
reopens the QR or reveals the password. Failed/absent endpoints, malformed
payloads and empty configuration keep the retained web board. Credentials stay
in memory and are never logged or persisted.

The only touched `Sources` file is `Live/LiveWifiProvider.swift`: add a read-only
optional `qrPayload`, publish the original payload after successful parsing, and
clear it on unconfigured/error/cancelled responses. Add `stop()` to clear
credentials and invalidate in-flight results on backgrounding; Hybrid calls it
with the other providers. Its protocol, mock, parsed
state and existing initializers are unchanged. All presentation is injected from
Hybrid. The `Panel-Wifi` scheme selects the existing Panel, app and UI test targets
for one build; use `-only-testing` to restrict execution to the relevant tests.

Check using a simulator owned by this job (Debug only):

```sh
xcrun simctl launch <own-simulator-id> co.worldwidewebb.theworkflowengine \
  -hybridFixtures -moduleFlag.wifi native
# Add -hybridDetail to open the QR, or -hybridUnavailable for web fallback.
```

`-hybridFixtures` uses `Fixtures/wifi/hybrid.json`, a synthetic secured network;
no home configuration or credentials are read. Routing tests also cover open,
unconfigured, malformed and missing-endpoint responses. CoreImage decodes the QR
and compares it with the original payload without logging credentials.

Before opting in on the wall, launch with `-moduleFlag.wifi native` **without**
`-hybridFixtures`, check the SSID, reveal/hide, scan from a phone, and verify
brightness restoration after tap, 60 seconds and backgrounding. Then set iOS
Settings > Panel > Wi-Fi > Native and relaunch. Equivalent launch override:
`-moduleFlag.wifi native`. Rollback: `-moduleFlag.wifi web`, or Settings > Panel >
Wi-Fi > Web, then relaunch. Do not persist the wall override until that device
check passes. Simulator tests cannot establish physical backlight or phone
joining behavior; the wall check remains a rollout step.


## Native Sonos now playing and rooms (WWW-30)

Sonos is **web by default**, including shipped builds. Only an explicit native
flag plus a successful current provider snapshot with an available room routes
native. Errors/empty responses return to the web board; recovery restores the
selected native module. Other module routes, including Tesla, Walk, Cameras,
Wi-Fi and Media, retain their existing providers.

`Hybrid/SonosModule.swift` injects the design worker's `NowPlayingView` with real
coordinator metadata and artwork, calibrated volume and full-screen Rooms
navigation. Now Playing's volume uses `.volume`, preserving global/group locks,
per-room baselines, uncapped displayed percentages and the raw 0–100 write cap.
Calibration still comes from the server; clear-calibration releases the global
lock only after acknowledgement. Locks persist in device defaults across
launches, independently of the web board's local storage.

WWW-42 [API PR #811](https://github.com/0x63616c/world-wide-webb/pull/811) already
supplies optional `position`, `duration`, `positionAt` and
`sound.sonosSeek({ room, positionSeconds })`. `positionAt` is the HA sample time,
not fetch time. The provider resolves the coordinator, requires a complete valid
sample with positive duration and playing/paused transport, and excludes TV and
line-in. Old/missing fields hide the scrubber; no fake progress. Playing samples
advance from their server timestamp and clamp to duration; paused ones stay put.
Seek targets the current coordinator, clamps to duration, and never retries.
A missing or failing seek route makes the provider unavailable and returns to web.

Artwork uses the additive [API PR #840](https://github.com/0x63616c/world-wide-webb/pull/840):
`GET /media/sonos/<coordinator entity ID>/artwork`. HA tokens remain on the server;
native requests use the same configured Access headers and an ephemeral session
that refuses redirects. No private HA URL is fetched directly. Missing artwork
or an absent artwork route shows “Artwork unavailable”, while room controls keep
working. No fixture cover is substituted. This app PR does not depend on the
artwork PR merging first.

Room actions use stable IDs and the provider's serialized command queue. TV mode
on a follower selects TV on that chosen room and rejoins all other available
rooms under it. No room name is assumed to identify the Beam; choose the room
wired to the TV. Line-in availability likewise depends on the chosen hardware.

### Exact presentation seams

- `Sources/NowPlayingView.swift`: add defaulted inputs for selected room ID,
  scrubber visibility, volume value/command, artwork content and Rooms action.
  Existing callers keep the same mock defaults, layout, styling and sheet.
- `Sources/Live/LiveSonosProvider.swift`: extend the existing live provider with
  coordinator playback projection, seek/source operations and optional persisted
  volume locks. This is provider logic, with no design-worker view changes.

No other `Sources/` files, `UITests/`, design docs, scripts or iterations changed.

### Wall verification and flag flip

Before enabling on the wall, verify art/track and each transport button; position
and seek on a seekable track; no scrubber on TV/line-in or legacy responses;
individual and locked calibrated volume; mute; join/leave/join all; TV/Beam and
line-in; calibration/clear; and recovery after a disconnected backend. The wall
check is still outstanding; this change does not flip its flag or ship a build.

After that check, use launch argument `-moduleFlag.sonos native`, or iPad Settings
> Panel > Sonos > Native and relaunch. Rollback: `-moduleFlag.sonos web`, or the
same setting set to Web. For an iPad app running on Mac:

```sh
defaults write co.worldwidewebb.theworkflowengine moduleFlag.sonos -string native
# Relaunch. Rollback:
defaults write co.worldwidewebb.theworkflowengine moduleFlag.sonos -string web
```

Synthetic smoke launches (no live network or speaker writes):

```text
-hybridFixtures -moduleFlag.sonos native
-hybridFixtures -hybridSonosPlayback -hybridDetail -moduleFlag.sonos native
-hybridFixtures -hybridUnavailable -moduleFlag.sonos native
```

The first uses the legacy response without position, the second a paused sampled
track, and the third verifies web fallback. Fixture writes fail closed unless a
unit test explicitly supplies an acknowledgement. Unit tests cover decoding,
exact mutations, coordinator seeking, TV regrouping, calibration/locks, failed
writes and recovery. `HybridModuleTests` captures native screens at 1366×1024.

Verification (2026-10-30): on the shared Mac with Xcode 27.0, `PanelKit/swift test`
passed 15 XCTest + 65 Swift Testing tests. One serialized `xcodebuild test -scheme
Panel -only-testing:PanelTests -only-testing:WorldWideWebbTests/LiveSonosProviderTests`
run passed 94 Panel + 16 provider tests on the job-owned iPad simulator. Captures
live under `docs/screenshots/WWW-30/` in the repo root; they use synthetic transport
responses, not the wall.

## Shared in-app notifications (WWW-59)

Panel owns one `@Observable NotificationCenter`, injected by type at the root.
Modules can post without permission prompts or a backend dependency:

```swift
@Environment(NotificationCenter.self) private var notifications
// After a real module event:
notifications.post(sourceModule: "lights", title: "Scene ready",
    body: "Reading lights are ready.", deepLink: "module/lights",
    priority: .normal, dedupeKey: "reading-scene")
```

Local items are memory-only; this slice does not POST them to the server.
Remote items use `PanelKit.NotificationsAPI` and the existing authenticated tRPC
transport (the equivalent WWW-58 procedures in `docs/notifications-api.md`).
Unfiltered pages drain immediately, followed by a five-second revision poll.
An absent endpoint/network failure retains received history and local posting,
retrying every 30 seconds. Scene backgrounding cancels polling. After 30 days
without a successful sync, the next successful initial fetch replaces remote
history because server dismissal tombstones may have expired. Payloads and
credentials are never logged or persisted by the service.

History combines both origins, deduplicating `(sourceModule, dedupeKey)`;
null keys remain independent. A matching server echo replaces the local identity
without a second arrival or resetting its remaining reading time. Groups and
history sort by priority, newest creation time, then stable ID. Higher revisions
replace remote rows; dismissed tombstones remove them. Read changes hide the
banner. `history`, `groups`, `bannerGroups`, `unreadCount`, `markRead`, `dismiss`,
`clear(sourceModule:)` and `clear()` are the shared seam for WWW-60/WWW-61.
Clear preserves local posts arriving during the server request; failed remote
actions retain history and show an error. No pull-down history screen is added.

The shared status overlay shows banners on Home, Classic and presented native
controllers; the Wi-Fi QR presentation also hosts it. These surfaces share the
same environment service. A presentation stack gives only the top visible surface
ownership of auto-dismiss timing and haptics. Root-injected navigation callbacks
resolve source taps through `PanelNavigation`, including dismissal of Home's
current full-screen destination. Unknown routes keep their banner and unread state.

The overlay uses native Liquid Glass and source glyph/name, title, body and
relative time. Up to three source groups appear, or one at accessibility text
sizes. Same-source arrivals stack, with the highest-priority/newest item exposed.
Tap opens that module's existing Hybrid detail route and marks the item read;
disabled or unavailable native modules keep the router's web-board fallback.
Alarms retain their existing web deep link. Unknown/malformed routes leave the
item available and never open external URLs. Optional nested paths currently
resolve to module detail (with `module/events/alarms` mapped to Alarms).

Swipe up/sideways or the accessible Dismiss button dismisses the exposed item,
revealing the next in its group. Normal/low banners last five visible seconds,
high lasts ten, critical remains until acted on. Timeout hides only the banner,
leaving unread history intact. Hidden/queued items do not consume reading time;
touch, VoiceOver and backgrounding pause it. Reduce Motion uses a short fade in
place of the spring/drop. Arrival, explicit dismissal and navigation use native
`sensoryFeedback`; physical haptics depend on device support.

Debug-only, synthetic captures (no notification API traffic):

```text
-hybridFixtures -moduleFlag.lights native -notificationSamples
-hybridFixtures -moduleFlag.lights native -moduleFlag.climate native -notificationSamples -notificationStack
```

`-notificationHold` pauses banner timers for deterministic captures.
`-notificationReduceMotion` exercises reduced-motion presentation without changing
shared simulator settings. `-UIPreferredContentSizeCategoryName
UICTContentSizeCategoryAccessibilityXXXL` exercises accessibility text.
`PanelUITests/NotificationBannerTests` captures the banner, destination, stack,
cleared overlay and accessibility presentation as retained XCTest attachments.
The inbox itself is covered by unit tests; its history UI belongs to WWW-60.
