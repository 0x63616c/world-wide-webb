# Native Apple application

`App/Platform/PanelApp.swift` is the production entry point. The shared SwiftUI clock, launcher and feature
views power the iPad app and adapt for iPhone/Duo. `Packages/PanelKit` owns the typed REST
client and shared wire models; platform adapters provide camera, calendar, notifications and alarms.

Generate the ignored Xcode project with `xcodegen generate --spec apple/project.yml --project apple`.
Run `bash tools/check apple` for package tests and `bash tools/test_apple.sh` for production iPad build/unit tests.
Use the existing UI tests for launch, slide-up and retained-feature evidence. `project.yml` is the target source
of truth. Existing app and alarm-widget bundle identifiers remain unchanged.

The app automatically connects to `https://homelab.tail8c014d.ts.net` over private Tailscale HTTPS.
All Tailnet devices are trusted; no app login or pasted connection record is required. Connection settings
can check reachability. DEBUG fixtures stay isolated from production integrations. No runtime credentials
are bundled. Historical design studies are reference material, not alternate app targets.
Signing/TestFlight automation uses `fastlane/Fastfile` and publishes release metadata only after Apple processing.

## App navigation

App icons use the native matched-source zoom transition: opening expands from the
icon into its full-screen app, and closing returns to that icon. The launcher
keeps its scroll position. Clock-face swipes retain their separate spring motion.

## Interaction polish — 8 November 2026

Lights brightness and white temperature share the Sonos filled bar, including
its right-aligned percentage or Kelvin readout. Drags preview locally and send one
command on release. Released values stay visible during the handoff to provider
state. Sonos also retains acknowledged volume targets through stale Home Assistant
samples until observed (or a five-second reconciliation window expires). Failed
commands revert and report the existing availability error; external volume changes
resume after confirmation.

Timer digits roll down with a short spring on each second and remain still with
Reduce Motion. Selecting zero hours, zero minutes and zero seconds returns the
minute wheel to one after its selection callback settles; Done always uses at least
one minute for an all-zero selection.

Notifications use one shared iOS-style card: app icon left, one title line, up to
two body lines, and a compact age such as “1m ago” at the top right. Accessibility
text sizes can expand the text. Swipe right to hide a banner; this retains history.
The history button and per-card close buttons are removed. Pull down from the top
right (the last 180 points of the top 24-point strip) to open the flat history list.
Swipe a history row left to clear it, or use Clear All in history. VoiceOver can
activate the edge and dismiss banners through named actions.

One root presentation layer stays above every app. Opening an app hides its current banners and suppresses new banners and arrival
feedback from that app, including backend source aliases. Notifications remain in
history and do not replay when the app closes. Other apps' notifications still show.
