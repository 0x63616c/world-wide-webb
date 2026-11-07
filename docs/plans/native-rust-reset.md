# Native Swift, Rust, SQLite and OpenTofu reset

Status: draft for independent agent review and Calum's approval. Written 2026-11-07.
Source baseline: `7841e2732c73b99f99344142eedccf15e75aa53e` plus read-only production measurements.
This document authorizes no cutover by itself. The planning task includes backup and measurement;
implementation and GitHub project/issues follow review and approval.

## 1. Agreed outcome and priorities

- One household; shared SwiftUI clock-first experience on iPad, iPhone (including Duo), and Mac.
- Preserve the current native visual design, clock and slide-up interaction. Mac also opens on the clock.
- Share views, navigation, feature logic and networking; small platform adapters handle actual OS differences.
- Rust replaces Bun/TypeScript backend; SQLite replaces this application's PostgreSQL database.
- OpenTofu replaces Pulumi. Infrastructure remains declarative and deploys automatically.
- Keep Mac mini/OrbStack hosting, Home Assistant, Cloudflare remote access and Git history.
- Native backend hostname becomes `api.worldwidewebb.co`; retire `app.worldwidewebb.co` after cutover.
- Planned downtime is acceptable. Prefer one coordinated cutover over prolonged dual operation.
- Data, photos and other user files must not be lost. Removing a feature never authorizes deleting its data.
- Work in large coherent steps, aiming for one implementation PR. Commit coherent slices locally;
  commit frequency does not imply PR frequency. Do not create 30 PRs or a prolonged compatibility platform.
- Final cleanup is delivery work, not a future optional task. No new product features or visual redesign.

## 2. Product scope and ownership

Keep Calendar, Weather, Lights, Climate, Dog Walker, Tesla, Wi-Fi, Sonos, Timer,
Photo Booth, Settings, the clock, alarms, notifications, PIN behavior, native updates,
profiles and supporting behavior used by these features. Preserve existing IDs and device-local state.
Calendar remains device EventKit integration; timers and clock remain local where currently appropriate.
Backend owns shared persistent state. Native local preferences/caches must survive bundle/app migration.

Cut web dashboard/mobile web, Expo wrapper, cameras, reminders, old photo/wake-photo UI,
unfinished video player/catalogue, mock prototype entrypoints and their exclusive dependencies.
Keep all existing media and retired-feature database records in recoverable archival form.
Keep Photo Booth capture, gallery, upload and deletion behavior. A deletion requested through the app
is distinct from migration cleanup; do not infer permission to purge existing photos.

Discovery found a live bedroom-switch-input worker: preserve its existing operation and configuration.
Preserve desired/reported device reconciliation, party mode, alarm light effects, Sonos calibration,
walk persistence and notifications where required by retained features. Audit callers before removing
apparently hidden backend endpoints; launcher visibility alone is not a dependency graph.

Hindsight, Bambuddy, Bambu Studio, their databases, NAS and Home Assistant are separate systems.
Do not remove their PostgreSQL dependencies or change their data as part of this application's reset.
Retain their Cloudflare routes and backup support. Historical Talos disks remain untouched.

## 3. Target repository layout

```text
apple/
  App/                     shared clock, navigation, features and platform adapters
  Packages/PanelKit/       shared models, generated transport, caching and feature interfaces
  Extensions/              supported widgets/live activities, shared state ownership
  Tests/                   package, integration and UI tests
  Resources/
  project.yml              XcodeGen targets for iOS and macOS
server/
  Cargo.toml               one application crate with library + binary targets initially
  src/
    main.rs                configuration and lifecycle composition
    lib.rs
    http/                  routing, authentication, errors, contract export
    features/              lights, climate, weather, walks, booth, alarms, etc.
    integrations/          Home Assistant and external-provider adapters
    storage/               SQLite setup and shared transactional primitives
    runtime/               task supervision, shutdown, scheduling
  migrations/              ordered SQL migrations
  tests/                   HTTP, persistence, integration and migration tests
contracts/openapi.json     generated server contract; Swift generation consumes it
infra/cloudflare/          OpenTofu HCL and lockfile
deploy/mini/               Compose, release/recovery, host startup, backup
tools/                     checks, migration and measurement commands
docs/                      current overview, decisions, runbooks, review evidence
.github/workflows/
Cargo.toml                 workspace root; reserve crates for justified reusable boundaries
rust-toolchain.toml
lefthook.yml
```

