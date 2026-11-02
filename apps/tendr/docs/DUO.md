# Adaptive windows and Duo validation

Source version: **1.1.0 (29)**. Native compilation, live resizing and actual Duo captures still require macOS/Xcode; Linux checks do not establish simulator correctness or App Store readiness.

## Layout

`TendrLayout` uses current horizontal and vertical size classes. Compact width retains the five tabs; regular width exposes those same sections in a sibling sidebar beside the tab host. A detail control can hide or restore the sidebar even when a section hides its navigation bar. Each section retains its own destination back navigation. The tab host and section navigation stacks keep their structural identity across trait changes; the tab controller is never nested in a collapsing split-view detail column. The same selection drives both navigation controls. Editors load their initial values once so a presentation adaptation cannot overwrite an unsaved draft.

Regular content is centered with a 760-point maximum, including the weight graph; chart labels keep normal font sizes and a small automatic tick count. The graph grows in regular height and shrinks in compact height. All orientations are supported. Forms and scroll views retain keyboard avoidance; the disclaimer and tip thank-you also scroll in short windows. Sheets use system form/page sizing on iOS 18+, with an iOS 17 fallback, and full-screen adaptation in compact height.

Medication chart selections survive folding. Explicitly switching away from Home and returning restores the live estimate, preserving the existing tab-navigation behavior without using appearance callbacks as a resize signal.

RDesign surfaces use [ConcentricRectangle](https://developer.apple.com/documentation/swiftui/concentricrectangle) on iOS/macOS 26+, retaining the existing minimum corner radius and exposing the container shape to nested cards. Earlier systems retain rounded rectangles.

The source audit found no device-idiom checks, orientation-based layout decisions, specific-screen-size comparisons or `UIScreen.main` calls. Remaining fixed widths are glyphs, touch targets, a compact vial illustration and a bounded information popover. There is no full-bleed photo/video/hero content; the shared app mark already uses aspect fit. `XCUIScreen.main` and `XCUIDevice` in UI tests capture and rotate the simulator; they do not choose app layouts.

## Capture

From the repository root:

```sh
DEVELOPER_DIR=/Applications/Xcode_27.1.app/Contents/Developer \
  scripts/capture-duo-screenshots.sh tendr build/duo-screenshots/tendr/raw light dark
python3 scripts/test-duo-screenshots.py
```

The script defaults to `build/duo-screenshots/tendr/raw`, both appearances, the newest available iOS runtime, and an installed device type whose name contains `iPhone Duo`. `R_SIM_DEVICE_TYPE` and `R_SIM_RUNTIME` override those choices. Missing Duo device types fail clearly. Other apps must configure a compatible `duo_screenshot_test` in `app.yml` before using this script.

The helper probes the installed `simctl` help and display enumeration. Advertised fold/display state commands are tried on the disposable simulator. If both states succeed, the UI tests visit inner and outer and check a live fold without relaunching. If only explicit inner/outer display IDs are exposed, a host/test handshake captures both with `simctl io screenshot --display`. Unknown interfaces fall back to the device's default screen and explicitly skip live-fold checks. No display is inferred from its pixel dimensions.

Raw files are named `inner-light-home.png`, `outer-dark-progress.png`, etc. Fallback files are named `default-light-home.png`, etc.; they are never relabelled inner/outer. Each run clears previous captures with those names and its metadata, preserving unrelated files in the output folder. `capture-notes.txt`, `plan.json` and `simctl-capabilities.txt` record the supported interface and limitations. The capture helper synchronizes with each test screen, so both physical displays are captured before navigation proceeds. PNG presence and headers are checked; there is no 1320×2868 requirement or framing step. Named displays can be inactive in a particular pose: inspect the raw images on the installed runtime before using them externally.

The **Duo screenshots** workflow runs on GitHub-hosted `xcode-27` with Xcode 27.1 and the iOS 27.1 Duo runtime. Manual dispatch accepts `app` (default `tendr`) and `developer_dir` (default `/Applications/Xcode_27.1.app/Contents/Developer`). If that path is unavailable, it tries the hosted underscore spelling before the legacy `/Applications/Xcode-27.1.app`, then the newest usable `/Applications/Xcode*.app` by version. It ignores repository runner/toolchain variables. Duo UI tests are not passing yet (APP-36), so capture failures remain non-blocking on PRs; manual dispatch failures still fail the job. The workflow lists device types/runtimes and fails clearly if its selected Xcode has no iPhone Duo device type. It uploads `duo-screenshots-<app>` and does not publish anything. For optional local capture, install a compatible runtime and use `R_SIM_RUNTIME` to override the iOS 27.1 default if needed. The root `scripts/setup-mac-runner.sh` is optional legacy setup, not required by CI.

## Native verification still required

- Run the existing `StillUITests` and `DuoScreenshotTests` on the Xcode 27.1 Duo simulator and the compact iPhone simulator. Compare compact captures with the existing screenshot baseline, including tab/navigation bars and safe areas.
- Check all five sections in light/dark on inner/outer displays. Inspect each raw capture for correct display content, readable axes, corner alignment and fully visible controls.
- Hide and restore the sidebar, then open Medication details, switch sections, fold/unfold repeatedly, and return. The destination and section selection must remain. Change the Journal filter and Progress range; verify both survive the same cycle. Automated tests require sidebar navigation on inner, tabs on outer and an actual window resize with the draft open; a successful host command alone is insufficient.
- Open dose, weight, goal, vial and schedule editors. Change values and notes, show the keyboard, fold/unfold and rotate in both directions. Drafts, focus, cancellation and Save must remain usable. Automated live-fold checks cover the dose draft and navigation when the installed CLI supports folding.
- Check compact-height inner/outer landscape and tent poses, including first-launch acknowledgement and the tip thank-you. Scroll to the last control and test with larger Dynamic Type.
- Resize continuously to extreme widths/heights with the resizable simulator or iPhone Mirroring. No device-specific assumptions should be needed. If CLI folding is unavailable, do the state-retention checks manually in Simulator; a successful fallback capture is not proof of fold behavior.

## Portable checks

`TendrLayoutTests` cover the trait matrix, nil-trait fallback, readable-width policy and compact-height chart sizing. Run `swift test --package-path apps/tendr` and `swift test --package-path packages/RDesign` wherever Swift is installed. The PR CI tooling job runs `scripts/test-duo-screenshots.py`: Xcode selection, capability parsing and the complete shell/helper handshake against mocked macOS tools, including both appearances, unsupported controls, paths with spaces, device overrides and stale-output cleanup after success or failure. Those mocks do not validate an actual Apple simulator interface.
