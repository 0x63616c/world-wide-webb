# World Wide Webb

Native SwiftUI home control for iPad, iPhone/Duo and Mac, with a Rust backend, SQLite and OpenTofu.
The shared clock-first interface retains the iPad app's components and slide-up launcher.

Start with [CODEBASE_OVERVIEW.md](CODEBASE_OVERVIEW.md) for source locations and
[AGENTS.md](AGENTS.md) for workflow rules. Migration status is recorded in
[the progress tracker](docs/plans/native-rust-progress.md); production is unchanged until final cutover.

Install the pinned Rust toolchain, OpenTofu, Xcode 26.4 or newer, XcodeGen and standalone Lefthook.
`bash tools/setup` fetches Rust dependencies. `bash tools/check` runs maintained-stack checks;
`bash tools/test_apple.sh` builds and tests the production iPad app.

Build the service with `cargo build --locked -p www-server`. For local experiments, use an isolated data
directory and private `WWW_API_TOKEN_FILE`; set `WORKER_CYCLES=off` to avoid physical-device actions.
The app's connection settings accept a privately provisioned enrollment record, verified before saving in Keychain.
No production credentials are bundled with the app.

Deployment, backup and migration instructions are in
[the cutover runbook](docs/runbooks/native-rust-cutover.md). User data, media and encrypted infrastructure
state live outside Git and outside container images. Git retains the removed web/Expo/TypeScript/Pulumi history.
