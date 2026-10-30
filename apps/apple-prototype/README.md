# World Wide Webb — Apple prototype

Native SwiftUI HomeView-style study for [WWW-8](https://tickets.worldwidewebb.co/t/WWW-8). macOS 26+ and iPadOS 26+, built with Xcode 27. No backend, networking, bundled photos, QR codes, or production credentials. All device/weather/network/alarm values are **fixtures** and reset on launch.

## v2 iteration 1 — Home face and Lamps

The default screen is now a single Home face: a 4×3 grid, 40-point outer margins,
24-point gutters and nine complications. Climate occupies 2×2 cells; an analog
clock and Guest Wi-Fi sit above separate Bedroom and Living Room Lamps. Ceiling,
Under Cabinet, Fan and All occupy the bottom row. Small tiles are approximately
306×301 points on the 1376×1032 iPad. SF type uses a thin dominant temperature,
26-point semibold names and 20-point subtitles. Clear Liquid Glass, specular edges,
soft shadows and a procedural blurred teal wallpaper replace the folded ribbons.
ON accessories use bright frosted glass, dark text and amber glyphs.

The iPad face is in a paged TabView. Only Home exists in this iteration, so page
indicators are hidden until there are actual additional faces. Weather and Sound
controllers remain available by launch argument; their future faces are not built.

Bedroom and Living Room open the new Lamps controller from their own source tile.
A 220×560-point vertical brightness control supports dragging and VoiceOver
adjustment. It is labelled **All lamps**: `features/ctrl/api.ts` and `service.ts`
apply brightness globally and turn on every lamp, including the other room.
Room buttons toggle the two supported groups. Members are captions, never invented
individual controls. `packages/core/src/lights/index.ts` confirms Under Cabinet is
in Kitchen. Color & Effects opens one sheet with the existing White/Mood, white
temperature, three editable saved colors and Party controls. The fixture store,
other full-screen controllers and their supported features are preserved.

Final iteration screenshots: [Home](docs/screenshots/v2/home.png) ·
[Lamps](docs/screenshots/v2/lamps.png). The labelled reference comparison and critique
live outside the repository at `/workspace/wwwebb-ui/prototype/v2/`; reference
photos are never committed. Existing screenshots and packaging below document v1.

Validation on WWW iPad 13 / iOS 26.3 / Xcode 27.0: 10 store tests and 6 UI tests
pass. The nine-tile open/close loop and global brightness test also pass after the
final pager safe-area change. Three simulator render/review passes were used;
only the final Home and Lamps captures are delivered for this iteration. Xcode's
optional simulator diagnostics collector reports a missing `simctl` in its own
subprocess; the test runs themselves report **TEST SUCCEEDED**, and direct
`simctl` captures succeed with the selected Xcode developer directory.

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

Unit tests cover master semantics, membership, fan/climate state, bounds/deadband, disabled lamp controls, color validation, pending command convergence, Wi-Fi fixtures, alarms and calibrated sound behavior. UI tests open/close the nine Home complications, verify glyph taps stay on the face, drag global brightness and check both room states, verify disabled brightness, exercise the effects sheet, switch climate modes, and inspect every Wi-Fi fixture.

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
| `features/wifi/web/WifiTileView.tsx` | Guest Wi-Fi / SSID complication. Full-screen SSID and password; open and unconfigured variants. No QR. |
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

`-openTile`: climate, clock, wifi, bedroom, livingRoom, ceiling, cabinet, fan, all. Existing controller links lamps, lights, weather, hourly and sound still work.
`-climateMode`: cool, heat, heat_cool, off.
`-wifiFixture`: secured (default), open, unconfigured.
`-demo`: a tour opening and closing the nine Home complications.

Use `scripts/capture.sh <UDID> <output-directory>` on the Mac for screenshots and a recording. Use `xcrun simctl io <UDID> screenshot` or `recordVideo` for individual captures. Every controller has a 1366×1024 preview. The wallpaper is procedural SwiftUI gradients and shapes; copyrighted references are never bundled.

Design API reference: [Apple — Liquid Glass for custom views](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views).

## v1 verification on the build mini

Built with Xcode 27.0 (27A266a), using the dedicated **WWW iPad 13** simulator on iOS 26.3. Ten unit tests and four UI tests pass, including every tile's open/close path, direct toggling, climate modes, all guest Wi-Fi variants and swipe-down dismissal. Run the UI suite once before scripted capture to set the simulator to landscape.

The delivered screenshots and 20-second recording were captured from the running simulator and visually reviewed. The macOS Release app builds and passes strict ad-hoc signature verification. Its runtime, Escape handling and window resizing still need an on-device check on macOS 26+; the build mini runs macOS 15.6 and cannot launch it.

The prototype is intentionally in-memory: it doesn't ring alarms, play Sonos audio or actuate lights. Party stores its selected speed; Mood assigns fixture palette colors. Those device effects await a real data-source implementation.
