# Adaptive windows and Duo validation

Native compilation, live resizing and actual Duo captures still require macOS/Xcode; Linux checks do not establish simulator correctness or App Store readiness.

## Layout

Tendr uses one system `TabView` and retains each section's `NavigationStack` during resize. Like `0x63616c/folding`'s `FoldingRootView`, iOS 18+ uses `.tabBarOnly`; iOS 26+ also sets `.tabBarMinimizeBehavior(.never)`. Duo uses its native trailing vertical rail, while older phones keep standard tabs. Section roots draw their existing PageHeader without an empty system navigation bar; pushed details explicitly show their navigation bar and Back action. There is no custom sidebar or forced leading sidebar placement. Editors load their initial values once so a presentation adaptation cannot overwrite an unsaved draft.

This follows Apple's [Preparing your app for iPhone Duo](https://developer.apple.com/documentation/technologyoverviews/preparing-your-app-for-iphone-duo) and [Prepare your app for iPhone Duo](https://developer.apple.com/videos/play/tech-talks/111461/) guidance: standard navigation containers, window-relative layouts, size classes rather than device/orientation checks, asymmetric safe areas, and testing open, closed, partially folded and Split View configurations. `TendrLayout` controls readable content width and graph height, not the system's navigation placement.

Regular content is centered with a 760-point maximum, including the weight graph; chart labels keep normal font sizes and a small automatic tick count. The graph grows in regular height and shrinks in compact height. All orientations are supported. Forms and scroll views retain keyboard avoidance; the disclaimer and tip thank-you also scroll in short windows. Sheets use system form/page sizing on iOS 18+, with an iOS 17 fallback, and full-screen adaptation in compact height.

Medication chart selections survive folding. Explicitly switching away from Home and returning restores the live estimate, preserving the existing tab-navigation behavior without using appearance callbacks as a resize signal.