Use feature modules with small public interfaces and private implementation. Avoid generic repository
traits, per-feature crates, a plugin registry or frontend manifests to register backend functionality.
Shared primitives earn their place by hiding complexity and enforcing invariants, not by call-site count.
Preserve existing Swift package APIs when useful; rename/move once, without parallel old/new hierarchies.
Generated files have one generator and a drift check. No generated source is manually maintained.

## 4. Rust design and dependency proposal

Use Axum/Tokio for HTTP and supervised async work, Serde for wire types, SQLx for explicit SQLite SQL,
Reqwest for HTTP integrations, tracing for structured/redacted logs, and typed errors (thiserror).
Use Utoipa with Axum to emit OpenAPI; Apple Swift OpenAPI Generator + URLSession consumes it.
Pin compatible versions and toolchain during implementation; do not copy speculative version numbers.
Prove authentication, one read, one mutation and streaming/reconnect with the Swift client early.
Keep an explicit streaming adapter if generated transport cannot express required SSE behavior cleanly.

- One process owns HTTP, SQLite and background tasks. No Redis, workflow engine or message broker.
- Concrete feature modules own behavior and queries. Request handlers validate, call them and map errors.
- New IDs use one prefix-based ID primitive. Existing IDs are copied verbatim; never remint on import.
- Explicit wire DTOs, enum values, units, timestamps and nullability. Stable errors and API versioning.
- HTTP retry only for safe operations. Mutations need deliberate idempotency; avoid replaying device commands.
- HA adapter owns WebSocket subscriptions, reconnect/backoff, discovery and HTTP interaction.
- Keep desired versus reported state, command ownership windows and manual-device override semantics.
- Bounded channels/concurrency, request deadlines and upload limits; no unbounded task spawning.
- Task supervision reports failures through health; cancellation and shutdown stop tasks before closing DB.
- Scheduled work has no overlap, explicit timezone/DST policy and restart recovery. Alarm occurrences
  have durable claim/delivery semantics so restarts or multiple devices do not ring twice.
- Traits/seams for real variations such as time and external I/O; use real SQLite for storage tests.
- Logs omit secrets, tokens, personal identifiers and payloads. Preserve rotated container logs and health
  endpoints; do not reintroduce Grafana/Prometheus/Loki or notifications merely for this rewrite.

SQLite: local persistent directory, explicit foreign keys/WAL/busy timeout, bounded pool and short writes.
Never await a remote device call inside a DB transaction. The server alone opens the shared database;
clients use the API. NAS is a backup target, never the live SQLite filesystem.
Use schema versioning with transactional migrations and fail startup on migration failure.
Only one app process can own writers/scheduled effects during deployment.

## 5. Swift adaptation and offline behavior

Use production Panel as the starting point, not the mock macOS prototype. Build one shared root shell;
enable iPhone device family, support available Duo configurations and width/window changes from geometry,
not model-name branches. Validate actual SDK/simulator capabilities; do not invent Duo APIs or dimensions.
Preserve design ratios, materials and motion while adapting spacing/columns; do not scale touch targets
or typography below accessibility requirements. Use the repo SwiftUI/HIG/glass skills during implementation.

Mac uses the same clock and feature navigation with click/keyboard access to the slide-up transition,
resizable window handling and platform capability adapters. Resolve EventKit/camera permissions,
AlarmKit/widget availability, background execution and brightness differences explicitly.
Unavailable OS capabilities get intentional behavior rather than pretending to work.
Keep one cross-platform feature model; conditional code is confined to adapters and app target setup.

Clock and local features keep working offline. Cached remote data carries freshness/unavailable state;
server-dependent actions fail clearly and are not silently queued. Do not fabricate live values.
Preserve iOS bundle identity, Keychain access groups, app groups, profiles, preferences and installed data.
Produce a real production macOS target; retain production iOS signing/distribution continuity.

## 6. Data preservation, import and recovery (hard gates)

Before destructive work, take and verify a fresh backup with the existing mini backup workflow.
Record snapshot ID, payload sizes, SHA-256 verification and service recovery without logging secrets.
NAS verification proves bytes transferred; additionally restore the app dump into an isolated PostgreSQL
instance and read the media archive to prove recoverability. Preserve original volumes and immutable images.

