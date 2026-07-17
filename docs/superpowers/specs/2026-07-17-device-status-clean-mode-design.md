# Device status rows + level view + clean-screen mode

Date: 2026-07-17. Approved via visual-companion mockups (v4).

## What

Three additions to the wall-panel web app (`products/control-center/web`), all
reachable from the existing Settings modal. No new board tiles.

### 1. Settings rows (Device section)

- **Battery**: live percentage and charging state, e.g. `100% · charging`, with
  sub-copy noting dock power. Source: `@capacitor/device` `getBatteryInfo()`,
  polled every 60s while the settings modal is open. In a plain browser
  (dev/Storybook) the plugin is absent: row shows `unavailable`.
- **Level**: live tilt readout, e.g. `+0.4°`, tap opens the full-screen level
  view. Source: `deviceorientation` events (see hook below). Positive angle =
  right side of the panel is high.

### 2. Full-screen level view (iPhone Level style)

- Black screen; a white plane whose edge is the horizon, rotated by the live
  tilt angle. `+` lifts the right side, `-` drops it.
- Large centred degree readout (Space Grotesk, ~150px). Dash marks left and
  right of centre.
- Within ±0.15° the screen floods the app accent blue (`--acc`, #0070f3) and
  the readout shows `0°` in **white** (no blend modes).
- Tap anywhere closes. Sensor listeners attach only while the view is open.

### 3. Clean-screen mode (Tesla style)

- Launched from a `Clean screen` row (Start button) in the Display section.
- Full-screen black overlay above everything (higher z than modals). It
  swallows every touch except its exit button.
- Content, centred column: `Cleaning mode` title, `mm:ss` countdown starting at
  10:00, and a `Press and hold to exit` button.
- Exit button: plain hairline outline; while held, a **white** fill sweeps left
  to right over 3s. Release early resets to empty. Fill completing exits the
  mode. No accent colour anywhere.
- Failsafe: when the countdown reaches 0:00 (10 minutes) the mode exits on its
  own, in case touches wedge.

## Architecture

- `src/lib/useTiltAngle.ts` , subscribes to `deviceorientation`, converts the
  event to a screen-relative roll angle (compensating `screen.orientation`),
  requests iOS motion permission on first use (must be called from a tap).
  Pure conversion function exported separately for unit tests.
- `src/lib/useBatteryInfo.ts` , wraps `@capacitor/device.getBatteryInfo()`
  behind `Capacitor.isNativePlatform()`; returns `null` in browsers.
- `src/components/LevelOverlayView.tsx` (dumb, `angle` prop) +
  `LevelOverlay.tsx` (portal + sensor + close handling). Stories for the view.
- `src/components/CleanScreenOverlayView.tsx` (dumb: `remainingMs`,
  `holdProgress` props) + `CleanScreenOverlay.tsx` (timers, hold gesture,
  auto-exit). Stories for the view; fake-timer tests for hold/auto-exit.
- `SettingsPanel.tsx` gains the three rows; overlays render via portals from
  the panel's host.

## Not building

Board tiles, battery history/alerts, level calibration offsets, sounds.

## Ship path

Web deploys on push to main. Adding `@capacitor/device` changes
`package.json`, which also triggers `ios-build.yml` → TestFlight build → the
panel's update banner picks it up; battery row shows `unavailable` until that
native update is installed.
