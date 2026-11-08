# Codebase overview

World Wide Webb is a native SwiftUI home-control app, backed by one Rust service and SQLite.
The iPad design is the shared starting point for iPhone/Duo. The clock and slide-up
launcher lead into Calendar, Weather, Lights, Climate, Walks, Tesla, Wi-Fi, Sonos, Timer, Photo Booth and Settings.
Calendar, camera capture, notifications and system alarms use Apple frameworks where appropriate.

## Code map

- `apple/App/Platform/PanelApp.swift`: production entry point, sessions and native feature wiring.
- `apple/App/Apps`: launcher, app catalog UI, clock presentation, timer and connection settings.
- `apple/App/Live`: shared feature providers; `Platform` connects native capabilities and live transport.
- `apple/Packages/PanelKit`: typed versioned REST transport, models, synchronization and package tests.
- `apple/Extensions`: alarm widget and retained walk activity source. `apple/project.yml` defines build targets.
- `apple/Tests`: production unit/UI tests. `apple/Resources`: actual shared asset catalogs.
- `server/src/features`: retained domain behavior and explicit SQL. `integrations`: Home Assistant transport.
- `server/src/runtime.rs`: supervised scheduled work. `server/migrations`: ordered SQLite schema.
- `server/tests`: real HTTP, persistence, integration and concurrent-behavior tests.
- `deploy/mini`: Rust Compose, immutable release/recovery, consistent snapshots and NAS verification.
- `infra/cloudflare`: pinned OpenTofu HCL, encrypted state/plan configuration and mocked route tests.
- `tools`: checks, migration/reconciliation, isolated Swift-to-Rust proof, runtime provisioning and CI policy.
- `.github/workflows`: selected required CI, tested image deployment, Cloudflare apply and signed TestFlight delivery.

The web app, Expo shell, Bun/TypeScript backend, JavaScript workspaces and Pulumi implementation are removed.
Their history remains in Git. Historical recovery material is marked as such; archived screenshots/design reviews are removed; current instructions are
`AGENTS.md`, this map, the migration progress tracker and `docs/runbooks/native-rust-cutover.md`.

## Runtime and boundaries

Swift calls `/api/v1` over private Tailscale HTTPS at `https://homelab.tail8c014d.ts.net`.
All Tailnet devices are trusted; the app has no login, credential entry or Cloudflare service-token headers.
The existing typed Swift client is maintained directly; real cross-language tests verify it.
Rust owns database writes and one set of interval workers; Home Assistant remains the physical-device adapter.
SQLite and Photo Booth media persist outside the image. No running PostgreSQL dependency remains for this app
after cutover; unrelated Hindsight/Bambuddy/HA services and their backups are independent.

The mini hosts OrbStack and the app on loopback port 4202, published privately by Tailscale Serve on HTTPS443. The shared Cloudflare tunnel serves only independent
HA/Hindsight/Bambuddy/DSM routes after cutover; public app/API DNS, Access and ingress are retired.
OpenTofu state is encrypted and locked on the mini outside app storage; tested-main automation runs there over SSH.
Migration and actual deployment status must be read from `docs/plans/native-rust-progress.md`: code presence is not
proof that production has cut over.

## Checks

Run `bash tools/setup`, `lefthook install`, then the applicable `bash tools/check <area>` commands.
`bash tools/test_apple.sh` builds the shared iOS target, runs iPad native unit tests and checks iPhone platform/layout policy. XcodeGen creates the
ignored project from `apple/project.yml`. Required CI aggregates selected Apple/image/infra jobs fail-closed.
