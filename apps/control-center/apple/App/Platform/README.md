# Native application wiring

`PanelApp.swift` owns the shared iPad/iPhone scene, live providers, alarms, notifications and deep links.
The clock and slide-up launcher lead into native feature screens. `PanelAppCatalog` owns launcher order;
`PanelHome` adapts live providers to shared views. Preserve the existing iPad design across phone sizes.

The client connects to private Tailscale HTTPS without login or Cloudflare credentials. Connection settings
check reachability; devices need Tailscale enabled. `PanelKit` owns typed transport and wire contracts.
AlarmKit schedules system alarms, with the next alarm mirrored into the widget through `PanelAlarms`.

Build configuration lives in `apple/project.yml`; see `apple/README.md` and root `tools/check` for checks.
Mac Catalyst and running the iOS app on Mac or Vision Pro are disabled. macOS remains a developer/test host
and the backend host. Historical device labels remain decodable for existing records.
