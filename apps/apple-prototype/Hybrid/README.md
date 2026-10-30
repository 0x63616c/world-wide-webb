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

`ModuleFlags` defines `lights`, `climate`, `fan`, `wifi`, `sonos`, `weather`,
`walk`, `reminders`, `alarms`, `calendar`, `cameras`, and `all`. Shipped builds default `lights`, `climate`, `fan`, `wifi`, `sonos`,
`weather`, and `walk` to `native` (`ModuleFlags.shippedNative`, WWW-48); every other
module defaults to `web`, and `-hybridFixtures` runs keep every default at `web`.
A native flag still shows the web board until that module's live provider has data.
For example, `-moduleFlag.lights native` overrides the launch's UserDefaults; `default`
uses the shipped value and invalid values fall back to `web`.

Flip back without a rebuild: iOS Settings > Panel > "Web board only" sends every module
to the web board (`hybrid.webOnly`), and each module has Default/Native/Web. Changes apply
on the next launch. The in-app "Web board" button returns to the full board at any time.
`all` always means the complete web board, even if its flag is set to `native`.

`HybridRouter.route(for:hasLiveData:)` selects native only when the individual
flag is `native` **and** a native implementation has live data. The generic
`HybridModuleHost` receives an optional live view and a web fallback closure;
nil data, a missing implementation, or a `web` flag selects the fallback.
The root retains one WKWebView across native navigation. With all flags set to
`web`, it renders the same full-screen board with no native navigation and
starts no providers. With flags enabled, it initially selects the first enabled
module in registry order; that selection stays on the board until its provider
supplies data. A module strip offers the available native modules and **Web board**.
Each native module opens on its existing tile; **Details** opens its existing
controller. A failed selected provider immediately returns to the board, and a
successful subsequent poll restores the native selection. Alarm deep links open native details when the alarms flag, live data, and ringer
ownership are ready; otherwise they deliver the existing web alarm event.

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
empty and inert. Commands without a live backend (media-library playback,
seeking) do nothing; they never mutate fixtures.

Sonos identity uses backend IDs independently of room display names. Unknown or
unavailable rooms are omitted. Missing metadata stays nil, and duration/position
stay zero. The native controller is `SonosRoomsPage`, which supports grouping and
volume without the prototype's fixture artwork or unsupported playback scrubber.
Name-based prototype group shortcuts only resolve when the name is unambiguous.
Lights retain the existing provider's group projection; the API does not report
individual lamp RGB or party speed. Unreported lamp colors use neutral values.

Only requested providers poll: every 10 seconds, 10 minutes for weather, or one second for alarms.
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

## WWW-38 state synchronization

The shared PanelKit coordinator and walk provider adoption are documented in
[../PanelKit/SYNC.md](../PanelKit/SYNC.md). `-moduleFlag.walk native` reserves the
opt-in; this base has no native walk registration, so it still falls back to web.
The flag remains `web` by default. Follow the documented live-data/lifecycle gate
when adding the walk provider to WWW-44 composition.

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
Then launch with **`-moduleFlag.cameras native`**. To restore the web route, launch
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
