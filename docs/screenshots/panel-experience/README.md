# Native home experience review

Captured from the running SwiftUI app on 5 November 2026 with Xcode 27.2 / iOS
27.2. These are simulator and macOS design-host captures using the explicit
debug fixtures, not production home readings. The small command trace in the
upper-left corner of some panel images is test instrumentation. Screenshots
of the wall panel are exported at its 1366 × 1024 logical resolution.

**Review before merge.** The PR remains open for Calum to review these designs
and try the simulators. No production deployment or TestFlight upload is part
of this review handoff.

## Wall panel

The clock and launcher remain the entry point. Settings use a native sidebar
and grouped forms; Lights shares the same controls as the personal app; Climate
uses the full-page vertical temperature gesture.

| Screen | Capture |
| --- | --- |
| Launcher, including Spotify | [wall-launcher.png](wall-launcher.png) |
| Background gallery | [settings-background.png](settings-background.png) |
| Dimming and return-to-clock sliders | [settings-display.png](settings-display.png) |
| Room controls, brightness and white temperature | [wall-lights.png](wall-lights.png) |
| Custom colour preview and save | [wall-color-editor.png](wall-color-editor.png) |
| Apple's native colour picker | [wall-color-picker.png](wall-color-picker.png) |
| Full-page temperature | [wall-climate.png](wall-climate.png) |
| Heat/cool range | [wall-climate-range.png](wall-climate-range.png) |
| Spotify library and Sonos controls | [wall-spotify.png](wall-spotify.png) |

Interaction recordings: [wallpaper switching](wallpaper-switch.mp4) and
[temperature swipes, fan and mode changes](climate-swipe.mp4).

## Personal devices

Shared screens/providers sit inside native tabs on iPhone/Duo and a sidebar on
macOS. Personal devices open Home directly and do not run the wall clock/idle
policy. The macOS target is a fixture-backed design host; the live Panel target
also supports running as an iOS app on Mac.

| Screen | Capture |
| --- | --- |
| iPhone Home | [iphone-home.png](iphone-home.png) |
| iPhone Lights | [iphone-lights.png](iphone-lights.png) |
| iPhone Climate with system toolbar | [iphone-climate.png](iphone-climate.png) |
| iPhone app settings | [iphone-settings.png](iphone-settings.png) |
| Duo outer display | [duo-outer-home.png](duo-outer-home.png) |
| Duo vertical fold, Climate readout in clear region | [duo-fold-climate.png](duo-fold-climate.png) |
| Duo tabletop fold | [duo-tabletop-climate.png](duo-tabletop-climate.png) |
| Duo Spotify | [duo-spotify.png](duo-spotify.png) |
| Mac sidebar and Lights | [mac-lights.png](mac-lights.png) |
| Native Mac Settings window | [mac-settings.png](mac-settings.png) |

[Duo folding recording](duo-fold.mp4). Device Hub has three review simulators:
`Panel Experience Review`, `Panel Personal iPhone Review`, and
`Panel Personal Duo Review`. They use isolated test data and do not control the
home. In the personal app, Settings is under More; on Mac use Command-comma.

## Verification

- `bun run typecheck`, `bun run lint`, `bun run knip`, `bun run apps:check`, and
  `bun run build:www` passed.
- `bun run test:unit`: 160 files / 1,671 tests passed; 71 skipped.
- Isolated PostgreSQL walk integration suite: 9 passed, including quiet walk start.
- PanelKit Swift tests: 97 passed. Native app unit tests: 322 passed across the
  Panel and shared SwiftUI targets. Phone/iPad window policy: 2 targeted tests
  passed after the final Info.plist adjustment.
- UI tests passed for room toggles/brightness, climate commands, command failure,
  colour preview without a write followed by save, wallpaper selection/persistence,
  Settings back navigation, idle dim/wake, timers, and personal tab/navigation state
  through rotation. The colour check caught inherited accessibility identifiers;
  those were corrected and the test passed.
- macOS target built successfully. CI toolchain and scheme guard tests passed.
- Manual Duo outer/open/partially folded/rotated/tabletop checks confirmed the
  shared navigation and temperature readout; Spotify's draft survived layout changes.

Physical device, full VoiceOver/Dynamic Type matrix, and live speaker playback
remain unverified. A read-only Home Assistant check found five Sonos rooms and
working browse responses, but no Spotify HA account. Sonos favourites and Spotify
links are supported; browsing a Spotify library requires connecting Spotify in
Home Assistant, and Sonos playback requires Spotify linked in Sonos. This app
controls speakers rather than streaming Spotify audio locally. See the
[Spotify integration notes](../../../features/spotify/README.md).

Tesla's retained offline readings and walk-start notification removal are covered
by backend/provider tests; the changes do not redesign those existing pages.
