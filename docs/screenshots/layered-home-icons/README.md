# Layered home app icons

The four `approved-*.png` files are the design references approved in the icon
design conversation. Their style is extended across all 14 home apps, with
consistent optical padding. Lights is scaled down 14% from the first implementation
to balance the narrow bulb against the wider artwork. The production artwork is
authored as independent SwiftUI vector layers in `Sources/Apps/Icons`; the
references are not runtime assets.

## Real application captures

Captured on an iPad Pro 12.9-inch simulator at the panel's 1366 × 1024 point
viewport, with Xcode 27.2 / iOS 27.2. PNGs are full-resolution XCTest window
captures (2× scale, with orientation metadata). The video is the original H.264
simulator recording; retaining it avoids the edge and color changes introduced
by the smaller AVFoundation export. No artwork has been composited into the captures.

- [Before](home-before.png): `origin/main` at `90f2c0347`, before implementation.
- [After](home-after.png): the complete set of 14 new icons on the same home screen.
- [Press and open](press-and-open.mp4): real button presses, app opening and return
  to home for Weather, Lights, Music and Photos.
- Opened screens: [Weather](weather-opened.png), [Lights](lights-opened.png),
  [Music](music-opened.png), [Photos PIN gate](photos-opened.png).

Both home screenshots use the existing DEBUG fixtures, the Ember clock and the
same launcher layout. The live clock hands differ because the captures were
taken at different times. App data in the detail captures comes from the existing
DEBUG fixture suite, not live household services. Photos remains PIN-protected.

## Verification

From `apps/apple-prototype`, after `xcodegen generate`:

```sh
xcodebuild -project WorldWideWebb.xcodeproj -scheme Panel-Smoke \
  -destination 'platform=iOS Simulator,id=226E5ED5-37D5-4813-B777-18FDA3B96E15' \
  -derivedDataPath /tmp/layered-icons-dd \
  -resultBundlePath /tmp/layered-icons-full-interaction.xcresult \
  -parallel-testing-enabled NO \
  -only-testing:PanelUITests/LauncherMotionCaptureTests/testLayeredAppIcons \
  -only-testing:PanelUITests/HomeViewLaunchTests/testClockTapOpensHomeAndCloseReturnsToClock \
  CODE_SIGNING_ALLOWED=NO test

xcodebuild -project WorldWideWebb.xcodeproj -scheme WorldWideWebb \
  -configuration Debug -destination 'generic/platform=macOS' \
  -derivedDataPath /tmp/layered-icons-mac-dd CODE_SIGNING_ALLOWED=NO build
```

Both commands passed: two UI tests with zero failures, and a successful Mac build.
The icon interaction test opens all 14 apps, including the Clock route back to the
clock face, checks the Photos PIN gate and returns to Home after each app.
The home screenshots came from the existing
`PanelUITests/LauncherMotionCaptureTests/testGlassOverlay`, which also passed
before and after the change. `bun run typecheck` passed from the repository root.

The interaction check covers the touch press effect. Mac pointer movement and
Reduce Motion are implemented but were not separately exercised in these captures.
