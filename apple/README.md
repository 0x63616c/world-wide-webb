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
Signing/TestFlight automation uses `fastlane/Fastfile` and publishes release metadata only after Apple processing.

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
app surface is framed before swipe/pop transforms. The clock no longer expands
its own safe area while moving. One view subtree keeps the selected app and local
state intact when the Duo switches displays.

The iPad canvas fills the physical display, including the former 20-point bottom
safe-area strip. On Duo the surface also fills the display; foreground app controls
and launcher content respect the actual system camera and gesture insets, read
outside the full-bleed canvas. Launcher columns are 5/3/5 for iPad/closed/open.
Weather uses 12/3/6 hourly columns and allows scrolling on both Duo displays;
closed Duo Wi-Fi stacks its network information above the QR code.

