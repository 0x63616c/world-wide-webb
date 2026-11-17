# Adaptive windows and Duo validation

Native compilation, live resizing and actual Duo captures still require macOS/Xcode; Linux checks do not establish simulator correctness or App Store readiness.

## Layout

Tendr uses one system `TabView` and retains each section's `NavigationStack` during resize. Like `0x63616c/folding`'s `FoldingRootView`, iOS 18+ uses `.tabBarOnly`; iOS 26+ also sets `.tabBarMinimizeBehavior(.never)`. Duo uses its native trailing vertical rail, while older phones keep standard tabs. Section roots draw their existing PageHeader without an empty system navigation bar; pushed details explicitly show their navigation bar and Back action. There is no custom sidebar or forced leading sidebar placement. Editors load their initial values once so a presentation adaptation cannot overwrite an unsaved draft.

This follows Apple's [Preparing your app for iPhone Duo](https://developer.apple.com/documentation/technologyoverviews/preparing-your-app-for-iphone-duo) and [Prepare your app for iPhone Duo](https://developer.apple.com/videos/play/tech-talks/111461/) guidance: standard navigation containers, window-relative layouts, size classes rather than device/orientation checks, asymmetric safe areas, and testing open, closed, partially folded and Split View configurations. `TendrLayout` controls readable content width and graph height, not the system's navigation placement.

Regular content is centered with a 760-point maximum, including the weight graph; chart labels keep normal font sizes and a small automatic tick count. The graph grows in regular height and shrinks in compact height. All orientations are supported. Forms and scroll views retain keyboard avoidance; the disclaimer and tip thank-you also scroll in short windows. Sheets use system form/page sizing on iOS 18+, with an iOS 17 fallback, and full-screen adaptation in compact height.

Medication chart selections survive folding. Explicitly switching away from Home and returning restores the live estimate, preserving the existing tab-navigation behavior without using appearance callbacks as a resize signal.

Card surfaces (`Still/Design/Layout.swift`) use [ConcentricRectangle](https://developer.apple.com/documentation/swiftui/concentricrectangle) on iOS/macOS 26+, retaining the existing minimum corner radius and exposing the container shape to nested cards. Earlier systems retain rounded rectangles.

The source audit found no device-idiom checks, orientation-based layout decisions, specific-screen-size comparisons or `UIScreen.main` calls. Remaining fixed widths are glyphs, touch targets, a compact vial illustration and a bounded information popover. There is no full-bleed photo/video/hero content; the shared app mark already uses aspect fit. UI test attachments capture every active `XCUIScreen` rather than assuming `.main` is the active display or cropping a rotated app window; `XCUIDevice` controls test rotation, not app layout.

## Review improvements

- Native tab-only placement matches Folding, with a trailing rail on Duo and a stable tab host across window changes.
- Editors use system confirmation and cancellation toolbar placements with titles and symbols. Dose and weight saves no longer depend on a full-width bottom strip or scrolling to the end of a form, leaving more space for content and the keyboard in short windows.
- Expanded medication graphs shrink in compact height, as weight graphs already did. Home and Progress summaries and the Treatment schedule summary stack at accessibility text sizes; weekday markers can grow vertically.
- Duo UI tests assert all five destinations, section changes, compact-height editor actions and accessibility text on the simulator's active display; live-fold retention is a manual check. Navigation queries accept the system's vertical tabs rather than assuming a horizontal `tabBars` container. PR previews include both editors with the keyboard visible.

Build distribution artifacts with Xcode 27.1+ for Duo's complete screen and vertical-bar behavior. Earlier systems keep their supported tab behavior; that fallback is not evidence of native Duo support.

## Capture

`bundle exec fastlane ios screenshots app:tendr` (fastlane snapshot) captures the App Store
images; the manual **Screenshots** workflow runs the same lane on the hosted `xcode-27` runner and
uploads artifacts for review without contacting Apple. A freshly created iPhone Duo simulator
shows its outer display (1398×2034), so the Duo gallery uses outer-display captures only.
No supported simulator, XCTest or fastlane interface folds the Duo, and the release pipeline does
not drive Device Hub. `screenshots.json` `duo_shots` chooses the screen/appearance pairs.

`DuoLayoutTests` check tab labels and accessibility sizes on whichever display the simulator
shows, and compact-height editors on single-screen phones (XCTest rotation does not resize a Duo
window). Inner-display, rotation and live-fold behaviour on Duo are the manual checks below.

## Native verification still required

- Background and reactivate the app on each display. XCTest hardware Home targets the primary display, so check the inner-display lifecycle by hand in Simulator.
- Run the existing `StillUITests` and `DuoLayoutTests` on the Xcode 27.1 Duo simulator and the compact iPhone simulator. Compare compact captures with the existing screenshot baseline, including tab/navigation bars and safe areas.
- Check all five sections in light/dark on inner/outer displays. Inspect each raw capture for correct display content, readable axes, corner alignment and fully visible controls.
- Verify the trailing vertical rail, then open Medication details, switch sections, fold/unfold repeatedly, and return. The destination and section selection must remain. Change the Journal filter and Progress range; verify both survive the same cycle.
- Open dose, weight, goal and schedule editors. Change values and notes, show the keyboard, fold/unfold and rotate in both directions. Drafts, focus, cancellation and Save must remain usable.
- Check compact-height inner/outer landscape and tent poses, including first-launch acknowledgement and the tip thank-you. Scroll to the last control and test with larger Dynamic Type.
- Resize continuously to extreme widths/heights with the resizable simulator or iPhone Mirroring. No device-specific assumptions should be needed. If CLI folding is unavailable, do the state-retention checks manually in Simulator; a successful fallback capture is not proof of fold behavior.

## Portable checks

`TendrLayoutTests` cover the trait matrix, nil-trait fallback, readable-width policy and compact-height chart sizing. Run `swift test --package-path projects/tendr` wherever Swift is installed.
