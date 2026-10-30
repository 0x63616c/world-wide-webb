# World Wide Webb — Apple prototype

Native SwiftUI study for [WWW-8](https://tickets.worldwidewebb.co/t/WWW-8), targeting iPadOS/iOS 26 and macOS 26. All values are fixtures; commands only change memory. No backend, personal data, device credentials, location permission or real device actuation is involved.

## Iteration 4

The iPad canvas is 1376×1032 points. Home uses a five-column, three-row composition: 2×2 Climate, 1×2 Lamps with a global brightness control, 2×1 Music and Car, and circular Clock, Ceiling, Fan, Guest Wi-Fi and All lights. Cells and gutters snap to eight points. Every tile opens its full-screen controller with native zoom; accessory glyphs also toggle. Controls retains Weather, Car, Sonos, Under Cabinet, Fan and All. The other faces are Clock and Music.

The Mac window has a fixed 1376×1032 content frame, hidden title bar and `.windowResizability(.contentSize)`. Compact horizontal size classes use a separate two-column phone face and scrolling controllers. The iPhone target is portrait; iPad is landscape.

Native Liquid Glass supplies tile refraction, highlights and button chrome, without painted glass outlines. UI accents use semantic system colors and hierarchical text styles. The licensed photographic wallpaper and green clock artwork are the documented color exceptions. Clock green retains its hue and saturation with brightness reduced by 7%. System font metrics provide tracking. Near mode reserves a square dial, four complications including a charge ring, and a separate alarm footer.

Lamps has an All lamps brightness fader, room power controls, expandable members and Color & Effects. The next-alarm face has 120 uniformly weighted ticks around an arc-length sampled rounded rectangle. The design corner radius is 112 points, with an 80-point inset ring radius. It is **not a measured iPad 13-inch hardware radius**: Apple does not publish that measurement in the available resources. The separate 18-point research token describes older documented iPad models and is not misrepresented as current hardware.

Tesla preserves the retired service's field names and types: `name`, `nick`, `locked`, `place`, optional `lat`/`lon`, `charging`, `chargingState`, `preconditioning`, `rate`, `pct`, `range`, `odo` and `climate`. Online/asleep/offline availability is separate. The fixture is Model Y / Car, Home, 78%, 241 mi, charging at 11 kW, locked, cabin 64°F, with no coordinates. Only setLock, setCharging and setPreconditioning are exposed. Unavailable vehicles ignore commands; disconnected/no-power vehicles cannot start charging. There is no map.

Weather uses a condition-driven MeshGradient and Canvas, Clock sweeps with TimelineView, Fan rotates only when on, Lamps breathes through PhaseAnimator according to brightness, Sonos EQ runs only when playing, and Tesla pulses through KeyframeAnimator only while charging. Reduced Motion uses static frames. `-snapshot` injects a fixed date and animation phase. iOS tile presentation uses matched transition sources and the native zoom navigation transition.

The research specification, reference images, independent reviews, comparison sheets, live log and motion proof remain outside this repository at `/workspace/wwwebb-ui/prototype/v2/`. Reference images are never bundled or committed. Images under `docs/screenshots/v2/` document the previous iteration, not this pass. `mac-home.png` is explicitly an **iOS-hosted Mac layout render**; the build mini runs macOS 15.6 and cannot launch a macOS 26 app.

## Build and verify

Use Xcode 27 and XcodeGen on the build mini:

```sh
cd ~/wwwebb-proto
export DEVELOPER_DIR=/Applications/Xcode-27.0.app/Contents/Developer
/opt/homebrew/bin/xcodegen generate
bash scripts/snapshot.sh
```

The snapshot scheme excludes UI automation. It uses the warm `~/wwwebb-proto-dd` build directory and the already-booted WWW iPad 13 simulator. Fixed-date scenes are captured at 1376×1032 points, scale 2. Each scene has an `-imagerenderer.png` geometry capture and a hosted `UIHostingController`/`drawHierarchy` capture preserving native materials. ImageRenderer alone omits platform glass compositing. Outputs land in `~/wwwebb-proto-snapshots/`. Use `--no-build` only when test products match the sources.

Run the unit suite independently:

```sh
xcodebuild -project WorldWideWebb.xcodeproj -scheme WorldWideWebb-Snapshots \
  -destination 'platform=iOS Simulator,id=A0ECBA0E-5E14-4DE2-ACD7-7C2A5EA0AFBF' \
  -derivedDataPath "$HOME/wwwebb-proto-dd" -parallel-testing-enabled NO \
  -only-testing:WorldWideWebbTests/HomeDataSourceTests \
  -only-testing:WorldWideWebbTests/WifiQRCodeTests \
  -only-testing:WorldWideWebbTests/AlarmPerimeterTests \
  -only-testing:WorldWideWebbTests/TeslaProviderTests \
  CODE_SIGNING_ALLOWED=NO test-without-building
```

These cover lamp membership/master semantics, climate bounds, optimistic commands, alarm occurrences, calibrated audio, Wi-Fi payload escaping and actual QR decoding, perimeter geometry and Tesla commands. Legacy UI tests have not been rerun or updated for iteration 3; they are not a claim of current interaction coverage.

Build the fixed Mac app without attempting to launch it on macOS 15:

```sh
xcodebuild -project WorldWideWebb.xcodeproj -scheme WorldWideWebb \
  -configuration Release -destination 'generic/platform=macOS' \
  -derivedDataPath "$HOME/wwwebb-proto-mac-dd" CODE_SIGNING_ALLOWED=NO build
```

## Fixtures and commands

`HomeDataSource` is the observable integration seam. `MockHomeDataSource` applies typed commands optimistically, retaining a latest-command pending indicator for 150 ms. The independent Tesla provider follows its retired service contract. Both reset on launch.

All is AND across lamps and fixtures, excluding Fan. Group masters are OR. Bedroom contains Bed Left, Bed Right and Mirror; Living Room contains Globe, Corner Lamp, Floor Lamp, Desk and Kitchen Lamp. Fan reads Off when HVAC is off. Brightness, white temperature and Party are disabled with lamps off; scene/color selection turns lamps on. Mood changes fixture colors in memory, and Party records a speed without actuating devices.

Climate supports Cool, Heat, Heat·Cool and Off, with 67–77°F bounds and a 2° deadband. Weather includes current conditions and hourly fixtures. Alarm editing, next occurrences, snooze and stop remain available; there is no invented timer feature. Music supports transport, grouping, mute, volume and prototype seeking. Fixtures expose `positionSeconds`, `durationSeconds` and `positionUpdatedAt`; a TimelineView advances the thin scrubber while playing. Seeking synchronizes grouped rooms and clamps to track bounds; pause preserves the current position. The time scrubber sits below track metadata and volume below transport. Production still needs those fields and a seek mutation before this capability can be connected live (ARCHITECTURE.md §6). Sound calibration remains in the existing mixer.

Guest Wi-Fi uses invented `WWW-Guest` / `fixture-password-123` credentials. Its full-screen CoreImage QR has integer scaling, nearest-neighbour interpolation, quiet zone and escaped Wi-Fi payload. Open and unconfigured fixtures are supported. QR codes never appear on a tile.

Launch examples:

```sh
xcrun simctl launch <UDID> co.worldwidewebb.prototype.ipad -face clock -presence near -snapshot
xcrun simctl launch <UDID> co.worldwidewebb.prototype.ipad -openTile tesla
xcrun simctl launch <UDID> co.worldwidewebb.prototype.ipad -openTile wifi -wifiFixture open
xcrun simctl launch <UDID> co.worldwidewebb.prototype.ipad -demoAutoPage
```

Arguments:

- `-face`: home, controls, clock or music.
- `-presence`: near or far; an explicit prototype input, not a presence sensor.
- `-openTile`: climate, clock, alarm, wifi, bedroom, livingRoom, ceiling, cabinet, fan, all, lamps, lights, weather, hourly, sound or tesla.
- `-climateMode`: cool, heat, heat_cool or off.
- `-wifiFixture`: secured, open or unconfigured.
- `-alarmRinging`: seed a ringing alarm occurrence.
- `-snapshot`: fixed 10:10:30 Pacific fixture date and deterministic motion phase.
- `-demoAutoPage`: show Home for five seconds, Controls for five, then Music; enable the mock fan to demonstrate its state-driven motion. Reduced Motion suppresses automatic paging.

The iPad simulator screenshots and 10–15-second `simctl io recordVideo --codec h264` recording provide the runtime material and motion evidence. Phone screenshots come from an iPhone 17 Pro simulator. Native macOS appearance and interaction still require macOS 26 hardware.

## Wallpaper attribution and live review

Photo: [Boathouse on a mountain lake](https://unsplash.com/photos/brown-house-near-body-of-water-zAjdgNXsMeg) by Luca Bravo, used under the [Unsplash Licence](https://unsplash.com/license). Bundled at 2752 pixels wide, JPEG quality 85. Full source and processing notes: [docs/v2/sources.md](docs/v2/sources.md). Apple and Calum references are neither bundled nor committed.

Run `bash scripts/verify-live.sh` on the mini to build, run all unit tests (including layout and playback), and capture the live screens. For capture only, run `bash scripts/capture-live.sh` after building to install and deterministically launch Home, Lamps, near Clock, Controls and Now Playing on the iPad, plus Home and Now Playing on iPhone 17 Pro (iOS 26.3). Independent pass reviews use only these live `sim-*.png` captures. The phone face scrolls with the page controls in a reserved 64-point bottom safe-area inset and a 24-point margin above it at the scroll end. `-homeScrollBottom` deterministically captures that boundary. `HomeFaceLayoutTests` checks both layouts for overlap, equal gutters and safe margins. At 1376×1032, the panel uses 224-point cells, 24-point gutters, 80-point outer margins and an 80-point pager band.