Inventory every source table, column, type, sequence, extension, constraint and media directory.
Produce an explicit disposition per table: active SQLite import, retained archival dataset, or documented
derived data. No source row is silently discarded. In particular preserve retired wake_photo records/files
even though the UI is cut. Keep the full original dump and original media outside Git independently of imports.

Build a repeatable one-off importer reading an isolated restored PostgreSQL snapshot into a new SQLite file.
Map UUID/text IDs, JSONB, booleans, numeric precision, timestamps/timezones, defaults and sequences explicitly.
Validate NULL vs absent vs empty, foreign keys, uniqueness, row counts and canonical per-table content hashes.
Copy media without renaming when possible; verify file count/bytes/hash manifest and DB-to-file references.
Report pre-existing missing/orphan media as exceptions; never silently drop rows to make checks pass.
Compare semantic values after canonicalization, not raw dump byte hashes across engines.

Rehearse against a backup while old production stays operational. Target writes/physical side effects must
be disabled in rehearsal. At cutover stop old writers and ingress/uploads, take a FINAL consistent backup,
rerun the importer from that frozen snapshot, validate, then start the new server. No dual writing.
The existing backup.py is suitable for today's precautionary backup, but NOT this final freeze:
its stopped() helper requires a running app and restarts it in finally. Implement/test a dedicated
cutover snapshot procedure that holds the deployment lock and keeps the old app stopped through
dump, media snapshot, import and acceptance. Disable scheduled backups/restarts for that window;
restore their intended state afterward. Do not reuse the automatic-restart helper for the final snapshot.
Keep PostgreSQL volume/dump and original media read-only or offline after cutover, outside cleanup scope.

Rollback before new writes: stop Rust, restore old routes/image and frozen PostgreSQL service.
Rollback after new writes: preserve the new SQLite/media snapshot first; do not blindly resume old data.
Choose forward repair or a tested delta export/reconciliation of new records before old service resumes.
No promise of lossless automatic rollback after writes without implementing that reconciliation.
Block reopening writes if validation fails. Downtime is acceptable; data loss is not.

Adapt nightly backup to SQLite consistent online-backup API or stopped-server snapshot, plus full media;
never copy only a live WAL-mode .db file. Keep NAS upload/read-back verification and restore tests.
Maintain unrelated service backups. Do not retain PostgreSQL as a running dependency merely for rollback.

## 7. Infrastructure and access

OpenTofu manages Cloudflare DNS, Access and shared tunnel ingress. Prefer adopting resources, but user
permits recreating stateless infrastructure when simpler and accepts downtime. Recreating the shared
tunnel affects HA/Hindsight/Bambuddy/NAS routes: inventory and reproduce all retained routes and credentials.
Do not delete Pulumi state first. Disable its writer, record resource IDs/config and keep an encrypted
state recovery export through supported tooling. Establish one owner, validate OpenTofu, then retire old state.
Never print/export plaintext state or credentials into chat, logs or Git.

Use encrypted remote state and a backend with verified locking. Select backend during the first work package:
prefer an existing suitable store; otherwise a small managed state service or S3 backend with locking.
Do not assume Cloudflare R2 supports every S3 locking feature. Verify locking/concurrency and recovery in a
small test before production adoption. Credentials stay in the existing secret system; no homemade store.
Backend bootstrap/recovery instructions must avoid depending on the app or the state it is meant to recover.

Pin provider/tool versions, commit provider lockfile, plan in CI and apply serially from tested main.
No applies from PRs or untrusted forks; no production secrets in fork runs. Sensitive plans are private
artifacts with short retention. Workflow concurrency supplements backend locking, never substitutes for it.

Bring up api.worldwidewebb.co, verify TLS, Access and authenticated native calls, then retire app hostname.
Current Hybrid/PanelConfiguration.swift reads a Cloudflare service-token pair and an alarm bearer token
from plist/defaults; apple-panel-testflight.yml injects them into the build. This is NOT an existing
interactive-login flow. Replace bundled credentials with a concrete native enrollment/auth design:
evaluate interactive Access login with Keychain-backed session versus privately provisioned per-device
credentials, including alarm/background and widget access. Choose/test the simplest workable approach
in package 1, before implementing dependent endpoints. No service credential may ship in a public app
artifact. Revoke/rotate old embedded credentials after clients switch, preserving rollback credentials
through a private provisioning procedure rather than retaining credentials in old distributed binaries.
Explicit acceptance includes unattended kiosk operation, enrollment/session renewal, App Intent/background
alarm calls, revocation and migration of existing Keychain entries. Remove build-time credential injection
only as the replacement is installed and usable; browser login alone is not proof of background access.
Implement server-side authorization/PIN enforcement explicitly;
test expired sessions, unauthorized reads/writes, SSE and uploads. This is an implementation prerequisite.
Preserve unrelated routes and external integrations; no blanket zone reset.

