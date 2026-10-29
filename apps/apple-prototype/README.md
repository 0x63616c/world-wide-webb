# World Wide Webb — Apple prototype

Native SwiftUI HomeView-style study for [WWW-8](https://tickets.worldwidewebb.co/t/WWW-8). macOS 26+ and iPadOS 26+, built with Xcode 27. No backend, networking, bundled photos, QR codes, or production credentials. All device/weather/network/alarm values are **fixtures** and reset on launch.

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

Unit tests cover master semantics, membership, fan/climate state, bounds/deadband, disabled lamp controls, color validation, pending command convergence, Wi-Fi fixtures, alarms and calibrated sound behavior. UI tests open/close every tile, check glyph taps don't expand, switch climate modes, and inspect every Wi-Fi fixture.

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
| `features/wifi/web/WifiTileView.tsx` | Small Wi-Fi / Guest tile. Full-screen SSID and password; open and unconfigured variants. No QR. |
| `features/events/web/ClockGreetingView.tsx`, `AlarmsPage.tsx`, `contract.ts` | Analog tile with smooth seconds; full-screen time, greeting, date, location, next alarm, enable/edit/delete/add; Label, Time, Date, Time zone, repeating days, Snooze minutes, Light entities or scene. |
| `features/weather/web/WeatherNowView.tsx`, `Next12HoursView.tsx` | Current conditions, high/low, Feels / Humidity / Wind / Sunset; 12 hourly temperature bars with feels marks, icon and time. |
| `features/sound/web/SoundSystemTileView.tsx`, `SoundSystemPage.tsx`, `hooks/useMixer.ts`, `calibration.ts` | Five rooms, Playing/Idle panels, blue coordinator, volume/mute, global/group locks, ±1 steppers, group moves, join all to Desk/TV, Calibrate/Clear. |

Photo Booth, Activity, PIN, settings, dim overlay, banners and confetti are excluded.

## Interaction and implementation

The grid remains mounted under a ZStack controller. `matchedGeometryEffect` pairs each tile's glass surface with its full-window surface. A 0.45 s zero-bounce spring moves it; content cross-fades and title/time arrive last. Close with the glass ×, Escape on Mac, or a downward swipe starting in the top header. Dismiss reverses to the same tile. Reduced Motion removes animated transitions and suppresses the demo.

Accessory glyphs toggle; the title or tile padding expands. Lamps and Lights use the brief's allowed medium group tile variant. Their room/fixture sub-buttons toggle directly; the surrounding group surface opens the shared Controls controller. Climate chevrons step directly. Sound's faders, mute and locks also work directly on its tile.

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

`-openTile`: climate, clock, all, fan, lamps, lights, wifi, weather, hourly, sound.
`-climateMode`: cool, heat, heat_cool, off.
`-wifiFixture`: secured (default), open, unconfigured.
`-demo`: a roughly 20 s tour opening and closing all ten source tiles.

Use `scripts/capture.sh <UDID> <output-directory>` on the Mac for screenshots and a recording. Use `xcrun simctl io <UDID> screenshot` or `recordVideo` for individual captures. Every controller has a 1366×1024 preview. The wallpaper is procedural SwiftUI gradients and shapes; copyrighted references are never bundled.

Design API reference: [Apple — Liquid Glass for custom views](https://developer.apple.com/documentation/swiftui/applying-liquid-glass-to-custom-views).