RDesign surfaces use [ConcentricRectangle](https://developer.apple.com/documentation/swiftui/concentricrectangle) on iOS/macOS 26+, retaining the existing minimum corner radius and exposing the container shape to nested cards. Earlier systems retain rounded rectangles.

The source audit found no device-idiom checks, orientation-based layout decisions, specific-screen-size comparisons or `UIScreen.main` calls. Remaining fixed widths are glyphs, touch targets, a compact vial illustration and a bounded information popover. There is no full-bleed photo/video/hero content; the shared app mark already uses aspect fit. UI test attachments capture every active `XCUIScreen` rather than assuming `.main` is the active display or cropping a rotated app window; `XCUIDevice` controls test rotation, not app layout.

## Review improvements

- Native tab-only placement matches Folding, with a trailing rail on Duo and a stable tab host across window changes.
- Editors use system confirmation and cancellation toolbar placements with titles and symbols. Dose and weight saves no longer depend on a full-width bottom strip or scrolling to the end of a form, leaving more space for content and the keyboard in short windows.
- Expanded medication graphs shrink in compact height, as weight graphs already did. Home and Progress summaries and the Treatment schedule summary stack at accessibility text sizes; weekday markers can grow vertically.
- Duo UI tests assert all five destinations in a trailing vertical rail on each display, section changes, compact-height editor actions, accessibility text, and live-fold destination/filter/draft retention. Navigation queries accept the system's vertical tabs rather than assuming a horizontal `tabBars` container. PR previews include both editors with the keyboard visible.

Build distribution artifacts with Xcode 27.1+ for Duo's complete screen and vertical-bar behavior. Earlier systems keep their supported tab behavior; that fallback is not evidence of native Duo support.

## Capture

From the repository root:

```sh
DEVELOPER_DIR=/Applications/Xcode_27.1.app/Contents/Developer \
  scripts/capture-duo-screenshots.sh tendr build/duo-screenshots/tendr/raw light dark
python3 scripts/test-duo-screenshots.py
```

The script defaults to `build/duo-screenshots/tendr/raw`, both appearances, the hosted iOS 27.1 Duo runtime, and an installed device type whose name contains `iPhone Duo`. `R_SIM_DEVICE_TYPE` and `R_SIM_RUNTIME` override those choices. Missing Duo device types fail clearly. Other apps must configure a compatible `duo_screenshot_test` in `app.yml` before using this script.

Landscape filenames describe a requested device orientation; inner displays and centered sheets may keep portrait geometry. The separate compact-height editor test requires a single-screen phone or a host that can select the outer display.

The helper probes the installed `simctl` help and display enumeration. Advertised fold/display state commands are tried on the disposable simulator. If both states succeed, the UI tests visit inner and outer and check a live fold without relaunching. If only explicit inner/outer display IDs are exposed, a host/test handshake captures both with `simctl io screenshot --display`. When integrated screen IDs are exposed without inner/outer names, the helper captures every reported integrated screen as `default-screen-<id>` and explicitly skips live-fold checks. With no usable IDs it falls back to the default screen. Without host control, no display role is inferred from pixel dimensions.

Raw files are named `inner-light-home.png`, `outer-dark-progress.png`, etc. Fallback files are named `default-light-home.png` or `default-screen-<id>-light-home.png`, etc.; they are never relabelled inner/outer. Each run clears previous captures with those names and its metadata, preserving unrelated files in the output folder. `capture-notes.txt`, `plan.json` and `simctl-capabilities.txt` record the supported interface and limitations. The capture helper synchronizes with each test screen, so both physical displays are captured before navigation proceeds. PNG presence and headers are checked; there is no 1320×2868 requirement or framing step. Named displays can be inactive in a particular pose: inspect the raw images on the installed runtime before using them externally.

The **Duo screenshots** workflow runs on GitHub-hosted `xcode-27` with Xcode 27.1 and the iOS 27.1 Duo runtime. Manual dispatch accepts `app` (default `tendr`) and `developer_dir` (default `/Applications/Xcode_27.1.app/Contents/Developer`). If that path is unavailable, it tries the hosted underscore spelling before the legacy `/Applications/Xcode-27.1.app`, then the newest usable `/Applications/Xcode*.app` by version. It ignores repository runner/toolchain variables. Duo capture and export failures fail PR checks. CI enables `DUO_HOST_CONTROL=1`: when simctl exposes only unnamed integrated displays, a macOS XCTest controller selects the disposable device in Device Hub and uses its Open/Closed controls. Native pixel modes identify candidate display IDs; the iOS tests verify the resulting inner/outer layouts and live state retention, and release export rejects blank or incorrectly sized images. The host controller runs only with that explicit opt-in; local probing retains its read-only fallback unless requested. The workflow lists device types/runtimes and fails clearly if its selected Xcode has no iPhone Duo device type. It uploads `duo-screenshots-<app>` and does not publish anything. For optional local capture, install a compatible runtime and use `R_SIM_RUNTIME` to override the iOS 27.1 default if needed. The root `scripts/setup-mac-runner.sh` is optional legacy setup, not required by CI.

The CI controller starts Device Hub's internal executable from the selected Xcode and verifies that AppKit reports the same positive process ID before attaching XCTest. This avoids the [reported trampoline launch-identity bug](https://github.com/openai/codex/issues/44717). It refuses to replace an existing Device Hub session and cleans up only the process it owns; no signed-bundle edits or privacy resets are involved.

The controller uses Device Hub's [Device → Orientation menu](https://developer.apple.com/documentation/xcode/interacting-with-your-app-in-device-hub) to select an absolute portrait or landscape pose. Duo runs use this single physical control instead of combining relative turns with XCTest's independent orientation sensor; single-screen fallbacks use `XCUIDevice.orientation`. The handoff keeps the runner's event loop running so native orientation notifications can update its coordinates. The compact-height test captures that checkpoint, requires a genuinely short window, and checks the draft and reachable Save/Cancel actions above the keyboard. XCTest teardown restores portrait even after an assertion aborts a test. Every live fold must enlarge the full-screen fixture window when opening or shrink it when closing, preserving navigation and drafts independently of aspect ratio. Each fold captures the active physical display; XCTest's default recording follows the primary display and goes black when it turns off. Section changes wait for the selected tab before interacting with the next screen.

The two long scenarios (all screens on both displays, and five live folds) allow up to ten minutes each; their individual window and handoff waits stay bounded. The hosted screenshot scenario exceeded XCTest's default five-minute allowance while using native menu controls. Both complete appearance suites plus cold SDK builds have a 100-minute capture limit and a 120-minute workflow limit.

After changing orientation, the bridge reselects the requested Open/Closed display before acknowledging the combined handoff. A failure to restore the display fails the request. Fold checkpoints retain before/after app hierarchies as well as settled physical-display captures so a stale accessibility window can be distinguished from a failed display transition.

## Native verification still required

- Background and reactivate the app on each display. XCTest hardware Home targets the primary display, so the automated background assertion runs on single-screen phones; verify the inner-display lifecycle through Device Hub.
- Run the existing `StillUITests` and `DuoScreenshotTests` on the Xcode 27.1 Duo simulator and the compact iPhone simulator. Compare compact captures with the existing screenshot baseline, including tab/navigation bars and safe areas.
- Check all five sections in light/dark on inner/outer displays. Inspect each raw capture for correct display content, readable axes, corner alignment and fully visible controls.
- Verify the trailing vertical rail, then open Medication details, switch sections, fold/unfold repeatedly, and return. The destination and section selection must remain. Change the Journal filter and Progress range; verify both survive the same cycle. Automated tests require trailing tab navigation on both displays and an actual window resize with the draft open; a successful host command alone is insufficient.
- Open dose, weight, goal, vial and schedule editors. Change values and notes, show the keyboard, fold/unfold and rotate in both directions. Drafts, focus, cancellation and Save must remain usable. Automated live-fold checks cover the dose draft and navigation when the installed CLI supports folding.
- Check compact-height inner/outer landscape and tent poses, including first-launch acknowledgement and the tip thank-you. Scroll to the last control and test with larger Dynamic Type.
- Resize continuously to extreme widths/heights with the resizable simulator or iPhone Mirroring. No device-specific assumptions should be needed. If CLI folding is unavailable, do the state-retention checks manually in Simulator; a successful fallback capture is not proof of fold behavior.

## Portable checks

`TendrLayoutTests` cover the trait matrix, nil-trait fallback, readable-width policy and compact-height chart sizing. Run `swift test --package-path apps/tendr` and `swift test --package-path packages/RDesign` wherever Swift is installed. The PR CI tooling job runs `scripts/test-duo-screenshots.py`: Xcode selection, capability parsing and the complete shell/helper handshake against mocked macOS tools, including both appearances, unsupported controls, paths with spaces, device overrides and stale-output cleanup after success or failure. Those mocks do not validate an actual Apple simulator interface.