## 8. Tooling, linters and hooks

Retain Lefthook as a standalone binary; remove Bun-based installation only when old code is gone.
One documented `tools/check` entrypoint drives matching local/CI commands. Pin tools; no npm wrapper.

| Scope | Enforcement |
| --- | --- |
| Rust | rustfmt check, Clippy warnings as errors with selected compatible targets/features, compiler warnings, tests |
| Rust dependencies | committed Cargo.lock, locked builds, cargo-deny advisories/license/source policy |
| Swift | pinned swift-format check, Swift 6 strict concurrency/compiler diagnostics; focused SwiftLint only for rules not duplicated by formatter/compiler |
| Swift dead code | evaluate Periphery against all app/extension entrypoints; review findings before deletion, never blindly delete reflection/generated uses |
| Infrastructure | tofu fmt/check, init without backend for validation, validate, reviewed plan; test policy where concrete risks exist |
| Workflow/ops | actionlint, ShellCheck for shell, Python checks/tests for retained backup tools; do not rewrite proven ops scripts merely to eliminate Python |
| Repository | gitleaks, existing private-address/email and encrypted-secret guards, generated-contract drift, tracked-artifact checks |

Pre-commit is fast and scoped: formatting checks and staged secret/privacy guards. No silent restaging.
Pre-push runs relevant Rust/package checks and contract drift checks, with commands clearly shown.
Full Apple UI/build matrices run in CI, not on every commit. CI remains authoritative if hooks are bypassed.
Install hooks in wtp bootstrap using native tools; remove bun install and fix optional machine-file copying.
Keep worktree-only safeguards. Replace JS ID guard with a Rust primitive/policy and meaningful tests.
Remove obsolete Biome/Knip/TS alias/codegen checks only when their code has been removed.

## 9. CI and delivery design

One validation workflow uses path filters plus an ALWAYS-RUN aggregate required check that fails for failed,
cancelled or unexpectedly skipped relevant jobs. Test its path selection (Swift, Rust, contract, infra,
ops, workflow, docs). Do not let a path-skipped required check leave PRs stuck or silently green.

- Rust lane (Linux): format, Clippy, tests with real temporary SQLite, contract export/drift, dependency policy.
- Apple lane (macOS): package tests, iOS and macOS production builds; targeted iPhone/iPad UI and screenshot
  tests. Duo/window resize validation where supported. No mock target standing in for the shipped app.
- Migration lane: synthetic edge-case fixtures and importer tests on PRs; sensitive real-backup rehearsal
  stays in the private environment, not public CI artifacts. Include restore/integrity/media checks.
- Infrastructure lane: HCL format/validate on PRs; trusted plans using protected credentials only.
- Operations lane: release/recovery/backup, hook guard, workflow lint and deployment-gate tests.
- Image lane: build/test actual Linux ARM64 server image; no fake healthcheck requiring Bun.
- Cache Cargo and Swift dependency/build artifacts with toolchain/lockfile keys; cancel superseded PR runs.

Deployment after required main checks: build once/publish immutable digest from the exact tested revision,
smoke that digest, release serially through the existing mini lock. Verify SHA, readiness, migrations,
background-task ownership and native connectivity. Never cancel a deployment midway.
Infrastructure and server sequencing is explicit for the one-time cutover; do not accidentally run today's
automatic deploy against half-migrated configuration. Initial cutover uses a protected manual dispatch of
the tested revision; routine deployments return to automatic after acceptance.

Pre-merge delivery gate checklist (all three are independent today):
1. Backend: disable/hold MINI_DEPLOY_ENABLED and account for deploy-mini.yml's workflow_run trigger.
2. Infrastructure: hold the deploy-cloudflare job inside ci.yml independently of the backend gate;
   ensure only the chosen OpenTofu workflow can apply after ownership transfer.
