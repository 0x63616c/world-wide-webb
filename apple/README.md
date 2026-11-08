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
