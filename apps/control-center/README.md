# World Wide Webb

Native SwiftUI home control for iPad and iPhone/Duo, with a Rust backend, SQLite and OpenTofu.
The shared clock-first interface retains the iPad app's components and slide-up launcher.

Start with [CODEBASE_OVERVIEW.md](CODEBASE_OVERVIEW.md) for source locations and
[AGENTS.md](AGENTS.md) for workflow rules. Migration status is recorded in
[the progress tracker](docs/plans/native-rust-progress.md) and [delivery issue #941](https://github.com/0x63616c/world-wide-webb/issues/941).

Install the pinned Rust toolchain, OpenTofu, Xcode 27.2, XcodeGen and standalone Lefthook.
`bash tools/setup` fetches Rust dependencies. `bash tools/check dependencies` downloads the checksum-verified,
pinned cargo-deny binary on first use and checks advisories, licenses and sources. `bash tools/check` runs maintained-stack checks;
`bash tools/test_apple.sh` builds and tests the production iPad app.

Build the service with `cargo build --locked -p www-server`. For local experiments, use an isolated data
directory; set `WORKER_CYCLES=off` to avoid physical-device actions.
The app connects automatically over private Tailscale HTTPS. Devices must be connected to the Tailnet;
no app login or credentials are required. The server container is published on loopback only.

Deployment, backup and migration instructions are in
[the cutover runbook](docs/runbooks/native-rust-cutover.md). User data, media and encrypted infrastructure
state live outside Git and outside container images. Git retains the removed web/Expo/TypeScript/Pulumi history.

The canvas follows the live navigation-content bounds as the window resizes. Backgrounds
extend to the display edges; controls retain directional safe-area insets. Presentation
density and grid columns follow available width, and system concentric shapes follow
the actual display corners. Layout never forces an orientation or a physical screen size.

The launcher adds columns as space permits, and its profile control
uses the active camera reservation. Climate artwork fills the window while controls respect
safe areas; its mode/fan menu scrolls in short windows. App navigation uses the native zoom
transition with the icon's rounded source shape for both opening and closing.

Profiles are stored on the panel server and appear on each connected device when the launcher opens.
Tap a profile to switch; hold it to edit. The selected profile is a device preference.
Adding, editing and deleting a profile require the panel PIN;
deleting removes it for every device. Existing device-local profiles are not imported.

For the green clock/launcher rendering regression, capture the selected native display with
`xcrun simctl io <device> screenshot --display=<id> /tmp/canvas.png`, then run
`bash tools/test_canvas_layout.sh /tmp/canvas.png`. It rejects the shifted right/bottom
black strips independently of the app's reported frame. Keep captures outside Git.
