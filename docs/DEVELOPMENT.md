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

Keep each complete candidate local until reviewed, then publish, pass required checks and merge.
Delegated reviews require an explicit owner request. The migration tracker records live ownership
and delivery separately from source consolidation.
Agents perform routine setup, fixes, checks, publication and verification within the authorized
scope. Owner involvement is reserved for unavoidable account/2FA/legal/hardware facts or purchases.
Prepare those concrete decisions together; a small code change needs no ticket ceremony.

## Local entrypoint

`scripts/dev apps` lists products, `scripts/dev new <Name> <bundle-suffix>` creates a standalone
app, and `scripts/dev check <folder>` runs its existing checks. Standard iOS products run their
core package tests when declared and an unsigned simulator build. Folding, Callkeep and Control
Center keep their product-owned handlers. These commands neither publish nor activate hosts.
`scripts/dev affected <base>` resolves committed app changes; `scripts/ci/select_units.py` provides the
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
- Python environments and pinned requirements, ShellCheck and actionlint. Use explicit hosted
  or homelab labels and product pins. GitHub’s `xcode-27` image includes Xcode 27.2 and Duo;
  Apple jobs pinned to that toolchain use `runs-on: xcode-27`. Runtime/client setup is part of
  the job contract; do not assume an image’s default tool versions match the product pins.
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

The same manifest also names individual checks and workflow consumers. Homelab Python tests,
Linux controller tests and Darwin configuration builds select independently. Control Center
separates Rust, operations, wire-contract and full simulator verification. Selection artifacts
include the input reasons; an unknown workflow/action remains a conservative full verification.
Operations-only Control Center changes share the lint job instead of allocating a Rust test job.
Optional UI captures use preview inputs rather than conservative verification fan-out, so selector
or unrelated infrastructure changes do not allocate screenshot/snapshot jobs.

Compiler snapshots use source-specific keys with toolchain/lockfile-compatible restore prefixes.
Docker's Cargo mount is transferred explicitly between disposable builders. Nix verification can
restore signed output closures from the private repository cache; export is limited to 2 GiB and
120 seconds, with a separate two-minute cache upload limit. Only protected-main pushes and explicit
manual runs receive the signing key. Cache errors remain visible and fall back to required builds;
production Nix trust and host activation ownership are unchanged. The shared `homelab/process`
crate lets host operations depend on process supervision without compiling interactive CLI code.

For comparable measurements, dispatch **Homelab CI** on the candidate with `benchmark=backup-test`
or `benchmark=service` and a full `baseline` SHA. Two fresh Mac jobs replay each source's selector
and real handlers, then repeat on the same runner for a local-warm measurement. Artifacts contain
per-check execution seconds. This is a same-path handler replay, not full distributed CI latency;
use Actions job timestamps for queue, setup, cache download/upload and actual critical-path time.
Benchmark evidence cannot authorize host promotion. Normal dispatch (`benchmark=none`) retains
full verification and can exercise signed cross-run output reuse after review.

The standard iOS resolver also discovers independent `standard_ios` app manifests. Product
workflows retain their existing handlers for Folding, Callkeep and Control Center. Always-reporting
gates fail selected failed/cancelled/skipped jobs; review and successful checks remain part of the publication process. The owner chose
automation gates without GitHub branch protections or a Pro upgrade. Publication uses trusted exact-source evidence and immutable artifacts.

Cloudflare Workers/static assets, D1 and R2 are the default for a new hosted backend when needed.
Offline apps get no backend by default. Folding's working Rust Worker and Control Center's
home-local Rust/SQLite service remain intact. Keep staging/production, health/version, migrations,
rate/cost controls and recovery explicit. Operator Access is not application-user authentication.
