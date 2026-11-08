# World Wide Webb

Native SwiftUI home control for iPad, iPhone/Duo and Mac, with a Rust backend, SQLite and OpenTofu.
The shared clock-first interface retains the iPad app's components and slide-up launcher.

Start with [CODEBASE_OVERVIEW.md](CODEBASE_OVERVIEW.md) for source locations and
[AGENTS.md](AGENTS.md) for workflow rules. Migration status is recorded in
[the progress tracker](docs/plans/native-rust-progress.md) and [delivery issue #941](https://github.com/0x63616c/world-wide-webb/issues/941).

Install the pinned Rust toolchain, OpenTofu, Xcode 26.4 or newer, XcodeGen and standalone Lefthook.
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
