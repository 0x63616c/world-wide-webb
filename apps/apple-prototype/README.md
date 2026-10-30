# World Wide Webb — Apple prototype

Native SwiftUI HomeView-style study for [WWW-8](https://tickets.worldwidewebb.co/t/WWW-8). macOS 26+ and iPadOS 26+, built with Xcode 27. No backend, networking, bundled photos, or production credentials. All device/weather/network/alarm values are **fixtures** and reset on launch.

## v2 iteration 2b — Wi-Fi QR hero and face fixes

Home is a near-square six-complication face at the center of the 1376×1032-point
canvas. Climate spans 2×2 cells, with Clock and Guest Wi-Fi at right; Bedroom
Lamps, Living Room Lamps and Ceiling occupy the bottom row. Under Cabinet, Fan
and All move to the second, swipeable Controls face. Four page dots select Home,
Controls, Clock and Music. The face has 22-point gutters, approximately 297-point
cell heights, 76-point accessory glyphs, 40-point names and 28-point subtitles.
Climate uses regular-weight numerals. Large procedural teal fan blades and arcs,
clear Liquid Glass, white specular edges, soft shadows and translucent ON states
carry the Home treatment. No reference images are bundled.

Lamps uses a global 244×610-point vertical brightness control, honestly
labelled **All lamps**, with a stronger track and warm white fill. A layered
amber field lights the fader and two 204-point room buttons. Room counts and
member captions use the same fixture membership as Home and Clock; the default
three lamps on are Bed Left, Bed Right and Mirror in Bedroom. Color & Effects
contains the existing supported lamp controls; individual member names remain captions.

The Home clock has a circular glass surface and the Climate chevrons are 62-point
semibold. ON glass is less opaque. A neutral specular edge sits above the native
glass compositor, sharing the face grid geometry in both the live view and snapshot.

Guest Wi-Fi opens a centred CoreImage QR hero with level-M correction and a
standard escaped Wi-Fi payload built from the current fixture SSID and password.
The white rounded card occupies about 58% of the full screen height; integer
pixel scaling, nearest-neighbour interpolation and a quiet zone preserve scan
quality. The SSID, readable password and **Scan to join** sit below. Open networks
use `nopass`; unconfigured networks keep the empty state. QR codes appear only
in this full-screen controller, never on the Home tile or Clock complication.

The green Clock face uses enormous black numerals and white hands. Near mode
shrinks the dial slightly and uses dark, opaque-backed glass complications;
Climate explicitly labels its value **Inside**. Tap its
background to simulate approach: Climate, Lamps, Guest Wi-Fi and current Weather
complications fade/scale in over 240 ms. Reduced Motion disables the transition.
`-face clock -presence near|far` selects either state; this is a prototype presence
input, not a sensor or automatic idle policy. The alarm complication and Home
clock open the full-screen next-alarm ring. Its orange ticks represent the final
24 hours before the next occurrence, depleting as time passes. Alarms farther away
show a full ring. The ring follows a rounded rectangle inset 28 points evenly
from the display, with a 28-point corner radius concentric with the explicit
56-point display container. Exact arc-length samples place 180 perpendicular
ticks around the straight edges and circular corners, every fifth tick longer.
Progress begins at top centre and travels clockwise. The existing alarm editor
is reached with **Alarms**.
`-openTile alarm -alarmRinging` demonstrates the supported Snooze and Stop actions;
snooze uses that alarm's minutes and stale occurrence versions are rejected.
There is no timer feature and the prototype never actuates a real alarm.

Music follows the plum artwork treatment with original SwiftUI fixture artwork,
track/artist text, previous/play/pause/next, per-room mute and **Volume**. There is
no position/duration data and no scrubber. The fader writes raw Sonos volume;
calibrated display percentages remain confined to the existing Sound mixer.
The top-right room picker selects a room, joins a room to the selected group, or
groups all rooms. Transport updates the entire coordinator group. Track changes
cycle a small explicit fixture queue; no Sonos connection exists.

Screenshots: [Home](docs/screenshots/v2/home.png) ·
[Controls](docs/screenshots/v2/controls-face.png) ·
[Lamps](docs/screenshots/v2/lamps.png) ·
[Guest Wi-Fi](docs/screenshots/v2/wifi.png) ·
[Clock idle](docs/screenshots/v2/clock-idle.png) ·
[Clock near](docs/screenshots/v2/clock-near.png) ·
[Next alarm](docs/screenshots/v2/alarm.png) ·
[Music](docs/screenshots/v2/nowplaying.png).
Comparisons containing Calum's references stay outside Git in
`/workspace/wwwebb-ui/prototype/v2/`. See `docs/v2/iterations.md` for critique and
measured render times. UI automation waits for design approval.

### Fast snapshot loop

On the build mini, use the already-booted WWW iPad 13 simulator:

```sh
cd ~/wwwebb-proto
bash scripts/snapshot.sh               # incremental unit-test build + render
bash scripts/snapshot.sh --no-build    # reuse test product when sources match
bash scripts/snapshot.sh --glass-check # optional one-time native screen comparison
```

`WorldWideWebb-Snapshots` excludes the UI-test target. The script uses fixed warm
`~/wwwebb-proto-dd`, then runs only `WorldWideWebbTests/SnapshotRenderTests` with
`test-without-building`. It renders all nine scenes (including Wi-Fi and the
ringing alarm) at 1376×1032 points, scale 2, with a fixed fixture clock. It saves both SwiftUI ImageRenderer output (suffix
`-imagerenderer`) and native `UIHostingController`/`drawHierarchy` output in one
persistent XCTest window. The latter is the delivered glass-preserving path,
checked once against `simctl io screenshot` during that same test. No app tour,
manual simulator launch, or UI tests are involved. Output is in
`~/wwwebb-proto-snapshots/`; copy the PNGs back immediately. Only the test
host runs, using the existing simulator session.

Compose a labelled local review with:

```sh
bash scripts/compare.sh /workspace/wwwebb-ui/prototype/v2 \
  /workspace/wwwebb-ui/homeview-research/refs/calum iter-2b
```

The comparison script needs Python Pillow; it preserves Display P3 colors by
converting embedded image profiles to sRGB before composing. It refuses to
overwrite an existing iteration. Run store checks separately without UI tests:

```sh
DEVELOPER_DIR=/Applications/Xcode-27.0.app/Contents/Developer xcodebuild \
  -project WorldWideWebb.xcodeproj -scheme WorldWideWebb-Snapshots \
  -destination 'platform=iOS Simulator,id=A0ECBA0E-5E14-4DE2-ACD7-7C2A5EA0AFBF' \
  -derivedDataPath "$HOME/wwwebb-proto-dd" -parallel-testing-enabled NO \
  -only-testing:WorldWideWebbTests/HomeDataSourceTests \
  -only-testing:WorldWideWebbTests/WifiQRCodeTests \
  -only-testing:WorldWideWebbTests/AlarmPerimeterTests \
  CODE_SIGNING_ALLOWED=NO test-without-building
```

## Build

Install Xcode 27 and XcodeGen, then from this directory:

```sh
export DEVELOPER_DIR=/Applications/Xcode-27.0.app/Contents/Developer
/opt/homebrew/bin/xcodegen generate
xcodebuild -project WorldWideWebb.xcodeproj -scheme WorldWideWebb \
  -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath "$HOME/wwwebb-proto-dd" CODE_SIGNING_ALLOWED=NO build
xcodebuild -project WorldWideWebb.xcodeproj -scheme WorldWideWebb-iPad \
  -configuration Debug -sdk iphonesimulator \
  -derivedDataPath "$HOME/wwwebb-proto-dd" CODE_SIGNING_ALLOWED=NO build
```

The generated `.xcodeproj` is ignored. The macOS window starts at 1366×1024 and supports resizing down to 960×720. The grid uses available dimensions; the iPad Pro 13″ simulator is 1376×1032 points. The iPad target supports landscape only. Both use the same sources and real `GlassEffectContainer` / `glassEffect` / glass buttons. The Mac mini's macOS 15.6 cannot run this app; runtime verification uses iPadOS 26.3.

```sh
xcrun simctl create 'WWW iPad 13' \
  com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB \
  com.apple.CoreSimulator.SimRuntime.iOS-26-3
# Use the returned UDID; create only once.
xcrun simctl boot <UDID>
xcodebuild -project WorldWideWebb.xcodeproj -scheme WorldWideWebb-iPad \
  -destination 'platform=iOS Simulator,id=<UDID>' \
  -derivedDataPath "$HOME/wwwebb-proto-dd" \
  -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO test
```

Unit tests cover Wi-Fi payload escaping/open networks and QR decode round trips, rounded-rectangle arc length and normals, lamp counts, master semantics, membership, fan/climate state, bounds/deadband, disabled lamp controls, color validation, pending command convergence, Wi-Fi fixtures, alarms and calibrated sound behavior. UI tests open/close the nine Home complications, verify glyph taps stay on the face, drag global brightness and check both room states, verify disabled brightness, exercise the effects sheet, switch climate modes, and inspect every Wi-Fi fixture.

## Open the delivered Mac app

Unzip `WorldWideWebb.app.zip` on a Mac running macOS 26 or later. Right-click **WorldWideWebb.app → Open**. If Gatekeeper blocks the ad-hoc signed prototype, remove its quarantine attribute:

```sh
xattr -dr com.apple.quarantine WorldWideWebb.app
```

The release is ad-hoc signed, not notarized. Packaging commands:

```sh
codesign --force --deep -s - "$HOME/wwwebb-proto-dd/Build/Products/Release/WorldWideWebb.app"
ditto -c -k --keepParent "$HOME/wwwebb-proto-dd/Build/Products/Release/WorldWideWebb.app" WorldWideWebb.app.zip
```

## Feature map

| Source | Prototype |
| --- | --- |
| `features/ctrl/web/ControlsTileView.tsx`, `ExpandedControlsView.tsx`, `service.ts` | All; Fan; Lamps master with Bedroom and Living Room; Lights master with Ceiling and Under Cabinet. Brightness 0–100%, White/Mood, 2000–6500 K in 100 K steps, Custom 1/2/3 with hex Edit / Cancel / Save & use, Party Off/Slow/Med/Fast. |
| `features/ac/web/ClimateTileView.tsx` | Climate 2×2 tile with direct 1° chevrons; Cool / Heat / Heat·Cool / Off; 67–77 °F, 2° deadband; Now and action; same A/C fan in controller. |
| `features/wifi/web/WifiTileView.tsx` | Guest Wi-Fi / SSID complication. Full-screen QR hero, SSID and password; open and unconfigured variants. Tile remains glyph + SSID. |
| `features/events/web/ClockGreetingView.tsx`, `AlarmsPage.tsx`, `contract.ts` | Analog tile with smooth seconds; full-screen time, greeting, date, location, next alarm, enable/edit/delete/add; Label, Time, Date, Time zone, repeating days, Snooze minutes, Light entities or scene. |
| `features/weather/web/WeatherNowView.tsx`, `Next12HoursView.tsx` | Current conditions, high/low, Feels / Humidity / Wind / Sunset; 12 hourly temperature bars with feels marks, icon and time. |
| `features/sound/web/SoundSystemTileView.tsx`, `SoundSystemPage.tsx`, `hooks/useMixer.ts`, `calibration.ts` | Five rooms, Playing/Idle panels, blue coordinator, volume/mute, global/group locks, ±1 steppers, group moves, join all to Desk/TV, Calibrate/Clear. |

Photo Booth, Activity, PIN, settings, dim overlay, banners and confetti are excluded.

## Interaction and implementation

The grid remains mounted under a ZStack controller. `matchedGeometryEffect` pairs each tile's glass surface with its full-window surface. A 0.45 s zero-bounce spring moves it; content cross-fades and title/time arrive last. Close with the glass ×, Escape on Mac, or a downward swipe starting in the top header. Dismiss reverses to the same tile. Reduced Motion removes animated transitions and suppresses the demo.

Accessory glyphs toggle; the title or tile padding expands. Each room and fixture has its own complication. Each Lamps complication zooms into its room-titled controller, while global brightness and effects remain explicitly shared. Climate chevrons step directly. The other existing full-screen controllers retain their v1 behavior.

`@MainActor protocol HomeDataSource` is the integration seam. Views read its observable states and issue typed `HomeCommand`s. `MockHomeDataSource` performs optimistic updates and maintains a latest-command pending indicator for 150 ms, avoiding old completions clearing a new command's pending state. No transport exists. Later implementation can replace this store without changing the view hierarchy.

All is AND across every lamp/fixture, excluding Fan. Group masters are OR. Bedroom includes Bed Left, Bed Right and Mirror; Living Room includes Globe, Corner Lamp, Floor Lamp, Desk and Kitchen Lamp. Fan is A/C fan_mode, reads Off when HVAC is off, and retains its on/auto preference. Brightness, white temperature and Party are disabled with lamps off. Scene/color selection turns lamps on, as the real service does. Mood assigns unique palette colors in memory; Party records speed without physically animating lights.

Calibration stores raw × 2, so each nonzero room reads 50%. Display percentages can exceed 100 for external snapshots; faders send 0–100 display values and raw writes clamp to 0–100. Global lock matches displayed percentages across all rooms; group lock matches only the coordinator group. Clear removes calibration and the global lock.

## Fixtures and capture

Network: `WWW-Guest` / `fixture-password-123`. These are invented fixture credentials, explicitly requested for this prototype. Weather/location: San Francisco, 64°, partly cloudy. Clock starts at October 29, 2026, 3:41 PM Pacific and advances smoothly; no network clock or location permission. Alarms and speaker states are in-memory fixtures. Alarm edits validate fields, dates and time zones and calculate the next occurrence; the prototype does not ring or actuate devices.

Launch arguments (macOS `open --args`, or `simctl launch`):

```sh
xcrun simctl launch <UDID> co.worldwidewebb.prototype.ipad -openTile climate -climateMode heat_cool
xcrun simctl launch <UDID> co.worldwidewebb.prototype.ipad -openTile wifi -wifiFixture open
xcrun simctl launch <UDID> co.worldwidewebb.prototype.ipad -demo
```

`-face`: home (default), controls, clock, music.
`-presence`: near, far (default).
`-alarmRinging`: seed a ringing fixture occurrence.
`-openTile`: climate, clock, alarm, wifi, bedroom, livingRoom, ceiling, cabinet, fan, all. Existing controller links lamps, lights, weather, hourly and sound still work.
`-climateMode`: cool, heat, heat_cool, off.
`-wifiFixture`: secured (default), open, unconfigured.
`-demo`: a tour opening and closing the nine Home complications.

Use `scripts/capture.sh <UDID> <output-directory>` on the Mac for screenshots and a recording. Use `xcrun simctl io <UDID> screenshot` or `recordVideo` for individual captures. Every controller has a 1366×1024 preview. The wallpaper is procedural SwiftUI gradients and shapes; copyrighted references are never bundled.

Design API reference: [Apple — Liquid Glass for custom views](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views).

## v1 verification on the build mini

Built with Xcode 27.0 (27A266a), using the dedicated **WWW iPad 13** simulator on iOS 26.3. Ten unit tests and four UI tests pass, including every tile's open/close path, direct toggling, climate modes, all guest Wi-Fi variants and swipe-down dismissal. Run the UI suite once before scripted capture to set the simulator to landscape.

The delivered screenshots and 20-second recording were captured from the running simulator and visually reviewed. The macOS Release app builds and passes strict ad-hoc signature verification. Its runtime, Escape handling and window resizing still need an on-device check on macOS 26+; the build mini runs macOS 15.6 and cannot launch it.

The prototype is intentionally in-memory: it can display a seeded ringing state and simulate snooze/stop, but does not ring real alarms, play Sonos audio or actuate lights. Party stores its selected speed; Mood assigns fixture palette colors. Those device effects await a real data-source implementation.
