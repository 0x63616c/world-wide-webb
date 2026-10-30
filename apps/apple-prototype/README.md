# World Wide Webb — Apple prototype

Native SwiftUI study for [WWW-8](https://tickets.worldwidewebb.co/t/WWW-8), targeting iPadOS/iOS 26 and macOS 26. All values are fixtures; commands only change memory. No backend, personal data, device credentials, location permission or real device actuation is involved.

## Iteration 6

The iPad canvas is 1376×1032 points. Two Home pages use mixed 2×2, 2×1, 1×2 and circular 1×1 spans with 24-point gutters. The first shows Climate, global Lamps brightness, Weather, Tesla, Calendar, Now Playing and Fan. Home · More shows Cameras, Walk Zero, Photos, Media, Sonos Rooms and all five remaining round accessory shortcuts. Every tile opens a full-screen page with native zoom; accessory glyphs also toggle. Clock and Music remain separate faces.

The Mac window has a fixed 1376×1032 content frame, hidden title bar and `.windowResizability(.contentSize)`. Compact horizontal size classes use a separate two-column phone face and scrolling controllers. The iPhone target is portrait; iPad is landscape.

Native Liquid Glass supplies tile refraction, highlights and button chrome, without painted glass outlines. UI accents use semantic system colors and hierarchical text styles. The licensed photographic wallpaper and green clock artwork are the documented color exceptions. Clock green retains its hue and saturation with brightness reduced by 7%. System font metrics provide tracking. Near mode reserves a square dial, four complications including a charge ring, and a separate alarm footer.

Lamps has an All lamps brightness fader, room power controls, expandable members and Color & Effects. The next-alarm face has 120 uniformly weighted ticks around an arc-length sampled rounded rectangle. The design corner radius is 112 points, with an 80-point inset ring radius. It is **not a measured iPad 13-inch hardware radius**: Apple does not publish that measurement in the available resources. The separate 18-point research token describes older documented iPad models and is not misrepresented as current hardware.

Tesla preserves the retired service's field names and types: `name`, `nick`, `place`, optional `lat`/`lon`, `charging`, `chargingState`, `preconditioning`, `rate`, `pct`, `range`, `odo` and `climate`. Online/asleep/offline availability is separate. The fixture is Model Y / Car, Home, 78%, 241 mi, charging at 11 kW, cabin 64°F, with no coordinates. Only setCharging and setPreconditioning are exposed. Unavailable vehicles ignore commands; disconnected/no-power vehicles cannot start charging. There is no map.

Weather uses a condition-driven sky, licensed cloud photography and Canvas rain, Clock sweeps with TimelineView, Fan rotates only when on, Lamps breathes through PhaseAnimator according to brightness, Sonos EQ runs only when playing, and Tesla pulses through KeyframeAnimator only while charging. Reduced Motion uses static frames. `-snapshot` injects a fixed date and animation phase. iOS tile presentation uses matched transition sources and the native zoom navigation transition.

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
  -only-testing:WorldWideWebbTests/HomeFaceLayoutTests \
  -only-testing:WorldWideWebbTests/ModuleProviderTests \
  CODE_SIGNING_ALLOWED=NO test-without-building
```

These cover lamp membership/master semantics, climate bounds, optimistic commands, alarm occurrences, calibrated audio, Wi-Fi payload escaping and actual QR decoding, perimeter geometry and Tesla commands. Pass 6 updates the UI suite for the two mixed Home pages, native room switches, join QR codes and the remote Walk Zero state. Run all explicit project schemes with `bash scripts/verify-schemes.sh`; simulator tests are serialized by the shared lock, while builds run outside it. Panel and Panel-Smoke use separate derived-data products so a smoke build cannot strip the unit-test plugin.

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

Run `bash scripts/verify-live.sh` on the mini to build, run all unit tests (including layout and playback), and capture the live screens. For capture only, run `bash scripts/capture-live.sh` after building to install and deterministically launch Home, Lamps, near Clock, Controls and Now Playing on the iPad, plus Home and Now Playing on iPhone 17 Pro (iOS 26.3). Independent pass reviews use only these live `sim-*.png` captures. The phone face scrolls with the page controls in a reserved 80-point bottom safe-area inset and a 24-point margin above it at the scroll end. `-homeScrollBottom` deterministically captures that boundary. `HomeFaceLayoutTests` checks both layouts for overlap, equal gutters and safe margins. At 1376×1032, the panel uses 224-point cells, 24-point gutters, 80-point outer margins and an 80-point pager band.

## Pass 5: two Home pages and fixture modules

Home adds Weather and Calendar; swipe to Home · More for Cameras, Photos, Media and Sonos Rooms. All tiles open their full-screen controllers with native zoom. The shared layout solver tests both pages and both phone scroll boundaries. Tesla offers charging and cabin preconditioning only. Sonos volume locks remain.

Weather: four current metrics and 12 hours. Calendar: generic fixture day agenda. Media: choose an album/playlist and a Sonos room, or play the bundled silent lake film in AVKit. Sonos Rooms: per-room calibrated volume, mute, grouping. Cameras: two animated stock-photo feeds, explicitly marked Demo feed / Simulated camera. Photos: three bundled photos crossfade every 12 seconds; Reduce Motion disables automatic changes. All providers and commands are in-memory fixtures.

Launch the new pages with `-openTile weather|calendar|media|sonosRooms|cameras|photos`; use `-openTile media -showVideo` for deterministic video review. `-face controls` opens Home · More.

## Pass 5 bundled media

All downloaded 2026-10-29. No Apple or Calum reference image is bundled.

| Asset | Source / author | Licence | Processing / use |
| --- | --- | --- | --- |
| ForestPhoto | [Pathway of trees during daytime](https://unsplash.com/photos/pathway-of-trees-during-daytime-P1Iz3unD6Po), Johannes Plenio | [Unsplash Licence](https://unsplash.com/license) | 2752×1548 JPEG, quality 85; Photos and explicitly simulated Woodland feed |
| CoastPhoto | [Sunset](https://unsplash.com/photos/sunset-CA5mR_jecac), Luca Bravo | [Unsplash Licence](https://unsplash.com/license) | 1823×2752 JPEG, quality 85; Photos |
| LakeStudy.mp4 | Existing LakeWallpaper, Luca Bravo (source above) | Unsplash Licence | Local FFmpeg slow zoom, silent 12-second H.264 at 1280×720/25 fps; AVKit demo film |

Camera scenes are stock landscapes, not photographs of a user's home. Music covers, track names, albums and playlists are original authored fixtures; the prototype does not bundle recordings or imply real music output.

CloudPhoto: [Blue sky with white clouds](https://unsplash.com/photos/blue-sky-with-white-clouds-xtgONQzGgOE) by uriel (@xaze), [Unsplash Licence](https://unsplash.com/license). Downloaded 2026-10-29, JPEG quality 85, longest edge 2752 px. Weather condition artwork with slow TimelineView drift; clear skies use original SwiftUI sky/sun, rain adds original particles and desaturation.

## Pass 5b: Walk Zero

DogWalkApp adds a wide Walk Zero tile on Home · More, a full-screen history with weekly total, per-walk average, streak and 7/30-day Swift Charts, and a reserved lower-left Clock complication. The tile starts/stops a walk inline and its title opens the history. Idle reads “Last walk 3h ago · 32 min”. Cameras now occupies (0,0) 2×1 and Walk Zero (0,1) 2×1; the remaining spans and all five round controls are unchanged. Every module is reachable on both panel and phone Home pages, verified by the layout tests.

`WalkProvider` exposes `activeWalk`, `history`, `start(at:)` and `stop(at:)`. A walk has `{id, startedAt, startedBy device, endedAt?}`. Elapsed time is derived from `startedAt` in TimelineView; there is no local counter. `MockWalkBackend` owns one active record and a 3-week fixture log; multiple device providers share that backend. Starting twice is idempotent. Stopping from either client ends the shared record and appends history once. `-walkStartedRemotely` injects an iPhone start 12:04 earlier; `-walkRunning` starts locally. The mocks model server synchronization in memory, and do not connect the two separately launched simulator processes over a real network.

**Production follow-up:** persist the walk log and active walk in the backend (new table with stable ID, dog ID, startedAt, startedBy device and endedAt; enforce one active walk transactionally). Add tRPC start/stop/active/history procedures, with idempotent commands and a subscription or polling for cross-device updates. The backend owns timestamps and completion. Retain ActivityKit push-to-update tokens per device/walk so stopping on iPad also ends the iPhone Live Activity. Reconcile the current active record when either app launches or reconnects; never reset the start time locally.

The iOS app embeds `WalkActivityExtension` via project.yml. Lock Screen, compact/minimal and expanded Dynamic Island content use the shared startedAt and deep-link to history. Local observation synchronizes ActivityKit when the active record changes. The simulator preview is explicitly labelled and is not represented as a SpringBoard capture. Backend persistence, cross-device networking and push tokens remain follow-ups, matching the Sonos seek limitation in §6.

Validation: DogWalkProviderTests covers elapsed time, negative-clock clamping, remote start/stop, two clients sharing one active record, idempotent completion, fixture history and chart summaries. HomeFaceLayoutTests covers both faces, every module's reachability, safe margins, equal gutters and no overlapping frames on iPad and iPhone.

The live capture script waits for a `capture-ready` marker written by the mounted fixture UI, then takes a `simctl` screenshot. It fails if readiness never arrives; a fixed short sleep can capture SpringBoard on a loaded mini. iPad and iPhone capture sequentially using only this job’s simulator UDIDs. Pass 5b’s combined app suite passed all 81 tests after the PanelKit and live Sonos merges. Pass 5b has 25 inspected live captures under `docs/screenshots/v5/pass-5b/`; independent review scores Home 8.6, Lamps 9.0 and clock-near 8.8 (see `docs/v2/review-5b.md`).

## Pass 6 visual refinement

Compact cards use 36-point corners, an 80-point reserved pager band with a 56-point glass capsule, and a 16-point scroll fade over the continuous photo. Wide Home metadata is 24 points on iPad; Sonos room states and its explicit “All 5 rooms ›” link are 20 points. Walk Zero separates History from a 72-point circular Start/End action. Its active detail uses a labelled 64-point elapsed display with the origin device on a separate line; time still derives from the shared backend record. Lamps centres its value over the global fader, Clock aligns date/alarm above the pager, and Music reserves the pager band below its 440-point artwork/control stack.

Pass evidence is under `docs/screenshots/v6/pass-6/` and the external `v2/pass-6/` directory. Pager marks have 44×44-point hit targets; the entire Climate disclosure row accepts a tap. Capture with the mandatory `scripts/capture-live.sh`, which takes the shared Mac simulator lock and retries invalid PNGs at most three times. The independent cold reviewer receives only validated live screenshots, references and APPLE-SPEC.md, using the unchanged orchestrator prompt.

## Pass 6b

Walk history now has a native regular-material reading surface and 96-point rows. A reserved 144-point status region keeps statistics, chart and history in place when the shared walk starts or stops. Home separates calendar title/time/location, strengthens Sonos room hierarchy and fixes the walk tile’s title/history anchors. Phone Climate/Weather heights are 240/160 points, with soft scroll edges and the existing tested pager clearance. Clock hands sweep within the numeral opening; footer date/alarm share 20-point white type. Music uses previous/next-track endpoint symbols, and Lamps explicitly labels the global scope of Color & Effects. Live review evidence is in `docs/screenshots/v6/pass-6b/`; the authoritative reviewer uses the same fixed prompt and 12-image set as pass 6.


Pass 6c capture verification uses the shared simulator lock, per-PNG validity and orientation checks and two independent launches per screen. Snapshot readiness pins iPad landscape and iPhone portrait through the window scene before capture. `scripts/pixel-diff.py` compares full-resolution RGB with a maximum mean channel difference of 0.5/255; results live alongside captures in `determinism.tsv`. `WWW8_CAPTURE_ONLY`, `WWW8_CAPTURE_DEVICE` and `WWW8_CAPTURE_OUT` support short, named batches so the shared mini is released between capture phases. Snapshot values use `FixtureClock.now`; motion is phase zero and Mood colours retain fixture ordering. Three independent fixed-prompt reviews and the per-screen nonregression baseline govern acceptance. Full-size pass evidence stays outside the repo under `/workspace/wwwebb-ui/prototype/v2/pass-6c/`.

Iteration 7 redesign study: `docs/v2/redesign-7.md` records the reference critique and the proposed Home control groups, central Lamps instrument and circular watch-inspired Clock before implementation. Home preserves the tested 5×3 frame solver while grouping square information tiles and a rail of circular shortcuts. Phone retains its accepted full-width Weather/Calendar rows after the paired candidate regressed in cold review. The native zoom source includes the face identity, so repeated shortcuts open from the visible tile. The full-size live evidence and three-run reviews live externally in `v2/pass-7/` and `v2/review-7-*`; candidate visuals are accepted per screen only against the recorded median baseline.

Pass 7b refines the central Lamps instrument with room cards on its actual centerline, binds Home temperature actions to the value, and reduces the phone opacity fade to 8 points. Dog Walk content now has a stable black background, black action text on system green, explicit per-walk average, and chart-aligned statistics. Controls camera captions have localized feathered scrims; active lights share one native warm tint. Small evidence tables and reviews are tracked in docs/v2; PNGs stay in external v2/pass-7b.

Pass 7c restores the pre-7 seven-module Home after its redesign failed the permitted refinement. Home/More trial the bundled [ForestPhoto by Johannes Plenio](https://unsplash.com/photos/pathway-of-trees-during-daytime-P1Iz3unD6Po) under the [Unsplash Licence](https://unsplash.com/license), rechecked 2026-10-30: 2752×1548 JPEG, 2-point blur and 28% dimming. See docs/v2/sources.md. Phone uses 24-point gutters and measured heights to keep the full Music card visible at its bottom anchor. More has aligned footer links and an explicit orange mixed-light glyph. Passing full-screen detail compositions remain unchanged.

Pass 7d trials the existing CoastPhoto wallpaper: [Sunset by Luca Bravo](https://unsplash.com/photos/sunset-CA5mR_jecac), [Unsplash Licence](https://unsplash.com/license), 1823×2752 JPEG. Top crop, 75% saturation, 2-pt blur and 28% dimming; no new image is bundled. Home-owned Photos captions share the camera tile hierarchy; full-screen page ownership stays separate.


Pass 7e restores the existing **LakeWallpaper**, [Boathouse on a mountain lake by Luca Bravo](https://unsplash.com/photos/brown-house-near-body-of-water-zAjdgNXsMeg), under the [Unsplash Licence](https://unsplash.com/license), already verified 2026-10-29. Bundled at 2752 pixels wide, JPEG quality 85. Home applies 65% saturation and 62% global dimming without global blur; native clear glass supplies refraction. No new image is downloaded. This supersedes the forest/coast Home trials; other licensed photo uses remain.


Pass 7f retains the recorded licensed LakeWallpaper and restores its 2-point blur/28% dimming; the 7e strong-dimming trial is removed. There are no new assets. Home’s module regrouping and wide Sonos summary use the same fixtures and full-screen destinations.

Pass 7g restores the accepted seven-module Home and tall Sonos summary after the 7f candidate regressed. The live panel grid now anchors to its page container; scroll visibility removes offscreen glass contributors on iPhone. New live-window and visible-tile checks supplement the solver geometry suite. LakeWallpaper and its recorded Unsplash licence remain unchanged. See docs/v2/redesign-7g.md and external v2/pass-7g for evidence.