3. Apple: hold apple-panel-testflight.yml's separate main-push publication until credential/endpoint
   configuration and installable candidate are ready. TestFlight build preparation must still be possible
   through an explicit trusted dispatch, without releasing an inconsistent main build automatically.
Record previous gate values, pending/in-flight runs and restoration order in the cutover issue.
Drain existing deployments before acquiring the cutover lock; do not terminate one midway or race it.
Restore automatic delivery only after the new ordering and required-check gate pass.

Apple delivery: preserve app identity/versioning, validate signing, upload the native iOS build and wait
for TestFlight processing; prepare the agreed macOS delivery artifact with appropriate signing/notarization.
Have an installable new client ready before retiring the old API; do not let App Store processing extend
an avoidable outage. Existing installed clients either update before cutover or show explicit unavailable state.
No long-lived tRPC compatibility layer unless distribution constraints make a small temporary bridge necessary.

Update GitHub required-check rules in a coordinated transition. Existing required checks remain required
until their replacements have demonstrated success; never bypass or merge a red PR. Preserve Conventional
Commit titles and review. Retire Expo publishing/legacy TS jobs after native delivery passes.

## 10. Baseline and after measurements

Record raw measurement metadata (time, revision/digest, host, workload, tool), not private data.
Before/after must use the same device set, sampling interval, workload and warm-up. Capture idle and active
workloads (reads, HA updates, Photo Booth upload/gallery, alarm/walk changes) separately.
Measure app + application database together, tunnel separately, and whole-host/VM overhead separately.
Do not attribute unrelated Hindsight/Bambuddy resource use to this migration.

Report CPU mean/p95/peak, memory median/peak and steady-state trend, request p50/p95, error rate,
startup/readiness, app image size, DB logical/file/WAL sizes, media file count/bytes, backup size/duration,
and CI wall time/runner minutes. Docker CPU percentages use core-relative semantics; specify this.
No invented after numbers or promises that Rust automatically reduces every measure.
Acceptance: no functional/data regression, no sustained resource growth, and explain any measured regressions
before declaring completion. Preserve user-visible responsiveness; agree numerical budgets from baseline.

Initial read-only snapshot on 2026-11-07 at approximately 20:20 UTC (not a benchmark):

| Measure | Observed |
| --- | --- |
| Bun container memory / CPU | 77.78 MiB / 6.55% instantaneous |
| PostgreSQL memory / CPU | 135.3 MiB / 1.44% instantaneous |
| Cloudflared memory / CPU | 33.84 MiB / 0.40% instantaneous |
| Database logical size | 371,889,855 bytes (about 354.66 MiB) |
| PostgreSQL data directory allocated | 809,336 KiB (includes cluster/WAL overhead) |
| Media directory allocated | 171,712 KiB; 1,705 files |
| Exact row counts | booth_photo 135; wake_photo 1,621; walk 11 |
| Exact weather row counts | weather_reading 1,648,896; weather_daily_reading 68,704 |
| Image inspect size | app 59,784,598 bytes; PostgreSQL 161,136,174 bytes |
| Health | DB OK; ten reported workers, zero consecutive failures |

These counts are not equivalent to file counts. Compare media references during rehearsal.
pg_stat_user_tables estimates were stale; use COUNT(*)/canonical hashes for migration verification.
Weather occupies most DB storage; preserve it rather than treating smaller SQLite size as permission to prune.

Six subsequent Docker samples before the backup (5-second requested gaps plus command overhead) showed:
app CPU mean 3.87%, peak 4.45%, memory 69.78–71.81 MiB; PostgreSQL CPU mean 1.85%, peak 4.43%,
memory 130.8–140.1 MiB; tunnel CPU mean 0.405%, peak 0.47%, memory 25.75–33.64 MiB.
This short uncontrolled sample is preliminary; do not present it as an idle or load benchmark.

## 11. Execution packages and tracking (create after approval)

Create one GitHub Project named "Native + Rust reset", one umbrella issue linking this approved plan,
and four large implementation issues. Fields: status, work package, dependency, acceptance evidence.
Statuses: Todo, In progress, Review, Done. No issue per file or trivial subtask.

1. **Foundation and preservation:** verified backup/restore, full baseline, schema/media inventory,
   target layout/toolchain, initial Swift/OpenAPI round trip, auth decision, OpenTofu state backend proof.
   Done when recovery is demonstrated and critical uncertainties have executable answers.
