# World Wide Webb: one private home for apps and homelab

Planning date: November 8, 2026, Pacific time. Execution authorized November 8, 2026; progress is tracked in `monorepo-migration-progress.md`. This document supersedes the earlier proposal to consolidate into `apps` and move shared infrastructure between repositories.

## The end state

Three active repositories for the scope discussed:

- **dotfiles:** personal workstation/editor/shell configuration. No production application or homelab desired state moves here.
- **world-wide-webb, private:** all five apps, websites, Cloudflare infrastructure, homelab configuration/runners/monitoring/backups, homelab CLI, shared development/release tooling and encrypted signing storage.
- **homebrew-tap:** small installation recipes for app/CLI binaries. Retain its existing visibility initially; a public recipe does not make its private artifact downloadable. Authorized installers authenticate with GitHub. No Callkeep public releases, public Sparkle feed or Cloudflare download service is required.

One repository does not mean one deployment, build, framework or design. Each product remains independent. A native Folding change must not release Tendr, redeploy Control Center or activate homelab configuration.

**First useful milestone:** normal app work can resume in WWW, with only changed products tested and delivered. Optimize for elapsed time to that milestone, rather than completing every cleanup item before anyone can work on apps again.

Use existing working pipelines and product layouts first. Small adapters connect current Fastlane, test and screenshot commands; a universal framework, complete wrapper catalogue or rewritten release system is not a prerequisite. Some temporary duplication is acceptable if it preserves independent app delivery. The layout and process standards below describe the end state; they are not a requirement to finish every abstraction before the first working migration.

**Start independent preparation now:** isolated worktree, source/import staging, path mapping, minimal manifests, selective CI and product release adapters. Keep private histories local until WWW is private. Wait for the owner's current homelab resource management, monitoring and Linux-runner work to land **only before moving that source or changing its deployed contract**. Refresh and integrate the exact merged state at that point; do not block unrelated preparation behind it.

Work in substantial coherent batches, run relevant checks during development, then perform one integrated verification and independent final review of the candidate. Fix findings together before publication. Resume product development at the first useful milestone; archive old sources and perform optional cleanup afterward.

## 1. Refreshed evidence and active work


Fetched `origin` with pruning for all six relevant local repositories. Fast-forwarded the clean `world-wide-webb` main checkout. Preserved feature branches and dirty working trees in apps, Folding, homelab and homelab-cli; inspected clean archives of the refreshed remote main trees instead of resetting or stashing another session's work. A second fetch at approximately 11:42 a.m. Pacific returned the same six main revisions. Refresh again immediately before execution, and again at the brief cutover point.

Inspected baselines:

- `apps`: [`590d39abf0d483d232b3045d10446ef83895ae79`](https://github.com/0x63616c/apps/tree/590d39abf0d483d232b3045d10446ef83895ae79). Tendr is the only app on current main. TestFlight, listing preparation, screenshot capture, joint app/purchase submission, waiting-review replacement, deferral and availability monitoring already exist.
- Folding, local checkout named `foldr`: [`ea966862c7e07e08bb7f046873b94d7c915977a3`](https://github.com/0x63616c/folding/tree/ea966862c7e07e08bb7f046873b94d7c915977a3). Current main includes the recent profiles/milestones/history work. It has native tracking/storage tests, Rust Worker and workerd tests, separate staging/production infrastructure, a public static site and substantial Fastlane release machinery. CI is still manual-only. Existing shipping/device deferrals remain real outstanding work.
- Callkeep: [`73bb6dde3dbc765756ff12f3751db5bfad9bc4de`](https://github.com/0x63616c/callkeep/tree/73bb6dde3dbc765756ff12f3751db5bfad9bc4de). Native Mac app, local transcription, universal binary, Developer ID/notarization, Sparkle and Homebrew publication. Current CI uses an Intel hosted Mac.
- World Wide Webb: [`242eb8f4a0c3dc1ca336c20682e610128f914ac9`](https://github.com/0x63616c/world-wide-webb/tree/242eb8f4a0c3dc1ca336c20682e610128f914ac9). This is the current native SwiftUI/Rust/SQLite implementation, not the retired React/Expo/Postgres stack. Source map: [CODEBASE_OVERVIEW.md](https://github.com/0x63616c/world-wide-webb/blob/242eb8f4a0c3dc1ca336c20682e610128f914ac9/CODEBASE_OVERVIEW.md).
- Homelab: [`676d6621bc1f3fa451595f87f1894be15b5b46fb`](https://github.com/0x63616c/homelab/tree/676d6621bc1f3fa451595f87f1894be15b5b46fb). Current main enables two disposable macOS runner slots, permits only `world-wide-webb`, and pins an Xcode 26.4.1 image. [Host configuration](https://github.com/0x63616c/homelab/blob/676d6621bc1f3fa451595f87f1894be15b5b46fb/hosts/homelab-macbook.nix).
- Homelab CLI: [`6ad2c833c607a065d6f56e6a51755529447dbf54`](https://github.com/0x63616c/homelab-cli/tree/6ad2c833c607a065d6f56e6a51755529447dbf54). Its source now moves into `homelab/cli`; targeted repository/ref/rebind/distribution changes are required, while a general CLI redesign is not.

Also read the other agent's uncommitted `homelab/docs/linux-runner-plan.md`. It proposes four total jobs, at most two macOS guests, explicit OS/profile labels and resource admission limits. It is a dependency and coordination input, not an implemented capability. Do not duplicate that agent's runner work or promise its capacity before its load tests pass.

GitHub readback during the audit showed: apps public, Issues disabled, Pages enabled; Folding private with 42 open issues/items including one open Penpot design PR; Callkeep and WWW public; WWW had no open PR and one Dependency Dashboard issue. Apps has an active ruleset requiring `Conventional Commit title`, `changes` and `tooling`. These settings are a dated snapshot, not permission to silently weaken checks.

### Discoveries that change the earlier advice

1. **Blockr is already removed from apps/main.** The current Air Miles branch still contains Blockr and older automation. Do not implement a second removal against old source or resurrect it by replacing main with that branch. Check `apps/blocker` design remnants and retained published pages separately.
2. **Air Miles and the Matt Pocock skills are branch work, not current main.** The active branch tip was `9bf0c8a`; Air Miles and related Tendr changes need deliberate integration onto latest main. Its root release changes are stale relative to main's newer Tendr pipeline.
3. **Folding is actively dirty in another session.** Several worktrees and its open Penpot PR exist. Do not import only yesterday's main and delete the source checkout. Finish, merge, preserve or explicitly rebase each remaining work item.
4. **Tendr now does full automatic App Store delivery.** Automatic Folding delivery needs a policy for review, purchases, screenshots and publication, not merely `upload_to_testflight`.
5. **WWW owns more home infrastructure than Cloudflare.** Its current Cloudflare origin map includes **Penpot**, HA, Hindsight, Bambuddy and DSM. Shared backups, Penpot provisioning/backup, HA startup/networking and tunnel recovery move into the homelab module within WWW; the destination repo itself is retained.
6. **Private screenshot links will change.** PR comments currently use anonymous `raw.githubusercontent.com` links on a screenshots branch; copying that design into a private repo does not produce usable anonymous images.
7. **No shared UI means unwinding an existing dependency.** Both Tendr and branch-only Air Miles currently reference root RDesign, and the scaffold assumes RDesign. This needs a concrete migration, not only a rule for future apps.

The public Homebrew tap was also fetched: [`e0d2fe1347f860744ad67d6aff6a019652dae508`](https://github.com/0x63616c/homebrew-tap/tree/e0d2fe1347f860744ad67d6aff6a019652dae508). It contains the homelab formula, Callkeep cask and unrelated Quantum cask. Current formula downloads homelab 0.4.1; Callkeep cask points at public version 1.0.25. Preserve unrelated entries. Existing public history cannot be recalled by making future source private.

A final refresh during planning advanced homelab to [`0bf8d4ce1e4fad7aa1f2aa736af1bcba527eaed6`](https://github.com/0x63616c/homelab/tree/0bf8d4ce1e4fad7aa1f2aa736af1bcba527eaed6), adding provisioned **Beszel monitoring**. Inspected its host/module/service/backup changes. Other main SHAs remained unchanged. The committed runner policy still has two macOS slots; Linux/resource work remains a cutover dependency. A merged monitoring implementation is not proof of live activation; verify its deployment and exact runtime layout after the current work finishes.

### Repository inventory follow-up and explicit exclusions

A subsequent connected GitHub inventory found additional repositories beyond the original six-source audit. The owner explicitly excluded **Tickets, Quantum, bambuddy-homelab, the standalone air-miles data repository, grok-box-config, 3d-prints, palindrome-search, minecraft and github-archive**. Do not import, privatize, archive or delete them as part of this migration. Preserve unrelated Homebrew entries. The existing Air Miles application under apps is distinct from its private personal-flight dataset; app source remains in scope, personal data stays out of the source monorepo. Existing homelab-managed Bambuddy services remain part of the imported homelab configuration; the separate Bambuddy repository is left untouched.

Other repositories discovered: `grok-box-config` (agent-box setup/recovery configuration), `3d-prints` (CAD source/exports), `palindrome-search` (Rust research tool), `minecraft` (mod/tool workspace), archived `github-archive`, and disposable homelab enrollment/VM fixture repositories. These are **not automatically added** to the app/homelab migration. Leave Grok box configuration alone, including dependency auditing or compatibility edits there. Keep the CAD/research/game projects and GitHub archive untouched and outside this cutover. Inventory fixture repositories before retirement: preserve canonical synthetic fixtures/test evidence and ensure no rehearsal still depends on their remote identities; cleanup is not permission to delete them blindly.

Consequently, “three repos” means three primary repositories for the consolidated scope, with these intentionally excluded projects/data and historical test/archive repositories remaining separately. GitHub repository visibility must be private on WWW **before** any private histories enter it.

## 2. Exact layout and ownership

```text
world-wide-webb/
  apps/
    tendr/                     # existing app, tests, listing, app.yml
      Packages/RDesign/        # owned only by Tendr
    airmiles/                  # independent native app and tests
    folding/
      apps/ios/                # preserve working internal layout initially
      backend/                 # Rust Worker, runtime tests and D1 migrations
      contracts/
      cloudkit/
      fastlane/                # product-specific release code/listing/captures
      scripts/
      docs/
      app.yml
    callkeep/                  # existing Sources, Tests, Packages and Scripts
    control-center/            # existing WWW product root, including root inputs
      apple/
      server/
      contracts/
      Cargo.toml
      Cargo.lock
      Dockerfile
      deploy/
      tools/
      docs/
      app.yml
  sites/
    tendr/                     # source, not a change to installed public URLs
    folding/                   # existing static asset site
    airmiles/                  # only if a public site is actually needed
  infra/
    cloudflare/
      home/                    # home DNS, Access, shared tunnel
      folding/
        bootstrap/
        modules/
        staging/
        production/
      sites/                   # only shared-site resources not owned elsewhere
  homelab/
    cli/                       # CLI source, tests, schema and examples
    hosts/
    modules/
    services/                  # home services, including Beszel
    runner/                    # merged Linux/resource/monitoring implementation
    host/                      # private host operations
    packages/
    scripts/
    tests/
    docs/
  scripts/                     # common commands and change selection
  fastlane/                    # release front door and common helpers
  templates/                   # native app and optional Cloudflare backend
  .github/workflows/
  .github/actions/
  .agents/skills/
  docs/                        # shared lifecycle, CI, release, onboarding
  README.md
  AGENTS.md
  CONTRIBUTING.md
  homelab.json                 # real compatibility file, canonical host manifest
  flake.nix                    # thin entrypoint into homelab implementation
  flake.lock                   # canonical Nix lock
  .sops.yaml                   # merged path-specific encryption rules
  secrets/                     # encrypted host configuration only
  bootstrap/installer.json     # real enrollment compatibility file
```

The layout preserves working app interiors. Do not flatten Folding's nested `apps/ios` during the import; it would touch release/evidence paths without helping delivery. Move its website to `sites/folding` and its infrastructure roots to the explicit central locations in the same adapter pass; update every referring command/output path and test. Retain staging/production separation and module/state addresses.

Move WWW's **entire product build root**, not just apple/server: its Cargo workspace/lock/toolchain, Docker inputs, Python/shell helpers, private encrypted config rules, native Gemfile and version pins travel with it. `apps/control-center` is a source directory name, not a rename of the installed application, bundle ID, Panel scheme, image package, mini directories, Compose project or database volume.

No root custom Swift component library or universal application framework. Move RDesign to Tendr; update its XcodeGen, tests, gallery and renderer paths. Air Miles currently needs only a tiny color/platform-color surface: make it app-local with unchanged appearance. Keep Callkeep's transcription package, FoldingKit and PanelKit with their products. Root screenshot tools share execution/export mechanics, not visual styling.

### Homelab and homelab CLI: together, separate modules

Combine their source and releases in this repo, but preserve two interfaces:

- The **setup module** in `homelab/cli` connects, enrolls, verifies and resumes a host using explicit configuration. Its packaged binary must not embed personal host facts, tokens or live config.
- The **desired-state/runtime module** in `homelab` defines hosts, installed services, runner policy, monitoring, operations and recovery. Root compatibility files delegate into it.

This provides locality: a CLI/host/configuration change can be tested together without inventing a new plugin framework. The current host crate depends on a pinned public CLI Git revision and Nix fetches that repository. Replace those with local path dependencies and narrowly filtered Nix source sets; update Cargo locks. Do not copy every product into a CLI derivation or rebuild the CLI because a Tendr screenshot changed.

Keep root `homelab.json`, `flake.lock`, `bootstrap/installer.json` and host ciphertext as **regular files**, not symlinks: current enrollment has regular-file/path guards and root path expectations. A thin root flake imports the implementation under homelab. Later subdirectory support is optional; a compatibility shim is the faster, smaller change. Preserve the existing configuration schema and profiles unless a migration requires an explicit versioned extension.

## 3. Explicit process and tooling standards

Use one small command interface, backed by existing handlers:

```sh
scripts/dev doctor folding
scripts/dev setup folding
scripts/dev check folding --area native
scripts/dev check folding --area backend
scripts/dev screenshots folding --kind pr
bundle exec fastlane ios beta app:folding
bundle exec fastlane ios release app:folding
scripts/new-app.sh Example example --platform ios --backend cloudflare
```

These are the proposed target commands, not commands already implemented. A validated app manifest selects a named checked-in handler. The wrapper is dispatch, not a new task engine. A release command requires a product/channel; no implicit release-everything default.

Standards:

- SwiftUI/native Apple frameworks, SwiftPM and XcodeGen; retain each app's OS floor, Swift language mode and design. No TCA or universal navigation/storage/networking rewrite.
- Fastlane, Bundler and locked Ruby dependencies for Apple delivery. All three existing Apple bundles resolve **Fastlane 2.241.2**; use that initial common pin. Preserve product overrides until one tested Ruby/Bundler combination works for all. Root lanes delegate to app-owned release implementations.
- Toolchain `swift-format` as the default formatter, since Folding/WWW already use it. No whole-repo formatting churn in the move. Optional SwiftLint CLI later for a demonstrated useful ruleset; no plugin/trust prompt added to every target.
- Existing Rust toolchain/lock per actual workspace; Cargo fmt/clippy/tests and cargo-deny where appropriate. No root Rust mega-workspace that recompiles every app.
- Bun for JavaScript installation/tooling, frozen lockfiles; preserve Node execution for Wrangler/Miniflare and current `node --test` suites. Replace Folding's npm invocation and package-lock deliberately; update its release configuration fingerprint, which currently hashes that lock path.
- Existing Python tests/requirements/virtualenvs, Shellcheck and actionlint. No additional build orchestrator simply to wrap a few commands.
- OpenTofu for durable infrastructure; Wrangler for Worker code/assets and explicit D1 schema operations. One owner per resource/property. Retain SOPS/age and 1Password roles; do not rotate/replatform secrets during a source move.
- GitHub Issues/Projects for substantial work, app/domain labels, Conventional Commit PR titles, concise validation. Small fixes do not need a ticket/spec ceremony. Keep app domain glossaries/ADRs local; shared vocabulary and operations at root.

### Development lifecycle

Idea → short product brief → scaffold/onboard → coherent implementation → relevant local checks → PR checks/previews → merge → exact-main verification → affected-unit release/deploy → verified outcome.

The agent owns routine worktree setup, implementation, fixes, PR, merge, release verification, documentation and cleanup within the accepted execution scope. Use a final independent review for substantial/risky changes rather than many tiny approval gates. Never merge a red required check. Only ask the owner for an unavoidable account/2FA/hardware/legal interaction, unknown factual assertion or additional purchase; prepare the concrete action first and batch those requests.

Do not introduce ticket-comment agents, autonomous issue creation, Slack/email notifications or an agent platform as a prerequisite. GitHub is the tracker/orchestrator and its checks provide release status; monitoring integrates with that existing lifecycle only where authorized. There is no need to build a separate software-factory product.

## 4. Smart CI and precise triggers

One `scripts/affected` implementation evaluates committed base/head trees, manifest paths and actual dependencies. It emits a versioned selection document with reasons, check requirements, release candidates and source identities. Do not scatter independent path rules across workflows.

Each `apps/<product>/app.yml` declares native/backend/contracts/site/listing/screenshot/tooling paths, capability/handler names, toolchain and channels. Use explicit dependencies where real. Root identities are not enough: select **delivery units** within an app.

Examples of the intended contract:

- `apps/tendr` runtime → Tendr native tests/preview/release only.
- Folding native runtime → Folding domain/storage/app-hosted checks and relevant previews; Folding native delivery, no unchanged Worker redeploy.
- Folding backend/migrations → Rust/Wasm/workerd/D1 and required client contracts; staging/production backend deployment, no unchanged native upload.
- Shared Folding contract → client/backend compatibility tests; promote only changed runtime units with compatible ordering.
- Control Center server → Rust/integration/container checks and image deployment; no TestFlight unless native inputs change.
- Callkeep source → Mac checks/signing/notarization/private Homebrew delivery only.
- App tests only → checks, no binary publication.
- Listing only → that product's locale/URL/content validation and listing operation; no other app upload. Initially preserve Tendr's same-app full pipeline rather than redesign it during migration.
- Screenshot fixture/caption only → relevant capture/export/listing work; no unrelated backend deployment or every-locale PR run.
- `sites/<product>` → website build/link/header checks and that site's deploy only.
- `infra/cloudflare/home` → home infrastructure checks/apply only.
- `infra/cloudflare/folding` → Folding infra checks/plan/apply, binding compatibility as needed; no automatic IPA.
- `homelab`/root flake/host manifest/host secrets → relevant Nix/host/controller/configuration tests and homelab promotion; no app releases.
- `homelab/cli` → CLI/host compatibility/tests/private CLI release; host generation also selected when its installed CLI/helper input changes.
- Common release helper → handler tests and its consumers' verification, no all-app release. Common screenshot transport → capture consumers. Skills/docs → cheap validation only. Unknown tooling → conservative verification without automatic shipment.

PR comparison uses merge-base-to-head with an explicit record of head versus test-merge source; main uses the real push range. Fetch sufficient history and inspect old/new paths of moves/deletions. Evaluate the head's manifests. Invalid configuration, unknown base or failed selection must fail rather than become an empty successful matrix. Initial imports use explicit verify-all with shipping disabled.

Run a stable final required gate on every PR/main execution. Select inside it rather than making required workflows disappear through top-level path filters. The aggregate uses `always()` and rejects failed, cancelled or missing **selected** checks; expected unselected jobs may skip. Preserve the current title check. Keep the aggregate gate and title check in CI; the owner explicitly chose automation-enforced checks without GitHub branch protections or a plan upgrade. [Required-check mechanics](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks).

Regression cases: docs/tests-only, moved/deleted/added apps, both sides of renames, dependencies, shared tooling, manifest-only, empty selection, missing history, multi-commit pushes and large imports. GitHub path-filter file limits must not determine correctness. [Diff behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#git-diff-comparisons).

### Verified candidates, receipts and locks

Promote only trusted successful **main push** verification. Record source repo/SHA, run/attempt, declared input fingerprint, check results, toolchain/config identities and artifact digests. `workflow_run` must validate event/repository/branch/conclusion and explicitly check out `head_sha`; its default `GITHUB_SHA` is not necessarily the tested source. Never grant signing/operations privileges based on PR artifacts. [Workflow-run behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).

Use private WWW **GitHub Release assets** as the initial durable receipt/artifact store, reusing Folding's immutable-manifest pattern. Namespaced product/build records hold binaries/dSYMs, screenshots, processed Apple IDs, image/Worker identities, verification provenance and completion stages. Actions artifacts are short-lived diagnostics, not the only ledger. Preserve historical origin repo/SHA and readers during migration.

Reconciliation resumes **verified immutable candidates**, not arbitrary current main. If native A passed but publication failed and docs-only B later passes, resume A's artifact/identity. To build B, run missing checks or prove full input equivalence while keeping A's original verification provenance; do not relabel A's bytes as a B build. Track unshipped intents and last successful channel receipts so concurrency coalescing or failed releases do not lose changes.

Use one **product allocator lock** across all channels/environments sharing a build ledger. Folding production/staging and TestFlight/store requests cannot independently reserve the same number. Reuse a stored artifact for later store promotion. Manual/local entrypoints obey the same allocator; GitHub concurrency alone does not protect local invocations. Polling Apple and long-lived review happens outside the scarce build slot. PR verification can cancel superseded runs; publication/apply does not cancel mid-operation. Do not assume an unlimited FIFO queue.

Control Center deployment ordering currently uses workflow `run_number` and silently skips stale generations. Preserve its existing CI workflow identity where possible, but still migrate to a durable source/digest-bound generation allocated under its deployment lock, seeded above live state. Reject obsolete publisher epochs. Never reset the on-mini generation or call a zero-exit no-op a verified deployment. Test retry, lower workflow counter, delayed old request and exact live digest/health.

## 5. Homelab updates must not follow every app merge

Main is the authoring branch. **`deploy/homelab` is the host-deployment ref.** A trusted successful homelab check promotes this ref to its exact tested main commit only when declared host inputs changed, or an explicit fully checked reconciliation is requested. No separate generated configuration tree.

Owner update: proceed without GitHub branch protections or a GitHub Pro upgrade. GitHub will not enforce checks or restrict this ref against direct pushes. Our normal automation still advances `deploy/homelab` only through the scoped promoter after successful exact-source checks; agents follow the same checked publication process. Serialize promotion with expected-old-SHA and fast-forward checks, reject older candidates that finish late, and record source/run/attempt/input identity. A newer B promoted before older A completes must never be rewound by A. A rollback is a recorded forward corrective/revert candidate, not permission for a stale push.

Comin watches `deploy/homelab`, not monorepo main. This is essential: current Nix embeds `self.rev` into the installed revision, and following main would activate hosts for unrelated app commits. Filter Nix build sources as well, so app files do not become implicit CLI/controller build inputs.

CLI/enrollment changes in this migration are real, not docs-only:

- Distinguish authoring main from the selected deployment ref in Comin configuration, verifier and test fixtures. Current CLI explicitly expects main in multiple status fields.
- Preserve exact approved-revision binding during enrollment, reboot and recovery. For a newly published setup, promote the approved/tested config commit while enrollment holds activation, then verify that exact commit after releasing the hold. An approved historical setup must not substitute current main.
- Add an explicit **preserve-state repository rebind** from old homelab to WWW. Keep host identities, age backups, approved receipts and resumable journals; current CLI refuses a silent repository switch. Do not delete local profiles or rerun bootstrap as a shortcut.
- Change host Git access deliberately: a GitHub deploy key cannot simply be attached to two repositories. Stage a destination-scoped read identity, prove read access on the host, update the configured remote, and retain a tested rollback before revoking old access. Never remove the only key before proving the new one.
- Hold a **bounded promotion transaction** during enrollment/rebind: retain the reviewed candidate until activation and exact-source readback complete, queue later valid promotion intents, then release them. Reuse the existing setup hold/recovery mechanism with a durable, resumable lease; do not keep a CI runner occupied while waiting. Test interrupted/resumed setup and concurrent host/config changes. If a candidate is already superseded before activation begins, revalidate/reprepare while preserving identities/journals; never rewind a newer deployed host to satisfy an old receipt.
- Do not wait for activation inside a runner execution that activation itself is waiting to drain. Promote, let the runner exit/clean up, then observe activation from an independent status operation. Preserve the current updater hold/drain/recovery contracts.

The config update does not move live services, databases or host roles. Current resource/monitoring/Linux work must land and be refreshed first; retain its capacity policy and actual evidence instead of replacing it with assumptions from this plan.

## 6. Runner and trusted operations contract

Homelab owns images, controller, resources and monitoring. CI declares a required profile. Preserve disposable non-root guests, explicit OS/architecture labels, no shared writable host cache/production Docker socket, and bounded artifacts/logs. Four-total/two-macOS capacity remains conditional on the other agent's load/health gates.

Profiles in the target:

- **macOS ARM64 build/release:** pinned Xcode 27.2/Duo-capable image, satisfying Folding pins. Prove Tendr/Control Center/Callkeep against it; retain a tested exception only if needed.
- **Linux ARM64 build:** Rust/Wasm, Node/Bun, Python, OpenTofu and Docker as required. Prove exact Folding workerd/Miniflare dependencies and architecture-aware action downloads. Existing Node tests remain Node tests.
- **Trusted Linux operations:** a separate operations profile with a restricted Tailscale identity permitting only the required mini SSH endpoint/ports and public release APIs. Provision only for allowlisted successful-main release/infra workflows; ordinary PR/build guests retain host/LAN/tailnet blocking. Labels alone are not the trust policy.

Choose this operations profile as the initial implementation, not an open-ended choice between a new reconciler and several transports. It adapts the already-working **ordinary OpenSSH over Tailscale**, SSH key and pinned-known-host route. Keep its credentials scoped and temporary; do not put an operator's vault or the controller App key in guests. Include it in the controller's same resource/cleanup accounting. Its exact-source provisioning/trust and network canary is a foundation gate before moving existing deploy workflows. It is separate from broadening normal build guest access.

Early probes, before disabling current working routes:

1. Unattended Xcode27.2 build and **real native Duo posture controller/capture inside the disposable VM**. Command-line compile success does not prove GUI/TCC/Device Hub support.
2. Linux ARM64 frozen installs, actual workerd startup, Rust-to-Wasm build and Folding runtime tests; verify Docker architecture and optional dependencies.
3. Operations profile reaches only the permitted mini SSH target, deploys a tested harmless candidate/staging artifact, cleans identity/VM/registration and cannot access broader home services.
4. Callkeep universal cross-build validates both slices and embedded frameworks. Run ARM64 native tests; preserve a targeted Intel execution route or document the remaining Intel runtime gap rather than silently dropping support.

Audit all workflows, including small selection/status/site/metadata checks, so making WWW private does not retain routine hosted-minute spend. Keep a documented temporary working/manual fallback only until these probes pass. No indefinite queues waiting for nonexistent profiles.

## 7. Apple releases, screenshots and listing lifecycle

### Policies

- **Tendr:** retain its current full automatic App Store pipeline and ownership safeguards, not an older branch version.
- **Folding:** automatically build/distribute eligible main changes to its named internal TestFlight group. Adopt the Tendr-style complete App Store pipeline after its first-launch readiness is genuinely completed. Do not mark current physical/provider/security/visual deferrals passed to enable an automatic lane.
- **Control Center:** preserve native TestFlight and processed-build publication into the local backend; server/image delivery is separate. Do not add public store submission for a home app without a product decision.
- **Callkeep:** Developer ID sign, notarize/staple, privately publish, update Homebrew. No App Store or Sparkle requirement.
- **Air Miles:** verification/fixture captures only until its distribution audience, app record and signing are configured.

Root Fastlane is one front door; app handlers keep app/widget identities, entitlements, tip product IDs, profiles and specialized state machines. All channel completions require observable outcome: Apple processing plus group membership, actual public store availability, live service identity, or a successful authorized Homebrew upgrade. Upload alone is insufficient.

Folding needs these specific adaptations:

1. Split source repo, historical artifact repo and new artifact destination. Migrate/seed global reservations with provenance and one publisher, not a blind hardcoded repo string replacement.
2. A candidate gets a unique immutable **build record** (`folding/build-<number>`), independent of marketing version. Current `v<version>` model permits only one source per version and would block repeated betas or waiting-review replacement. Same source/config request reuses a reservation; distinct sources with the same marketing version get distinct builds. Preserve old tag readers.
3. Expand CI evidence mapping beyond the existing contracts job to exact named native/domain/backend/localization/screenshot checks and attempts. Do not replace source-bound evidence with a general green workflow Boolean.
4. Replace preview's whole-repo Worker-SHA equality with a verified backend-input/deployment receipt and compatibility check. Reuse an unchanged compatible Worker; require deployment before an incompatible client promotion. Preserve feature-readiness overlays, don't simply remove provenance checks.
5. Generalize Tendr-hardcoded release/resume/availability state by product and namespace artifacts. A Folding deferral cannot overwrite or resume Tendr's release. Keep existing immutable IPA/assets and retry/readback behavior.
6. After one-time launch acceptance, routine automation produces source-bound checks, captures, metadata validation and independent automated final review for substantial releases. Store the review/fix evidence automatically; do not retain a hidden manual approval Boolean on every nominally automatic build. Unchanged copy/visual inputs may reuse their reviewed fingerprint with explicit provenance; changed substantive listing/privacy facts require real review. Existing device/provider deferrals remain distinct.
7. Recommend Tendr's owned-waiting policy: prepare replacement bytes/captures first, replace only pipeline-owned Waiting for Review app/purchase bundles, preserve In Review/unknown/unrelated states, coalesce later updates, never silently drop tips. Apple's review/cancellation race remains documented. Submission must not create products or change prices.

### App Attest releases without Worker redeployment

Execution uncovered another existing dependency: Folding's allowed Apple build versions are
currently Worker bindings, so each beta changes Worker configuration. Retain the existing
allowlist and strict signed metadata checks; add an explicit durable published-build policy in
the existing isolated D1 databases. After a verified signed archive, the trusted release handler
registers exactly its environment/app/build/source and confirms readback before distribution.
The app already sends its build header; that header selects a policy row and never replaces
cryptographic attestation/assertion validation. Unknown, cross-environment/app and mismatched
signed versions remain rejected, and a build cannot be rebound to another source.

This needs one schema/Worker rollout before new automation, then a small policy write for each
new native build. No new Worker endpoint, storage resource, app library or per-beta Worker
deployment is needed. Preserve legacy clients and a compatible Worker rollback floor. This is
necessary to meet changed-only delivery, rather than an optional backend rewrite. Cloudflare
tracks bindings with Worker versions, while D1 state changes are independent of versions.
[Cloudflare versions and deployments](https://developers.cloudflare.com/workers/versions-and-deployments/).

### Screenshots

Three modes: fast PR preview, focused visual regression/component render, full localized App Store export. Share setup/transport/artifact/export validation; scenes, fixtures, styling and captions stay app-owned.

Folding already has five native-view scenes, deterministic fixtures, Duo geometry assertions, ten locales, a compositor and tip-review assets. Wire a small English PR preview and its existing full release matrix rather than rebuilding capture. Tendr retains its existing fixtures and ordinary/Duo pipeline. Preserve WWW's explicit opt-out from mandatory screenshot evidence.

Private PR evidence uses authenticated Actions artifacts/contact sheets and links in one updated check/PR summary. Anonymous raw-image links from the current screenshots branch will not work privately; do not expose images/tokens just to retain inline comments. Native capture must prove intended display, geometry, nonblank pixels and source/version. Store export additionally verifies opacity, order/count, locale tuples, gallery slots and Apple's processed checksum readback. Preserve the distinction between native Duo captures and composed marketing canvases. Screenshots are fixtures, never health/recording/home/flight data.

## 8. Cloudflare and home operations

All durable Cloudflare source lives under `infra/cloudflare`, with **separate roots/state/identities by owner**, not one account-wide state:

- `home`: current tunnel, home email-OTP/wildcard deny policies, Access applications and DNS for **HA, Hindsight, Penpot, Bambuddy and DSM**, plus Beszel when the current monitoring rollout adds its route. Verify that cross-repo route has landed before retirement.
- `folding/bootstrap`, `staging`, `production`: existing encrypted state, app D1/private R2/jobs/dead queues/watchdog, admin Access, getfolding.app site/redirect/support-email configuration.
- Further app/site roots appear only when needed. Never let two roots or OpenTofu/Wrangler manage the same resource/property.

Keep root/provider pins and resource addresses, remote IDs, audiences, session rules, tunnel name and persistence unchanged during relocation. Moving code within WWW does not require importing/destroying existing home resources. Keep home state at the current mini path and Folding state in its existing encrypted remote backend initially. Freeze/drain the old writer, prove a no-unintended-change plan, then enable the new exact-source writer. Verify encrypted backups and isolated restore; no raw state/plan/workspace upload.

Cloudflare is the default for **new hosted backends**: TypeScript Workers and static assets, D1/R2/Queues when useful, explicit staging/production, health/version, migrations, rate/cost limits and rollback. Keep Folding's working Rust Worker and Control Center's home-local Rust implementation. No rewrite merely for language consistency; Cloudflare Access is for operator/admin surfaces, not a substitute for an app's user-auth design.

Homelab owns shared service setup, HA networking/startup, tunnel recovery, Penpot, monitoring and backup scheduling/NAS/recovery. Control Center owns its image/data schema and consistent application snapshot/restore module.

**Enforce the ownership move in code:** current Control Center deploy stages/copies home backup scripts and reinstalls a schedule on every image release. Remove those writes at handover. Keep app snapshot support, call the installed homelab backup interface where necessary, and define lock ordering to avoid recursive waits. Test a normal app deploy after the handover and prove it leaves home backup script hashes, launchd config and ownership unchanged. Coordinate with the active homelab work; do not overwrite its new monitoring/backup policy.

Preserve Beszel's system identities (**name + address + port**), hub private identity, history/data volume, native agent users and backup coverage. Renaming or omitting a configured system can delete its history; moving the source must not regenerate its inventory from folder names. Retain the current Cloudflare Access plus Beszel account login; do not introduce new SSO during the move.

Do not combine this source migration with moving mini services to MacBook, changing its actual service virtualization/runtime, altering network origins, rotating all credentials or deleting legacy database/media archives. The active homelab migration can supersede old WWW docs describing OrbStack; inventory the live final topology instead of restoring an old one from a README.

## 9. Fully private Homebrew installs, without another repo

The desired contract is: an authorized user signed into the chosen GitHub Git route can install/upgrade; an unauthorized fresh fetch fails. Homebrew is the update authority. No public Callkeep release/appcast or Cloudflare binary hosting.

Git tap access and HTTP release downloads are different. Current Homebrew has no built-in private GitHub release-asset strategy; old recipes commonly rely on internal APIs or unsafe token/redirect assumptions. Do not promise a plain private release URL works just because `git clone` succeeds. [Homebrew authentication](https://docs.brew.sh/FAQ#how-do-i-authenticate-private-git-source-downloads).

**Initial concrete implementation:** use Homebrew's documented built-in Git artifact download support, from immutable **orphan distribution tags in private WWW**. Example namespaces: `dist/callkeep/v1.0.26` and `dist/homelab/v0.4.2`. Each artifact tree contains only the prebuilt signed app or CLI/helper binaries; main source does not contain build output. Pin both tag and exact revision in the tap recipe. No new private tap/distribution repository is needed. [Cask Git URL support](https://docs.brew.sh/Cask-Cookbook#git-urls).

Canonical notarized ZIPs, checksums, dSYMs and receipts remain private release assets for recovery. Distribution tags are immutable install endpoints. Keep source clones/Nix source filtering separate from these artifact refs; test actual clone/fetch behavior, repo growth and cache/download size. A current local Callkeep bundle measured about 27 MB, largest file about 22 MB: viable for a pilot, not a guarantee that future model/runtime bundles stay small. Models remain runtime downloads, not vendored into Git. Do not introduce LFS without a proven Homebrew path.

Prove Git transport preserves app symlinks, executable modes, code signature and stapled/notarization validation after a clean fetch. If this cannot be proven or size is unsuitable, the fallback is a narrowly maintained authenticated release-asset downloader **only after** its sandbox/redirect/credential tests pass, not a public endpoint or tokens embedded in casks. That is a bounded capability gate, not permission to disable Homebrew's sandbox. No `op` execution from cask evaluation.

All private WWW readers can read all source/config/encrypted signing branches. This is acceptable for the owner/trusted collaborators; a three-repo design does not provide artifact-only access to outside users. Revisit storage/access if that becomes a real requirement.

Callkeep migration also changes its workflow:

- Seed a Callkeep-scoped counter above every actual published version (tap currently 1.0.25); retries reuse the exact stored build. Do not scan all monorepo `v*` tags.
- Scope release notes to Callkeep and its declared input changes. Current unscoped git ancestry notes would include unrelated products.
- Remove/disable Sparkle, its visible update command and obsolete appcast/signing credential access in the new build; remove `auto_updates true` from the cask so Homebrew upgrades do not require the old self-updater convention.
- Existing Sparkle installations cannot learn a private feed automatically. Install the transition build through authorized Homebrew, preserving bundle/signing identity, recording data/preferences and iCloud container. No public bridge/grace period is required by the chosen Homebrew-only policy.
- Homelab CLI updater/checker currently points at its public GitHub repo and public schema URL. Make its update behavior Homebrew-owned too, replace help/schema destinations with packaged/current sources, and preserve `homelab`, `homelab-host` and `hl`. Publish a CLI update because repo/ref/rebind behavior changes, not just a documentation bump.

Acceptance on a clean account/Mac: tap and artifact fetch separately, install A, upgrade A→B with the app closed, app launch, signature/notarization, preserved data, CLI/helper/alias versions, unauthorized/expired/revoked access failing on a **fresh uncached** fetch. No credentials in URLs, recipes, logs, binaries or token output. Revocation cannot recall a binary already downloaded. Preserve Quantum and any unrelated tap entries; two publishers update only their recipe and safely rebase/retry.

## 10. Signing, credentials and bootstrap recovery

To reach the intended active repo count, consolidate private Match Git storage without changing its storage technology:

- WWW branch `signing/folding`: existing encrypted Folding signing history.
- WWW branch `signing/certificates`: existing encrypted Control Center certificates history.

Use Match's documented `git_branch`, direct branch clone and readonly release behavior. Preserve ciphertext, passphrases, certificate/profile identity and recovery copies; change repository/branch references, then prove a signed archive. Do not put unencrypted signing assets on main. Tendr and Callkeep can retain their current appropriately scoped temporary-keychain secret inputs. [Match Git branches](https://docs.fastlane.tools/actions/match/#git-storage).

Merge `.sops.yaml` path-specific rules for relocated WWW/product ciphertext and root host secrets. Do not overwrite one imported repo's encryption policy with another's. Preserve recipient/recovery identities and enforce encryption checks. Private repository access is not permission to commit plaintext, health records, transcripts, media or state.

Normal build guests receive no release/operations credentials. Trusted signing/ops executions get only relevant secrets, clean temporary keychains/files and never cache them. All operator `op` and secret-dependent work uses the primary agent's persistent session with history/tracing disabled; reviewers do not access credentials.

Avoid a recovery loop: a broken homelab must be recoverable when its own runner is down. Keep the CLI/install artifact independently downloadable from GitHub through the operator's authenticated laptop, local/off-host encrypted recovery copies and documented manual checks/SSH bootstrap. Do not make all recovery builds depend on the same broken runner or require Nix/store access on a wiped host before it can download bootstrap tooling. Preserve a known-good packaged CLI/config revision until reboot/recovery proves the new route.

## 11. New-app scaffold and quality improvements

Extend the current scaffold, remove its RDesign requirement, and create a buildable independent SwiftUI app, manifest, core/hosted smoke tests, synthetic fixtures, screenshot scenes, listing source, privacy/support placeholders, and CI discovery. Backend preset is optional: Cloudflare TypeScript Worker/static assets with tests, isolated staging/production names and migration skeleton. Offline apps should not receive unnecessary accounts/queues/storage.

Onboarding should perform ordinary API/setup work autonomously: bundle/capability registration, signing configuration, ASC record lookup/bootstrap where supported, named internal group, URL/listing/export-compliance validation, signed beta smoke and automatic-channel enablement. Do not create unrelated certificates/products or invent privacy/legal facts. The owner only handles unavoidable 2FA/legal/account facts or spending decisions, prepared in one concrete handoff.

Each product keeps listing content, locale mapping, review notes, age/privacy declarations, scene/caption configuration and source-version linkage in its own folder. Shared tools validate presence/length/locales/URLs/readback. Do not treat an uploaded screenshot artifact as a verified listing or store release.

Reviewed [awesome-swift](https://github.com/matteocrippa/awesome-swift) and upstream candidate docs. Minimal recommendations:

- Keep XCTest; use built-in Swift Testing for new domain tests where useful. No mass conversion. UI/performance/hosted render suites stay native XCTest. [Swift Testing](https://github.com/swiftlang/swift-testing).
- Existing app fixtures/gallery/capture first. Pilot [SnapshotTesting](https://github.com/pointfreeco/swift-snapshot-testing) only for valuable deterministic pixel/text regression cases, pinned by runtime/device/locale/font/dynamic-type/clock. Never auto-approve changed baselines. UIKit/AppKit image tests do not run on Linux.
- Use existing initializer/closure injection. [swift-dependencies](https://github.com/pointfreeco/swift-dependencies) is optional for demonstrated test-time/UUID/service control pain, not a mandatory architecture.
- Avoid a second formatter. Optional SwiftLint CLI after migration if correctness rules justify it. Retain app-specific Sparkle removal work, FluidAudio/WhisperKit versions and actual architecture tests; no arbitrary networking/database stack replacement.

The largest product gains are behavioral: cold/offline/empty/error states; correct background/Shortcuts behavior; recording/journal/data migration recovery; accessibility/Dynamic Type/VoiceOver/Reduce Motion; measured startup/memory/battery; sanitized OSLog/MetricKit/crash/dSYM evidence and a primary-user-journey smoke test. Prioritize these per app after the move, not a pile of libraries. Keep actual provider/device acceptance separate from mocks and screenshot tests.

## 12. Documentation, AGENTS and skills

Update these as part of the working migration, not a later vague promise:

- Root README: the complete product/home/CLI map; quickstart; public sites versus private binary installs; command/distribution/recovery links; how selective CI works.
- Root AGENTS: shared worktree/tooling/credential/privacy/verification/publication rules and links. Keep it concise. Each app and homelab/CLI gets local instructions for its own domain/architecture and invariants. No root monochrome UI requirement, Tendr medical rules or mandatory WWW screenshot rule.
- DEVELOPMENT/CONTRIBUTING: useful implementation batches, tests/previews, proportional review, exact-main delivery and agent-owned outcome checks.
- CI: manifest/areas/dependencies, required gate, profiles, source identities, receipts/locks, caches, promotion refs and examples of what does **not** release.
- RELEASE: common Fastlane entrypoint, app-specific channels, beta/store state, review deferral/replacement, immutable build IDs, private Homebrew publication and retry/readback.
- HOMELAB/INFRASTRUCTURE: root compatibility contract, `deploy/homelab`, CLI rebind/recovery, runner resources/monitoring, operations profile, Cloudflare state ownership, backup locks and restore.
- NEW-APP: scaffold presets, automated onboarding, explicit remaining account/legal actions and synthetic listing/capture defaults.
- App/CLI/homelab READMEs: real commands and status, retained internal structure, product facts, runtime addresses only where useful, verified versus deferred acceptance. Reconcile stale “repo still named Tendr” and obsolete CI deferrals.

Carry the branch's existing 27 Matt Pocock skills into root `.agents/skills` with their pinned source/license, including **improve-codebase-architecture**, codebase-design, research, diagnosis, domain-modeling, review and TDD. No redundant reinstallation. Carry WWW's useful SwiftUI/HIG/motion skills with provenance and reconcile duplicates. Configure shared tracker/domain guidance in `docs/agents`; preserve app-local glossaries/ADRs rather than building an ambiguous global domain glossary.

Consulted Matt's architecture/design/workflow guidance: favor deep modules with small stable interfaces, locality and tests through the real interface. Concrete seams here are product delivery handlers, setup versus host runtime and infrastructure versus code deployment. Do not create dozens of pass-through helpers or a generic platform. User-selected fast/low-touch planning overrides introducing a new ticket/grilling approval process for each routine choice.

## 13. Fast execution: prepare, make it work, then clean up

Owner reconfirmed this execution order during implementation: prioritize the usable app cutover,
then the homelab authority handover as its current work lands, then retirement and cleanup.
Do not make optional documentation polish, helper unification, library adoption, scaffold
extensions or archive administration prerequisites for resuming app development. Essential
working instructions, data/signing integrity, independent review and real delivery proof remain
part of the applicable cutover. Review completed batches in parallel with the next independent
implementation batch; do one integrated review before publication, without new tiny review gates.

### Pass 1 — independent preparation now

Start from refreshed WWW main in an isolated worktree. Fetch each relevant source, inventory active work, preserve histories and prepare source-to-destination path mapping. Stage imports locally. Adapt existing app scripts and Fastlane handlers, minimal product manifests and the selective CI gate. Avoid broad renaming, framework extraction, formatter changes or dependency upgrades.

Independent source/import preparation and CI/release-adapter preparation can proceed in parallel where they do not edit the same files. The primary agent implements, with delegation limited to the applicable independent-review rules. Do not create new review or owner-approval gates for each directory or helper.

Keep active homelab/CLI work untouched. Once resource/monitoring/Linux and intended CLI recovery changes land, fetch them again, inspect their delta and record the exact final SHAs. Only the work that changes those sources, runner contracts or live configuration waits for this dependency.

Probe unattended Duo capture, the restricted operations route and private Homebrew Git artifact installation early and independently. Each probe blocks only its dependent cutover, not local imports or every unrelated product. Never disable a working release/install/deploy route before its replacement has passed.

Resolve public site/Pages compatibility before changing visibility: Tendr's installed `github.io/apps/...` URLs belong to GitHub and cannot simply be served by Cloudflare. Prefer existing eligible paid-plan Pages compatibility; otherwise verify an account-site bridge or retain the legacy endpoint temporarily. No new purchase without approval. A temporary legacy publication host is acceptable and must be documented honestly. [Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/unpublishing-a-github-pages-site).

### Pass 2 — get the monorepo working and resume app development

Make WWW private before publishing imported private histories; no GitHub Pro or branch-protection prerequisite. Use explicit non-squashed subtree imports, preserving original SHAs/evidence; do not let installed filter-repo tooling silently choose a rewriting strategy. Bring existing product build roots across intact and make only required path/configuration changes.

Integrate Air Miles/skills/Tendr branch work against current apps main without reviving Blockr or reverting Tendr's newer release pipeline. Preserve the untracked Tendr requirements doc, Folding dirty/worktree/Penpot work and CLI recovery work. Use short final-refresh/publication pauses per source, not a days-long development freeze.

Keep working pipelines as the starting point. Wrap existing native, backend, screenshot and release commands rather than replacing all of them with a new orchestration layer. Add only the shared selection, verified-source, allocator and receipt behavior needed to make existing handlers work safely in one repo. Retain essential identity, data, signing and publication safeguards; speed does not justify bypassing them.

Enable each imported channel after its relevant verification/canary, not automatically because a large import touched its files. Prove Tendr delivery, automatic Folding TestFlight and fixture screenshots, Control Center's independent native/image delivery, and private Callkeep Homebrew installs. Preserve the distinction between Folding beta readiness and outstanding first-App-Store-release acceptance.

Build a candidate once and promote its immutable artifact through the applicable processing, distribution and publication stages. Reuse successful same-source checks/artifacts. Run independent selected checks within measured homelab capacity; use scoped caches. Repeat broad tests only after meaningful changes, failures or unresolved concerns, rather than after every small edit.

**Resume milestone acceptance:** ordinary product work starts in WWW; documented existing commands work; selected CI passes; normal configured beta/install/deploy channels work for migrated products; one product's changes do not publish another or activate homelab; essential README/AGENTS/CI/release instructions reflect the working state. Full helper unification, optional libraries, exhaustive formatting, scaffold enhancements and old-repo archival are not conditions of this milestone.

After the homelab dependency lands, implement ordered `deploy/homelab` promotion, CLI rebind/key handover and filtered local Nix/CLI inputs. Canary exact-revision enrollment, restart and recovery. This is a separate coherent cutover and must not stop normal app work that can already run safely. Keep its old source authority temporarily until the replacement is verified.

### Pass 3 — home ownership handover, retirement and useful cleanup

Move Cloudflare source/state-owner paths and shared backup/startup/Penpot responsibilities into their final modules, with drained old writers, no unintended infrastructure changes and the app-deploy/backup separation enforced. Verify retained login, one worker, monitoring history, backup/isolated restore and installed ownership. This pass may run alongside resumed app development; do not overlap writes with the active homelab agent.

Transfer issue/project fields and labels, preserve artifact/signing provenance and readers, disable superseded publication/apply triggers, and remove obsolete credential consumers only after tracing dependencies. Consolidate encrypted signing storage and common helpers where doing so actually removes a repository/dependency or recurring work; a signing-backend relocation need not delay a first working app import if the old readonly store remains safely available.

Finish documentation, new-app presets and useful cleanup as coherent changes. Archive eligible sources with moved notices after their consumers are gone. Keep public compatibility endpoints where required. Preserve excluded repos and honest device/provider/product deferrals. Do not turn retirement into a new architecture project.

### Execution discipline

- Prefer a few substantial working PRs/commits over many tiny approval/review cycles. Keep implementation local until the complete relevant candidate has been verified and independently reviewed; fix the findings together before publication. Never bypass required checks.
- Run relevant checks while changing a product, then one integrated verification of the finished migration candidate before its cutover. Existing successful exact-source evidence can be reused. Re-run only what subsequent edits invalidate.
- Preserve immutable artifacts across build/upload/processing/promotion. Do not rebuild merely because an external service is still processing or a later stage retries.
- Keep independent tests parallel within the measured resource budget. Cache by product, OS, architecture, toolchain and lockfiles; never cache credentials or personal data.
- The agent handles worktrees, routine implementation choices, fixes, PRs, merges, verification, docs and retirement within the authorized scope. Ask the owner only for unavoidable account/legal/hardware steps, unknown factual assertions or a real purchase/material tradeoff, prepared in one concrete handoff.
- Track progress by working capabilities and remaining blockers, not by how many files were moved. The first useful milestone is getting back to app work; final repository housekeeping comes afterward.

No fixed hour promise before the environment probes and current homelab merge. The fastest path is preserving what works, proving the changed integration, and deferring optional redesign.

## 14. Old repos and the real meaning of “three repos”

The intended **active-development** set is dotfiles, WWW and Homebrew tap. Archived sources may remain for historical value; they do not create another active source authority.

- `apps`: archive after Tendr/Air Miles/skills/shared release import, issue/settings migration and public Pages compatibility are complete. If its Pages endpoint is the temporary bridge, retain exactly that publication role until URLs are safely migrated.
- `folding`: transfer open issues after destination is private, explicitly resolve/rebase the Penpot PR, preserve closed PR/issue history and immutable artifacts/reservation readers. Archive only when no ledger/assets writer depends on it.
- `callkeep`: save historical release maxima/artifacts privately; replace public tap entry with authenticated private artifact recipe; install transition build; disable old source pipeline and public updater. Make old repo private/archived at cutover. No public release host remains necessary.
- `homelab`: archive only after all hosts use the new scoped remote/ref and new CLI can resume/recover preserved setup state. No old source fetch or bootstrap requirement may remain.
- `homelab-cli`: archive after packaged private CLI/helper, update/schema/help/install references and saved-state compatibility work. Old public installs will need the Homebrew upgrade; an offline known-good recovery copy remains available.
- `folding-signing` and `certificates`: archive only after encrypted signing branches and readonly signed archives prove the new storage. Do not revoke certificates to retire a repo.
- `homebrew-tap`: keep, preserving unrelated entries and versioned installation recipes. No token/binary/source history accidentally published here.
- `dotfiles`: keep separate and unchanged by this migration; update development-path references only if discovered/needed. This scope does not imply importing every unrelated personal project.

Recommend archiving first, **not deleting repositories during cutover**. History imports do not migrate PRs/issues/attachments/releases/assets/settings/secrets/package access or redirects. Deletion can remove private forks and is not universally recoverable. After a retention/check period, an explicit cleanup can delete truly redundant repos only when all valuable history/evidence/assets/URLs/worktrees and recovery paths are accounted for. [Archiving](https://docs.github.com/en/repositories/archiving-a-github-repository/archiving-repositories), [issue transfers](https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/transferring-an-issue-to-another-repository), [deletion](https://docs.github.com/en/repositories/creating-and-managing-repositories/deleting-a-repository).

## 15. Final verification and rollback

Run relevant checks during implementation, then one integrated verification pass of the finished candidate, fixing failures before its handover. Reuse valid exact-source results and repeat checks only when subsequent changes invalidate them:

- Clean source setup; all generated native targets build with their pinned toolchains. Test actual domain/persistence/integration suites, not just package discovery.
- Tendr historical data/core/fixture captures; Air Miles import/demo; Folding storage/background/Shortcuts/contracts/localization/native/Rust/Wasm/workerd/release tests; Callkeep recording/persistence/private upgrade/native/universal checks; Control Center Rust/Swift contract/native/container tests; homelab/CLI/Nix/controller/configuration/recovery checks.
- Selection fixture scenarios plus real docs/native/backend/site/infra/tooling changes. Required gate fails selected failures/cancellations. No unrelated binary upload, backend deploy or host activation.
- Repeated same-version Folding betas get unique builds; reruns reuse bytes; TestFlight/store/staging reservation races are safe. Native A failed release followed by docs B resumes A honestly. Apple group/version/source readback and appropriate review/availability states recorded.
- Control Center deploy ordering survives a lower/new workflow counter and rejects stale authorities; live digest/revision/health confirmed. App deployment cannot reinstall shared home backups. SQLite/media, single worker and independent home services remain intact.
- CLI rebind preserves approved setup/keys/profiles; exact deployed ref/commit matches verification; reboot/unattended startup and recovery succeed without dependence on its own broken runner.
- Authorized private Homebrew install/upgrade, unauthorized uncached rejection, artifact modes/symlinks/signature/notarization, current-user data preserved and CLI aliases/helper consistent. No public Callkeep endpoint/embedded token required.
- Private capture artifacts accessible to the owner, synthetic only; exact source/display/store checksum evidence. Real guest posture control and keychain/VM/registration cleanup proved.
- Public sites/legacy privacy/support URLs and retained Cloudflare Access/login/routes remain usable; encrypted state/backup restore and scoped credential access proved.

Rollback changes **authority and artifacts**, not user history: disable new publishers/promotions, drain operations, restore previous known-good config/handler and immutable artifact, and verify health. Do not overwrite newer data with a stale database or remove processed Apple builds. Keep old routes disabled but recoverable until new delivery is proven; only one writer is enabled for each ledger/state/deployment.

## 16. Review and pending discovery

Completed an initial and a final independent **Astra** review. The plan incorporates corrections for deployment generations, same-version Folding records, verified-candidate reconciliation, cross-channel allocation, backup ownership, private distribution, durable receipts, protected/ordered homelab promotion and enrollment/rebind candidate pinning. The final reviewer found the revised direction coherent after those amendments; no additional broad planning ceremony is required. A separate architecture exploration, using Matt Pocock's architecture/design guidance, confirmed the setup/runtime, selection/evidence and infrastructure/code-deploy separation. These are plan reviews, not passing implementation or production tests. The owner subsequently confirmed the execution priorities: independent preparation now; existing pipelines first; substantial working batches; relevant checks during development plus integrated final verification; artifact reuse; resume app work before optional cleanup and retirement. This priority update preserves the reviewed safety and identity requirements.

Specific discovery still required at execution is not an invitation to a large owner questionnaire: final merged homelab/CLI SHAs, actual profile/toolchain capability, private-plan/Pages compatibility, installed host/generation/key state, current Apple status/build maxima, actual private Homebrew artifact behavior, GitHub App/GHCR/signing permissions and all still-active work. Discover and resolve routine facts autonomously. Ask only if an actual purchase/legal/account action or material unresolved product tradeoff remains.

No migration, visibility change, external publication, infrastructure apply, credential lookup, repo deletion or app release has been executed by this planning work.



### Owner update: branch protections

The owner explicitly declined GitHub branch protections and a GitHub Pro upgrade during execution.
This supersedes earlier server-enforced protection prerequisites in this plan and its review history.
Retain CI checks, reviewed publication, exact-source provenance, scoped credentials, compare-and-swap
promotion, stale-source rejection and enrollment coordination in automation. Repository privacy remains
mandatory before private history is published. Direct pushes can bypass the automation; GitHub will
not enforce these gates on the selected account plan. This decision removes the account-upgrade blocker.
