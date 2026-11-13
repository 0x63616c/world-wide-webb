# Native Apple application

`App/Platform/PanelApp.swift` is the production entry point. The shared SwiftUI clock, launcher and feature
views power three deliberate compositions: the landscape iPad Pro and the closed/open iPhone Duo.
`Packages/PanelKit` owns the typed REST
client and shared wire models; platform adapters provide camera, calendar, notifications and alarms.

Generate the ignored Xcode project with `xcodegen generate --spec apple/project.yml --project apple`.
Run `bash tools/check apple` for package tests and `bash tools/test_apple.sh` for production iPad build/unit tests.
For the three canvas dimensions and launcher geometry alone, run `bash tools/test_canvas_layout.sh`.
It compiles the production policy directly on the Mac without starting a simulator.
Use the existing UI tests for launch, slide-up and retained-feature evidence. `project.yml` is the target source
of truth. Existing app and alarm-widget bundle identifiers remain unchanged.

The app automatically connects to `https://homelab.tail8c014d.ts.net` over private Tailscale HTTPS.
All Tailnet devices are trusted; no app login or pasted connection record is required. Connection settings
can check reachability. DEBUG fixtures stay isolated from production integrations. No runtime credentials
are bundled. Historical design studies are reference material, not alternate app targets.

## Diagnostics

Settings → Diagnostics shows the installation ID, editable device label, connection/feature status,
the latest 500 control actions and 500 client events. Share diagnostics exports that local history
and status as a JSON file through the iOS share sheet.
Events contain fixed action names, outcomes, HTTP status and duration, including touch taps and app
open/close transitions; touch coordinates, request URLs, response bodies, headers, credentials and
user content are excluded. The client keeps the latest 500 events locally
and uploads batches while the app is active, with build and Git revision metadata. Uploads are idempotent,
and the server retains up to 2 MB of events per installation in SQLite. `GET /api/v1/diagnostics/events` returns the newest 500
events, optionally filtered with `?deviceId=<installation UUID>`; the full retained history is
available in the `diagnostic_event` table. Slow requests and main-thread scheduling delays appear
in the event timeline.
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

## Supported canvases

`PanelCanvas` owns three fixed compositions, measured in points: iPad Pro landscape
1366×1024, iPhone Duo closed 466×678, and Duo open 951×669. The iPad uses the household panel dimensions; the Duo sizes are the Xcode 27.2 simulator's
1398×2034 outer and 2853×2007 landscape inner displays at 3× scale (`simctl io <udid> enumerate`).
The closed composition is portrait; the open composition is landscape. Keep landscape
orientations declared for iPhone so the system can fill the inner display.

Display dimensions select a canvas independently of rotation; they never continuously
size the canvas or its type. The attached scene requests landscape for iPad/open Duo
and portrait for closed Duo. The canvas ignores keyboard resizing; foreground safe
areas can still reserve space for text entry.
Other window sizes are outside the supported design scope and show the nearest
composition centred and clipped, without stretching it. Each clock, launcher and
app surface is framed before its transition, including native app zoom and clock swipes. The clock no longer expands
its own safe area while moving. One view subtree keeps the selected app and local
state intact when the Duo switches displays.

The iPad canvas fills the physical display, including the former 20-point bottom
safe-area strip. On Duo the surface also fills the display; foreground app controls
and launcher content respect the actual system camera and gesture insets, read
outside the full-bleed canvas. Launcher columns are 5/3/5 for iPad/closed/open.
Weather uses 12/3/6 hourly columns and allows scrolling on both Duo displays;
closed Duo Wi-Fi stacks its network information above the QR code.