2. **Complete replacement:** Rust feature behavior + SQLite importer + shared Swift iOS/macOS adaptation,
   tooling and tests. Parallelize independent Swift/server/infra work with explicit file ownership.
   Done when retained feature scenarios pass against the candidate and migration rehearsal reconciles data.
3. **Delivery and cutover:** new CI/rules transition, OpenTofu/hostname, signed clients, final frozen backup,
   import, one outage window and production acceptance. Done when clients work and all data/media checks pass.
4. **Cleanup and evidence:** remove old code/config/dependencies, update instructions/overview/runbooks,
   measure after, verify backup restore, independently review and resolve findings. Preserve rollback assets
   outside Git. Done when clean builds contain no obsolete stack and deployed artifacts are verified.

Default: a single feature branch and implementation PR with coherent commits, independent review before
merge, and one planned cutover. If required-check migration/bootstrap genuinely needs a preparatory PR,
use at most one focused extra PR and explain the dependency; do not inflate work into many PRs.
Capture final cleanup in the implementation PR wherever possible; post-cutover evidence can be a small
follow-up if facts only become observable after deployment. Final cleanup may not remain an untracked promise.

## 12. Instructions for the implementing agent

- Read this plan, AGENTS.md and current overview; use wtp worktrees from fresh origin/main.
- Follow approved scope, work autonomously in large slices, commit often, avoid repeated permission prompts.
- Use repo Apple skills; share components faithfully. Do not start a visual redesign.
- Maintain an issue checklist and factual progress/evidence; report blockers early, not unchanged status.
- Coordinate all credential access through the primary agent's single persistent session. Delegates must
  not call op. Never inspect/print secret values, encrypted-state plaintext or user data in tool output.
- Delegate only authorized parallel packages, with non-overlapping ownership; independent reviewer must
  inspect final diff, data checks and cutover runbook. Fix findings and re-review affected areas.
- Test meaningful behavior: actual SQLite, mocked external HA at its seam, deterministic clock/DST,
  duplicate requests, reconnect, restarts, uploads, offline states and platform capabilities.
- Before cutover, prove backup restore and final reconciliation. Do not trade these checks for speed.
- During cutover, disable old writers/automatic conflicting deployments; keep one release owner.
- Do not delete original database/media/archives or rewrite Git history. Remove active code, not recovery data.
- Keep unrelated services/routes intact; permitted downtime is not permission to discard their configuration.
- Show real iPad/iPhone/Mac screenshots and interaction video. For PRs, follow screenshot evidence policy
  with no personal data. Update stale repository instructions, including removal of web-only invariants.
- Do not merge red checks or use admin bypass. Finish with running deployment, Apple delivery verification,
  data preservation evidence and honest before/after measurements. Never call unmeasured savings a result.

## 13. Questions to settle in implementation discovery

These do not require another broad planning round: recommend concrete answers and escalate only true
user choices or blockers. Record each answer in the issue/plan before dependent implementation.

- Which remotely hosted state backend provides locking/recovery with least added maintenance?
- What is the current native auth flow and correct interactive Access strategy at the new hostname?
- Which macOS distribution channel is desired (signed direct app initially is the proposed default)?
- Which Duo simulator/device configurations are actually available, and what platform features differ?
- Which native alarm/notification/Live Activity responsibilities are device-local versus server-owned?
- Can all data be represented losslessly, and what pre-existing media-reference exceptions exist?

## References

- Repo: infra/cloudflare/program.ts, deploy/mini/backup.py, docs/runbooks/mini-backups.md,
  docs/observability.md, .github/workflows/*.yml, apps/apple-prototype/project.yml.
- https://opentofu.org/docs/cli/import/
- https://opentofu.org/docs/language/state/remote/
- https://opentofu.org/docs/language/state/encryption/
- https://developers.cloudflare.com/tunnel/guides/terraform/
- https://docs.rs/sqlx/latest/sqlx/sqlite/struct.SqliteConnectOptions.html
- https://www.sqlite.org/wal.html
- https://docs.rs/utoipa-axum/latest/utoipa_axum/
- https://github.com/apple/swift-openapi-generator
- https://doc.rust-lang.org/clippy/continuous_integration/index.html
- https://embarkstudios.github.io/cargo-deny/index.html
- https://lefthook.dev/configuration/run/
- https://github.com/swiftlang/swift-format
- https://github.com/realm/SwiftLint
- https://github.com/rhysd/actionlint
