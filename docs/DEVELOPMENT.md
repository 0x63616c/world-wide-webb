# Development and delivery

Products own their behavior and appearance. Shared tooling owns repository discovery,
checks, release processes and infrastructure boundaries. Tendr keeps RDesign; Folding,
Callkeep, Air Miles and Control Center keep their own components and packages.

## Working lifecycle

1. Capture the app idea or concrete bug briefly; use an issue/spec when the scope earns it.
2. Create a task worktree and read the product instructions. Preserve other active work.
3. Implement a useful coherent batch. Reuse an existing handler before adding orchestration.
4. Run relevant checks and inspect the real outcome. Fix independent final-review findings.
5. Publish the reviewed candidate, pass required checks and merge. Verify the affected release,
   live service or user journey. Record deferrals and keep incomplete acceptance open.

During the consolidation, the complete migration candidate stays local until final review.
The migration tracker distinguishes source preparation from live ownership and delivery.
Agents perform routine setup, fixes, checks, publication and verification within the authorized
scope. Owner involvement is reserved for unavoidable account/2FA/legal/hardware facts or purchases.
Prepare those concrete decisions together; a small code change needs no ticket ceremony.

## Local entrypoint

`scripts/dev apps` lists products, `scripts/dev new <Name> <bundle-suffix>` creates a standalone
app, and `scripts/dev check <folder>` runs its existing checks. Standard iOS products run their
core package tests when declared and an unsigned simulator build. Folding, Callkeep and Control
Center keep their product-owned handlers. These commands neither publish nor activate hosts.
`scripts/dev affected <base>` resolves committed app changes; `scripts/ci/select.py` provides the
full multi-area selection. Activate a Python environment containing `scripts/requirements.txt`
for affected selection; `scripts/dev doctor` reports a missing PyYAML installation.
`scripts/dev doctor` checks shared tool availability; exact product pins,
Apple runtime availability and credentials remain the relevant workflow's responsibility.

## Tool choices

- Native SwiftUI and platform frameworks, SwiftPM and XcodeGen. Keep each app's OS floor and
  architecture. Use built-in Swift Testing for useful new domain tests; retain existing XCTest,
  hosted/UI/performance tests. No mass framework conversion or shared UI library is required.
- Toolchain `swift-format` for Swift. Introduce additional lint rules only for a demonstrated
  benefit. Preserve pinned FluidAudio/WhisperKit and other actual product dependencies.
- Fastlane with locked Bundler dependencies for Apple delivery. Product handlers keep their
  tested Ruby/Bundler pins; the initial common Fastlane version is 2.241.2. Update pins with
  real toolchain/release validation rather than silently following an image's system tools.
- Rust workspaces keep their own lock/toolchain and fmt/clippy/tests; dependency policy follows
  the product. Bun is the JavaScript installation/tooling default with frozen locks. Preserve
  Node for tools and suites that require it.
- Python environments and pinned requirements, ShellCheck and actionlint. Explicit Linux/Mac
  homelab labels select disposable guests. Runtime/client setup is part of the job contract;
  a guest is not assumed to contain the hosted runner's tool inventory.
- OpenTofu owns durable Cloudflare resources; Wrangler owns Worker code/assets and explicit D1
  operations. Keep one owner for each resource/property. SOPS/age and 1Password retain their roles.

Use initializer/closure injection for deterministic clock, UUID and service tests. Add
swift-dependencies only if actual injection pain warrants it. Existing fixture/gallery renderers
come first; SnapshotTesting is an optional focused pilot with explicit stable baselines, not a
mandatory package. Keep UI image tests on Apple runtimes and review changed baselines.

## Check the behavior that matters

Choose tests by the risk and changed boundary. Domain tests cover deterministic rules and
migration edges; integration tests exercise real serialization/storage/service boundaries.
Use a small primary-journey UI smoke test and product-owned synthetic render scenes. Static
screens should render directly in hosted XCTest when possible; interaction tests prove behavior.

Prioritize offline/empty/error states, background behavior, persistence/recovery, accessibility,
Dynamic Type/VoiceOver/Reduce Motion and measured startup/memory/battery. Preserve sanitized
OSLog/MetricKit/crash/dSYM evidence where appropriate. Passing mocks, a capture archive or an
upload does not prove device behavior, a processed build or a working store release.

## Selection and publication

`scripts/ci/units.json` selects verification separately from delivery candidates. App, backend,
site, infrastructure and host inputs have separate owners. Tests/docs verify as appropriate and
cannot upload other products or activate hosts. Shared/unknown inputs trigger conservative
verification without authorizing publication. Forced checks are verification-only.

The standard iOS resolver also discovers independent `standard_ios` app manifests. Product
workflows retain their existing handlers for Folding, Callkeep and Control Center. Always-reporting
gates fail selected failed/cancelled/skipped jobs; review and successful checks remain part of the publication process. The owner chose
automation gates without GitHub branch protections or a Pro upgrade. Publication uses trusted exact-source evidence and immutable artifacts.

Cloudflare Workers/static assets, D1 and R2 are the default for a new hosted backend when needed.
Offline apps get no backend by default. Folding's working Rust Worker and Control Center's
home-local Rust/SQLite service remain intact. Keep staging/production, health/version, migrations,
rate/cost controls and recovery explicit. Operator Access is not application-user authentication.
