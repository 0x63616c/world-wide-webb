# WWW-69 notification review captures

Synthetic Debug Panel captures on the owned **WWW-69 iPad** simulator (12.9-inch
6th generation, iOS 26.3), Xcode 27.0, 2026-10-31. Each PNG is upright
**2732×2048 pixels / 1366×1024 points**, with a pure black backdrop. No board,
network providers, personal data or credentials are involved.

- `mac-single.png`: Updates / Update ready.
- `mac-stacked.png`: three notifications, two peeking cards and +2 count.
- `mac-expanded.png`: Updates, Clock & Alarms, Dog Walk and Show less.
- `mac-swipe.png`: the single card at a fixed 125-point rightward drag offset.

`PanelUITests/NotificationCaptureTests/testLandscapeReviewCaptures` launches
`-notificationCapture <state> -notificationHold`, holds landscape orientation,
and retains the four named XCTest attachments. The isolated host/switch is
compiled out of Release. Raw simctl captures taken after XCTest exits can instead
show a portrait, letterboxed app; those were discarded.

The exported XCTest PNGs contain EXIF orientation 8. Their rotation was baked into
pixels with ffmpeg (`-noautorotate -vf transpose=2`), and the inherited EXIF/XMP
rotation metadata removed. No image content was added, recolored or retouched.
All four final images were inspected visually against the macOS reference.

## Validation

`~/bin/www8-validate-png` was run on every full frame and on a diagnostic crop
containing the notification content. Crops preserve original pixels and remain
outside the repository in `/workspace/design-review/notif/`.

| State | Full frame | Content crop |
| --- | --- | --- |
| Single | Rejected: 96% black, uniform-frame heuristic | Pass, stdev 24.0 |
| Stacked | Rejected: 96% black, uniform-frame heuristic | Pass, stdev 25.6 |
| Expanded | Pass, stdev 14.4 | Pass, stdev 31.1 |
| Mid-swipe | Rejected: 97% black, uniform-frame heuristic | Pass, stdev 23.0 |

Every full frame passes the orientation/dimension check. The three uniform-frame
rejections are a limitation of validating the requested mostly black canvas;
the helper and its thresholds were left unchanged.

## Verification

All simulator tests/launches/captures ran under `~/bin/www8-simlock`, using only
the owned simulator, source directory `~/wwwebb-macnotif/` and derived data
`~/wwwebb-macnotif-dd`. Builds ran sequentially. The simulator and all task files
on the mini were removed after exporting evidence.

- `xcodegen generate`: passed.
- `PanelKit/swift test`: 15 XCTest + 70 Swift Testing tests passed.
- `xcodebuild build -scheme Panel`: passed.
- `xcodebuild build -scheme WorldWideWebb-iPad`: passed.
- `xcodebuild test -scheme Panel`: 119 Panel + 150 prototype tests passed.
- Focused `Panel-Smoke` UI runs: all 11 functional tests passed, including
  right-swipe/history retention on the real Panel root, three-item stacking,
  expansion/individual dismissal, expanded timer pause/resume, deep links,
  Reduce Motion/large text, both history tests, Update Ready on native/Classic,
  and `PanelSmokeTests` offline recovery. The real-root swipe test passed in a
  focused rerun after replacing the capture-host-only history gesture assertion.
- `NotificationCaptureTests`: one UI test passed, retaining all four images.
- Repository pre-push Biome and Knip checks passed.

Physical-device VoiceOver and haptic output were not manually exercised. The
existing VoiceOver Dismiss action and timer pause remain implemented.
