# Repository clean-up plan (2026-11-15)

This plan turns the 15 November repository audit into ordered, PR-sized batches. Most of the work is
deletion: stale second owners, retired features, and tests CI never runs. Structural splits come
last, after the deletions have shrunk the files involved.

## How to use this plan

- The audit read local `main` at `6c93a935` plus the uncommitted Control Center work in the main
  checkout. Nothing was built or run. Line counts are approximate.
- `origin/main` has moved since. At the start of each batch, re-run the grep named in its "Confirm
  first" line; skip any step whose target is already gone.
- One batch is one worktree and one PR: `codex/<batch-id>` from fresh `origin/main`, Conventional
  Commit title, required checks green before merge.
- `wtp add` is broken from `~/coding` until batch A5 lands. Until then use
  `git worktree add ~/.worktrees/world-wide-webb/codex/<task> -b codex/<task> origin/main`, then run
  `scripts/configure-worktree-upstream.sh` and `lefthook install --force`.
- Tick the box when the PR merges. Record anything skipped, and why, under the batch.
- Each batch lists its own check. Documentation-only batches need the formatting check, not builds.

## Status (2026-11-15)

Merged in #1097 and its follow-up. Ticked batches below are complete. These are partly done:

| Batch | Done                                                                    | Still open                                                                                |
| ----- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| A5    | Constraint documented in `.wtp.yml`, `docs/DEVELOPMENT.md`, `AGENTS.md` | The path itself: the external hourly cleanup hard-codes `~/.worktrees/world-wide-webb`.   |
| B7    | Actions pinned by commit, Python pin, Golink assertion, Minecraft       | Tendr and Callkeep `project.yml` versions: screenshots and local builds still read them.  |
| D2    | Dead tile-grid UI, mocks, protocols, photos, unread fixtures removed    | `TileFace`, `AccessoryFace` and the Hybrid faces stay until D1. No server routes removed. |
| D4    | Client code removed; watchdog crate and script deleted                  | The watchdog D1 is live and unconditional in OpenTofu; share endpoint untouched.          |
| E1    | Host package 3 to 37 tests; `stop()` waits on completion                | Sleeper injection; transport and diagnostics tests still simulator-only.                  |
| E6    | Shared harness; runtime tests split into five files                     | `sessions.test.mjs` (14 tests on one database) and the six SQL-scraping tests.            |
| G5    | Three redundant checks dropped; five never-set options inlined          | `macbook-containers` stays until C2; `publicKey` and `homeAssistantURL` options kept.     |
| H2    | Screens and controller split by file                                    | `FoldingActions` optional closures.                                                       |
| H3    | `support.rs`, `config.rs`, `admin_mutations.rs` extracted               | Route table still inside `auth_runtime::dispatch`.                                        |
| I2    | `current-state.md` rewritten; nine plans deleted                        | `docs/research/evidence/` is linked from two research documents.                          |
| I3    | Migration tooling, retired runbooks and screenshots deleted             | `tools/test_cloudflare_transport.py` kept: it tests the live Cloudflare apply step.       |

Not started, with the reason:

- **A2, C2, D5 (migrations), G1:** need the live-state checks in the table below.
- **C3:** a Folding release was in review; do this right after a completed release.
- **D1, E3, G6:** change behaviour on the wall panel and physical lights; need checking on the device.
- **C4, G2, G3, G4, E2, F1, F4, F5, H4, H5, H6, I1, I6, I7:** not yet attempted. F1 should land alone.

Found while doing the work:

- The tunnel watchdog LaunchAgent's source lived only in the deleted Control Center `deploy/mini`.
  Confirm whether it is still loaded on the Mini.
- A deployed `folding-watchdog-production` Worker and its D1 exist with no schedule. Retire them
  through OpenTofu with a state backup, then remove the module and the `migrate-d1.py` option.
- The committed `Still.xcodeproj` still names a deleted `StillSnapshots` target (see F5).
- `LiveLightsProviderTests.testPollingStartsExplicitlyAndStops` failed once in CI on timing (E2).
- Deleting a path and its `units.json` owner in one change leaves the path unmapped; add it to
  `retired_paths` or remove the owner entry in a later change.

## Decisions needed from the owner

Each has a recommended default. Batches that depend on one say so.

| ID  | Decision                                                                                    | Recommended default                                                                          | Blocks |
| --- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------ |
| D1  | Is the Folding manual release sequence (reserve, archive, submit lanes) still used by hand? | No; automatic becomes the only path, recovery lanes stay.                                    | C3     |
| D2  | Keep the root "standard iOS" delivery path shared, or move it into `projects/tendr`?        | Keep it shared, but delete every knob with no user.                                          | F2     |
| D3  | Is public Homebrew distribution of the Homelab CLI wanted?                                  | No; run it from the checkout and delete the release pipeline.                                | G2     |
| D4  | Activate or delete Folding's dormant watchdog Worker?                                       | Delete; its activation test depended on the removed staging environment.                     | D4b    |
| D5  | Will Tendr's syringe-units UI return?                                                       | No; remove the UI branches, keep the stored fields decodable.                                | D3b    |
| D6  | Keep the simulator UI and capture suites (Control Center, Tendr) for hand-run diagnostics?  | Keep a few smoke flows per product; delete capture and motion harnesses and their app hooks. | E2, E4 |
| D7  | Rewrite Git history to drop 621 MB of deleted screenshots and videos?                       | No; it changes every commit hash. Use blob filters in CI instead (A6).                       | none   |
| D8  | Keep any Control Center or Homelab historical runbook as a file rather than in Git history? | Keep none; delete completed plans and retired runbooks.                                      | I1–I3  |

## Live state to confirm before deleting

These cannot be seen from the repository. Each is a precondition for the batch named.

| Check                                                                                     | How                                                     | Batch |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----- |
| The Mini has activated a generation at or after `834dbfd2` (Penpot retirement ran).       | Read `last-success.json` on the Mini.                   | C2    |
| Nothing on the Mini is still run by hand from `projects/control-center/deploy/mini`.      | List launchd jobs and scripts installed on the Mini.    | C1    |
| How `application_routes_enabled` is supplied to Folding's production OpenTofu root today. | Read the workflow variables and the private tfvars.     | A2    |
| The schema version of the saved enrollment state for both hosts.                          | Inspect the operator-side state file; expect schema 3.  | G1    |
| The MacBook runner journal is version 3 and idle.                                         | Read the journal on the MacBook.                        | G4    |
| No Home Assistant automation calls the Control Center routes that have no Swift client.   | Search the managed HA configuration and the server log. | D2c   |
| Old Folding builds no longer call the results-share endpoint.                             | Check Worker request logs for the route.                | D4a   |

## Order

Phases A and B are independent of everything and can start now. Phase C should finish before D and
F, because it removes paths those phases would otherwise have to carry. Control Center batches (C1,
D2, E2) wait until the in-flight Control Center work in the main checkout has merged.

```text
A (wrong today) ─┐
B (plain deletes)┼─> C (second owners) ─> D (dead app code) ─> E (tests into CI)
                 │                    └─> F (CI selection)
                 └─> G (Homelab sizing) ─> H (splits) ; I (docs) any time after C
```

## Phase A: things that are wrong today

Small fixes. None needs a decision.

- [x] **A1 `fix(folding)`: site and README stop advertising widgets.**
  - Edit `projects/folding/site/src/pages.mjs` lines 7, 10, 13 and 29: remove "add a widget", "use
    widgets" and "Coming soon". Fix `projects/folding/README.md:4`.
  - Confirm first: `rg -i 'widget|coming soon' projects/folding/site projects/folding/README.md`.
  - Check: Folding site check in CI; read the built page.
- [ ] **A2 `fix(folding)`: production routes cannot default to off.**
  - In `projects/folding/infra/cloudflare/production/main.tf` make the application routes
    unconditional, or default `application_routes_enabled` to true. Fix the table in
    `infra/cloudflare/README.md:11`.
  - Precondition: the live-state check above. The plan must show no route changes.
  - Check: `tofu plan` for the production root shows no diff.
- [x] **A3 `fix(homelab)`: remove the MacBook `deployNonce`.**
  - Delete `homelab.deployNonce` from `hosts/homelab-macbook.nix:40`; the MacBook runs no services
    and the nonce only feeds the Home Assistant hash.
  - Check: Homelab Nix checks. Expect a new MacBook generation on promotion.
- [x] **A4 `docs(homelab)`: correct statements that contradict reality.**
  - `hosts/homelab-mac-mini.nix:3` ("NEVER activate this over the existing production mini") and
    `hosts/homelab-macbook.nix:38`; `docs/implementation-status.md:10`;
    `docs/restore-rehearsal.md:3-5`; `docs/management.md:3`; `docs/releases.md:41-46`.
  - Fix the three mangled URLs in `docs/current-state.md:150,176` and `docs/restore-rehearsal.md:102`.
  - The full rewrite of `current-state.md` is batch I2; this batch only removes false statements.
- [x] **A5 `fix(repo)`: `.wtp.yml` works from any checkout location.**
  - `base_dir` assumes `~/Documents/ChatGPT/world-wide-webb`. Use a location that does not depend
    on checkout depth, or document the one supported path in `docs/DEVELOPMENT.md` and `AGENTS.md`.
  - Check: `wtp add -b codex/wtp-test origin/main` from `~/coding/world-wide-webb`, then remove it.
- [x] **A6 `ci(repo)`: blob filter on full-history checkouts.**
  - 15 of 18 `fetch-depth: 0` checkouts download the whole 655 MB history. Add
    `filter: blob:none` to each, as `tendr-ci.yml` already does.
  - Confirm first: `git grep -n -A3 'fetch-depth: 0' -- .github`.
  - Check: one run of each touched workflow; compare checkout step time before and after.
- [x] **A7 `fix(callkeep)`: remove Sparkle leftovers.**
  - Delete `Resources/Sparkle-LICENSE.txt` and its project entry, the `Autoupdate` clause in
    `Scripts/sign-app.py:16`, and the Sparkle section of `docs/DEVELOPMENT.md` (lines 5, 62, 74-78).
  - Check: `scripts/dev check callkeep`.

## Phase B: deletions that need no decision

- [x] **B1 `chore(repo)`: delete orphaned root scripts.**
  - `scripts/ci/benchmark.py`, `tools/measure_runner_job.py`, `scripts/capture-snapshots.sh`,
    `scripts/import-app.sh`, `.github/scripts/apple-toolchain.py`,
    `.github/scripts/apple-toolchain-test.py`.
  - Confirm first: `git grep -n 'benchmark\.py\|measure_runner_job\|capture-snapshots\|import-app\|apple-toolchain'`
    finds only the files themselves, historical plans and `runner-controller-plan.md`.
  - Remove the matching `units.json` path entries if any.
- [x] **B2 `test(repo)`: run or delete the two unrun root tests.**
  - `scripts/test-testflight-feedback.rb` and `scripts/test-check-no-personal-email.sh` are invoked
    by nothing. Add both to the root `test-unit` job in `ci.yml`. If either fails, fix or delete it
    in the same PR and say which.
- [x] **B3 `chore(folding)`: remove unwired entrypoints and the Cursor config.**
  - First add `cargo clippy -D warnings` to `scripts/check-backend`; it currently exists only in the
    stale script. Fix any warnings it raises.
  - Then delete `backend/scripts/check`, `.githooks/`, `scripts/check-staged.py`,
    `scripts/check-support-email.py` and `.cursor/`.
  - Run `scripts/test-worker-readiness.py` in the backend job beside its siblings, or delete it.
  - Remove `projects/folding/.githooks/**` and `apps/ios/Widgets/**` from `scripts/ci/units.json`
    and the `Widgets` glob from `scripts/check-localization.py:31`. Fix `README.md:37`.
- [x] **B4 `chore(folding)`: remove dead binary assets.**
  - Delete `apps/ios/BuildTests/Fixtures/ProfilePortraits.png` and its two `project.yml` entries.
  - Delete `design/badges/legacy/` and `scripts/generate-milestone-badges.py`.
  - Downscale the six badge PNGs from 1254 px to 512 px (they are drawn at 128 pt).
  - Check: Folding native build; regenerate storefront screenshots once and compare.
- [x] **B5 `chore(tendr)`: remove orphaned screenshots and one-off tests.**
  - Delete the 13 unreferenced PNGs in `docs/screenshots/` and the byte-identical
    `dose-polish-edit-vial.png`; delete `StillUITests/PolishScreenshots.swift`.
  - Confirm first: for each file, `git grep -F <basename>` returns nothing.
- [x] **B6 `chore(homelab)`: remove dead files and duplicate fixtures.**
  - Delete `scripts/cutover.py`, `tests/test_cutover.py` and `setup-repairs/*.json`.
  - Point `cli/tests/fixtures/vm-config/comin-darwin-profile.patch` and `github_known_hosts` at the
    real files, or leave them for G3.
  - Delete `haos.enable` in `modules/homeassistant.nix:151-158`.
- [ ] **B7 `chore(repo)`: version and pin hygiene.**
  - Pin every action by commit, matching the majority style (`upload-artifact`, `download-artifact`,
    `cache`, `setup-node`, `setup-python@v5`, `setup-bun@v2`, `setup-opentofu`, `setup-go`,
    remaining `checkout@v4`/`@v5`).
  - Replace Python `"3.12"` with the `mise.toml` version in the four places it appears.
  - Format check uses two Rust toolchains (1.99.0 and 1.99.1); use the product toolchain files.
  - Tendr `project.yml` (`1.1.0`) and Callkeep `project.yml` (`1.0.12`) carry stale versions that CI
    overrides; use an obvious development placeholder. Assert Golink's two `1.0.4` literals match in
    `Scripts/check.sh`.
  - Minecraft: fix `contact.sources` in `fabric.mod.json`, pin a released Loom, move the Jade
    version into `gradle.properties`.

## Phase C: retire stale second owners

- [x] **C1 `refactor(control-center)`: delete `deploy/`, keeping the one live script.**
  - `deploy/mini/publish-apple-release.py` is run by `apple-panel-testflight.yml:104`. Move it (and
    its test) to `projects/control-center/tools/` and update the workflow.
  - Delete the rest of `deploy/mini` and `deploy/penpot` (about 3,900 lines, 9 test files).
  - Remove `deploy/mini/**` from `tools/check` (ops discovery), `tools/ci_changes.py:51,110`,
    `tools/test_ci.py` and `scripts/ci/units.json` (around lines 205 and 598-606). Fix
    `CODEBASE_OVERVIEW.md:19`.
  - Preconditions: the Mini check above; in-flight Control Center work merged.
  - Check: `scripts/dev check control-center`; one TestFlight publish run still succeeds.
- [ ] **C2 `refactor(homelab)`: finish the Penpot retirement.**
  - Delete `services/penpot/`, `host/src/probes/penpot-services.mjs`, the Penpot branches in
    `host/src/health.rs`, the `penpot` scope in `scripts/backup.py`, `snapshot.py`,
    `backup_publish.py`, `nas-upload.py`, and the entries in `modules/backups.nix`,
    `modules/secrets.nix`, `modules/containers.nix` and `flake-outputs.nix:403,415`.
  - Delete `retire_penpot` in `scripts/stateful-activation.py:42-84`, its special case in
    `scripts/deployment_plan.py:52`, and their tests.
  - Keep the read side of `scripts/verify-backup.py` only if old Penpot archives must stay
    verifiable; say which in the PR.
  - Remove the two secret keys in a separate SOPS edit.
  - Precondition: the Mini generation check above.
  - Check: `scripts/dev check homelab`; one promotion to the Mini and one backup run succeed.
- [ ] **C3 `refactor(folding)`: automatic release becomes the only path.** Depends on D1.
  - Keep lanes CI calls (`continuous_beta`, `promote`, `screenshots`) and recovery lanes
    (`recover_archive`, `storefront_draft`, tip and signing setup).
  - Delete lanes `reserve`, `release_preflight`, `release_assets`, `archive`, `beta`, `storefront`,
    `submit` and `local_check`, with the non-preview archive branch (`release_operations.rb:658`),
    the `final:` preflight and evidence mode (`release_manifest.rb:648-680`) and the evidence
    branches at `release_operations.rb:889,941`.
  - Merge `preview_prerequisites!` and `live_prerequisites!` and the two identical capability lists
    in `release-config.json`. Collapse `historical_repository`. Stop stripping the four retired
    variables in `backend_delivery.rb:31-36` once the stored configuration no longer has them.
  - Rewrite `fastlane/RELEASE.md` to describe the one path.
  - Timing: start right after a successful release, so the next release proves the result.
  - Check: Folding Fastlane tests; one full automatic release.
- [ ] **C4 `refactor(homelab)`: one writer for the `control/homelab` journal.**
  - Today `scripts/homelab/promotion.py` and `cli/src/deployment_lease.rs` (775 lines) both validate
    and compare-and-swap the same state.
  - Replace the Rust lease with a read-only check that `deploy/homelab` equals the approved
    revision, re-checked immediately before activation. Remove lease and pending handling from both
    sides if nothing else needs them; then review whether the twice-hourly cron is still needed.
  - Before starting, write down the race the lease closed (a newer promotion landing mid-install)
    and confirm the re-check covers it.
  - Check: CLI and `scripts/homelab` tests.

## Phase D: dead code in shipping apps

- [ ] **D1 `refactor(control-center)`: one navigation shell.**
  - Route `module/<x>` deep links and `openNativeAlarms` through `PanelShellState.open(appID)`, as
    `openTimer` already does (`PanelNotifications.swift:64-72`).
  - Delete the native-module branch in `PanelApp.swift:128-157` and `selection`/`detail` from
    `PanelNavigation`.
  - Check: on the simulator, tap a lights notification and run one alarm ring and edit flow.
  - This must land before D2; it is what keeps the tile faces referenced.
- [ ] **D2 `refactor(control-center)`: delete the prototype tile-grid home.**
  - D2a: delete `HomeGlassFace`, `HomeFaceGrid`, `FacePicker`, `PhoneFaceBar`, `TileFace` and
    `AccessoryFace` from `HomeView.swift`; `MixedHomeTile.swift`, `HomeGridMore.swift`,
    `CompactFace.swift`, `Apps/ArtWallpaper.swift`, `FixtureClock.swift`, `HomeFaceLayout.swift`;
    the grid types in `HomeGrid.swift` (keep `ModuleStatusFace`, `GridClock`, `Cap`,
    `GridCardInteraction` in a small file); `Wallpaper` and `LampsBackdrop` in `Design.swift`; the
    tile members of `PanelHomePresentation` and `HomeIntegration`; and the tests that pin them
    (`HomeViewIntegrationTests`, `HomeFaceLayoutTests`). Let the compiler confirm each removal.
  - D2b: delete `MockHomeDataSource`, `prototypeScreen`, the six single-conformer provider
    protocols and their mocks, and `HomeDataSourceTests`. Rename `fixtureTime` to `panelTime`.
    Remove the `"Fixture data"` and `"fixture-password-123"` defaults.
  - D2c: delete the `LakeWallpaper`, `ForestPhoto` and `CoastPhoto` image sets. Remove the PanelKit
    fixtures folder from the `Panel` target's resources for Release (`project.yml:33-35`) and delete
    `Fixtures/cameras`, `reminders` and `media`. After the HA check above, delete server routes with
    no client: `/api/v1/settings`, `/notifications/stream`, `/diagnostics`, `/weather/daily`.
  - Check after each: `scripts/dev check control-center`; launch on the iPad simulator and open
    every launcher app once.
- [x] **D3 `refactor(tendr)`: remove unreachable features.**
  - D3a: delete `Features/Discover/` and the `assistantPreview` flag with its `PrivacyView` section.
  - D3b (depends on D5): remove the `syringeUnits` UI branches in `Editors.swift` and
    `JournalView.swift`. Keep the Codable fields so existing journals decode; add a test that
    decodes a journal containing them.
  - Check: `scripts/dev check tendr`.
- [ ] **D4 `refactor(folding)`: remove retired-feature code.**
  - D4a: delete `CompetitionWireResult`, `CompetitionWireShare`, `results(kind:cursor:)` and
    `share(periodID:)` in `CompetitionAPI.swift:175-216`; `InformationSheet`; the summary-card
    customisation in `FoldingPresentation.swift:54-114` (keep tolerant decoding of stored keys);
    the two widget diagnostics cases. After the log check above, remove the share endpoint from
    `results_runtime.rs`.
  - D4b (depends on D4): delete `backend/watchdog/`, `scripts/generate-watchdog-config.py`,
    `infra/cloudflare/modules/monitoring` and the `monitoring_*` variables. Plan must show no
    resource changes.
  - Check: `scripts/dev check folding`.
- [ ] **D5 `refactor(homelab)`: remove the runner's test-only single-attempt mode.**
  - Make the journal `attempts: Vec<Attempt>` with one migration on load; delete `fleet_mode` and
    its roughly 15 branches in `runner/src/service.rs`; port single-attempt tests to a one-element
    fleet.
  - After the journal check above: delete the v1/v2 migration, `downgrade_idle_to_v2`, the
    `DowngradeJournal` subcommand, `boot_lease_version`, the legacy `homelab-job-` prefix and
    `legacy_growth`.
  - Check: runner tests, in particular `runner/tests/scheduler.rs`; one real job on the MacBook pool.

## Phase E: tests that CI actually runs

The rule for every batch: move Foundation-only logic into the host-tested package, and expose a
completion point instead of sleeping or yielding.

- [ ] **E1 `test(folding)`: host-test the app logic.**
  - Extend root `Package.swift` to compile `FoldingPresentation.swift`, `AppUpdatePolicy`,
    `MilestoneCache` and the `CompetitionTransport` logic that does not need DeviceCheck.
  - Move `PresentationTests`, `AppUpdatePolicyTests`, `FoldingDiagnosticsTests` and most of
    `MilestoneModelTests` to `HostTests`; delete the three duplicated tests in `BuildTests`.
  - Inject a sleeper into the `TrackingRuntime` retry; remove the 1.2 s and 6 s sleeps in
    `AppIntegrationTests`. Delete `LeaderboardLoadingSnapshotTests` or move it to a diagnostic.
  - Fix `PrivateSyncCoordinator.stop()` so cancellation cannot spin (`:112-120`).
- [ ] **E2 `test(control-center)`: host-test providers; providers expose completion.** After D2.
  - Return the mutation task from `send(_:)` in the Lights, Sonos, Climate, Fan and Alarms
    providers, as `LiveTeslaProvider.submitAndWait` does. Replace the wait loops in the 14 test
    files with awaits.
  - Delete `startPolling(every:)` and `pollingTask` from the four providers and delete
    `SyncCoordinator` with its tests. Put one interval table and an injected sleeper in
    `LiveHomeDataSource`, and test that. Remove the duplicate alarms cadence in `PanelApp.swift`.
  - Extend the `PanelLogic` source lists so the remaining providers, `CalendarDayLayout`,
    `PanelTimeZone` and notification logic run in `tools/check apple`.
  - Per D6: delete capture and motion UI tests with `HybridCapture`, `NotificationCapture` and their
    launch arguments; keep a small smoke set.
- [ ] **E3 `fix(control-center)`: alarms are not fetched every second.**
  - Poll at the normal module interval and reconcile ringing locally from `nextFireAt`.
  - Check: an alarm set one minute ahead rings on time on the simulator.
- [x] **E4 `test(tendr)`: port logic regressions out of the UI suite.**
  - Move unit switching and the kilogram double-conversion checks into `Tests/TrackingTests.swift`.
  - Per D6: keep `ScreenshotTests`, `DuoScreenshotTests/testMainScreens` and a few smoke tests.
- [x] **E5 `test(golink-safari)`: required check makes no network request.**
  - Keep the offline legs of `Tests/WebKitSmoke.swift`. Decide the "ordinary search is allowed" case
    at policy time rather than loading Google. Replace the fixed 2 s sleep with awaiting the first
    `ensure-redirect-rules` reply.
- [ ] **E6 `test(folding)`: split `runtime.test.mjs`.**
  - Extract `tests/harness.mjs` (shared with `milestones.test.mjs`). Split by area: auth, lifecycle,
    admin, policy, bots. Replace the six tests that regex SQL out of Rust source with requests
    through the Worker against the migrated schema.
  - Check: test count is unchanged or higher before and after.

## Phase F: CI selection and the shared iOS path

- [ ] **F1 `ci(repo)`: one selector.**
  - `ci.yml`'s `changes` job already computes the selection. Pass its outputs to the product
    workflows as inputs and remove the per-product `./.github/actions/select` re-runs.
  - Have `control-center-ci.yml` consume shared outputs; delete `tools/ci_changes.py`,
    `tools/test_ci.py` and the all-false "compatibility" receipt in `scripts/ci/dispatch.py`.
    Publish one receipt artifact name; update `apple-panel-testflight.yml`, `cloudflare.yml` and
    `deploy-mini.yml` to read it.
  - Remove `retired_paths` entries for paths that cannot reappear, and the `airmiles` and `samplr`
    cases in `scripts/ci/test_select.py`, `test_standard_gate.py` and `scripts/test-changed-apps.py`.
  - Risk: this is required-check plumbing. Land it alone, and verify with one PR per product that
    the same jobs are selected as before.
- [x] **F2 `ci(tendr)`: Tendr CI runs Tendr checks only.** Depends on D2 (decision).
  - Remove from `tendr-ci.yml` everything `ci.yml` already runs (actionlint, `scripts/ci` tests,
    `check-release.rb`, `test-changed-apps.py`) and the tests that belong elsewhere
    (`scripts/distribution`, `ghcr-login/test_login.py`).
  - Make root test discovery glob-based so a new test file runs without editing a workflow; settle
    on one naming convention.
  - Delete unused knobs: `uses` and `paths` in `app.yml` and `scripts/affected`, `--only`,
    `snapshot_test`, the "legacy repos" fallback, `check-app-backends.py` if no app has a backend.
  - If `scripts/affected` then only answers "did Tendr change", replace it with the shared selector.
- [x] **F3 `refactor(tendr)`: fold `RDesign` into the app.**
  - Move the views the app uses into `Still/Design/`; delete the unused API (`RFont`, `rEyebrow`,
    `rRow`, `RSplash`, unused tokens); collapse the `Theme` alias layer.
  - Keep `rframe` and `FrameConfig` as a small tool-only package; update
    `scripts/frame-screenshots.sh` and `screenshots.yml`. Delete the `rdesign` CI job and selector
    output.
- [ ] **F4 `refactor(sites)`: publish Tendr's site directly.**
  - Point Wrangler at `projects/tendr/site`; delete `sites/index.html`, `.nojekyll` and `.pages`;
    reduce `build-site.sh`, `publish-site.sh` and `site.yml` to what one static directory needs.
    Update `docs/NEW-APP.md:12`.
  - Check: publish once and load the privacy and support pages.
- [ ] **F5 `chore(tendr,callkeep)`: stop tracking generated Xcode projects.**
  - Untrack both `.xcodeproj` directories. Add `xcodegen generate` to Callkeep's `build.sh`,
    `test.sh` and release workflow. Remove the warn-only drift step in `tendr-ci.yml`.

## Phase G: Homelab sized for two hosts

- [ ] **G1 `refactor(homelab)`: schema 3 only.**
  - After the saved-state check above: delete schema 1 and 2 readers (`provisioning.rs:930`,
    `enrollment_credentials.rs:74-108`, `config.rs:251-253,523`, `comin.rs:96-103`), `cli/schema/`
    v2, `local_storage.rs` and `--profile`.
  - Move `preview` behind the existing `local-dev` feature.
- [ ] **G2 `chore(homelab)`: remove public distribution.** Depends on D3.
  - Delete `homelab-cli-release.yml`, `scripts/distribution/homelab.py` and its tests, `cli/examples`,
    `cli/CONTRIBUTING.md`. Callkeep still uses `scripts/distribution/prepare.py` and `publish.py`;
    keep those.
- [ ] **G3 `refactor(homelab)`: host binary no longer depends on the wizard crate.**
  - Move `bin/homelab-host.rs` and the target-side modules (`bootstrap*`, `comin`, `updater_gate`,
    `deploy_identity`, `host_key`, `ssh_keys`, `power`, `developer_tools`, `nix_installation`,
    `setup_report`, `enrollment_reservation`) into `host/`. The wizard depends on `host/`.
  - Add one `rust-toolchain.toml` and one Cargo workspace with a single lockfile; CI reads the
    toolchain file. Update `packages/*.nix` and `scripts/ci/units.json`; drop the
    `homelab.cli → homelab.config` dependent edge once the fileset no longer overlaps.
  - Put the real-VM rigs (`cli/tests/vm_enrollment.rs`, `vm_e2e.rs`, fixtures) behind a cargo
    feature so normal builds skip them. Keep one runner VM smoke gate.
  - Check: a wizard-only edit no longer changes either host's system derivation.
- [ ] **G4 `refactor(homelab)`: one 1Password adapter, one GitHub adapter.**
  - New `onepassword.rs` owns discovery, invocation and error mapping for the three current
    adapters; one `github::Api`; make `configuration_publish.rs` a normal module.
- [ ] **G5 `refactor(homelab)`: trim speculative Nix.**
  - Inline never-set options as constants (`containers.diskGiB`, `backups.keepLocal`,
    `backups.minFreeGiB`, `homeassistant.cpu`, `runners.jobTimeoutSeconds`,
    `monitoring.agent.publicKey`, `controlCenter.homeAssistantURL`).
  - Drop the redundant system variants in `flake-outputs.nix` (`*-monitoring`,
    `runner-linux-profile`, `macbook-containers`) and the checks that restate option values. Keep
    `deployment-inputs`, `service-assignments`, both host systems, `compose`, `sops-host-identity`
    and the `AbandonProcessGroup` assertion.
  - Decide whether `deployNonce` survives; if not, delete the option, its `/etc` file, the docs
    section and the two fixture assertions.
- [ ] **G6 `fix(control-center)`: bedroom input keyed on one value.**
  - Replace the `BEDROOM_SWITCH_INPUT_ENABLED` and `_VERIFIED` pair with the entity id alone; fail
    on a malformed value. Rename `ALARM_API_TOKEN` to match its use, in step with Homelab secrets.
  - This drives physical lights; verify on the Mini with the real switch.

## Phase H: structural splits

Mechanical, no behaviour change. Do each only after the deletions in its file have landed.

- [x] **H1 `refactor(folding)`:** split `TrackingStore.swift` into same-module extensions (capture,
      setup, daily limit, competition upload, mirror, entry deletion, diagnostics).
- [ ] **H2 `refactor(folding)`:** one file per screen from `FoldingScreens.swift`; split
      `AppController.swift` by concern; make the `FoldingActions` closures that production always
      sets non-optional.
- [ ] **H3 `refactor(folding)`:** move shared helpers out of `auth_runtime.rs` into `support.rs` and
      `config.rs`; route table in `runtime.rs`; split `admin_runtime.rs` into pages and mutations.
- [ ] **H4 `refactor(control-center)`:** move `BedroomInput` into `bedroom_input.rs`; party and
      colour maths into a submodule of `lights.rs`; break the 400–600 character statements.
- [ ] **H5 `refactor(homelab)`:** split `runner/src/tart.rs` (leases, guest preparation, boot
      diagnostics) and `service.rs` (`RuntimeConfig`, `observe_one`, `execute_effect`). After D5.
- [ ] **H6 `refactor(callkeep)`:** move the seven non-UI sources the test target recompiles into a
      library target; make `PlaybackHarness` an XCTest case; move screenshot staging out of
      `AppModel.swift`.

## Phase I: documentation

Per D8, completed plans and retired runbooks are deleted; Git keeps them.

- [ ] **I1 `docs(repo)`:** delete `docs/legacy-apps/` and `docs/migration-source/`. Reduce
      `docs/plans/` to open work; if `AGENTS.md` still needs an ownership record, replace the
      1,553-line migration progress file with a short ownership table and update the references in
      `AGENTS.md`, `CODEBASE_OVERVIEW.md`, `README.md` and the three Homelab docs.
- [ ] **I2 `docs(homelab)`:** rewrite `docs/current-state.md` as about 60 lines of present fact.
      Delete `plan.md`, `enrollment-simplification-plan.md`, `linux-runner-plan.md`,
      `runner-controller-plan.md`, `cli-extraction-plan.md`, `direct-rebuild-handoff.md`,
      `vm-validation.md`, `actual-config-validation.md`, `implementation-status.md` and
      `docs/research/evidence/`. Merge `management.md` and `setup.md`.
- [ ] **I3 `docs(control-center)`:** delete `tools/data_migration.py`, `tools/provision_runtime.py`,
      `tools/test_cloudflare_transport.py` with their tests, `docs/runbooks/mac-mini-migration.md`,
      `pg-backup.md`, `native-rust-cutover.md` and the four unreferenced screenshots. Update stale
      tRPC and Access comments.
- [x] **I4 `docs(folding)`:** cut `work-tracker.md` to current scope and open items; fold in
      `deferred-shipping-work.md`; delete or mark `work-orders.md` and `delivery-plan.md`; rewrite
      the tree in `architecture.md`; retire the widget sections in `technical/ui.md`.
- [x] **I5 `docs(tendr)`:** fix the Xcode version and test destination in `README.md:35`; correct
      the hosting statements in `app-store-readiness.md`; fix script names in `RELEASE.md`; remove
      the Discover walkthrough from `TESTING.md`; rename or delete `PLAN.md`.
- [ ] **I6 `docs(infra)`:** rewrite `infra/cloudflare/home/README.md` in the present tense; remove
      `apply_access_gate` and its two resources or record why it stays.
- [ ] **I7 `docs(repo)`:** resolve the tension in `AGENTS.md` between "root fastlane stays the shared
      delivery path" and "do not build for hypothetical future apps", using the D2 outcome.

## Not doing

- **Git history rewrite** (D7): saves about 620 MB per full clone but invalidates every commit
  reference in release evidence. A6 removes most of the CI cost.
- **A generic for the Control Center `Live*Provider` family:** shared boilerplate is 15–20 lines
  each; E2 gives the real saving.
- **Replacing the runner's GitHub client with a crate:** it is 800 lines with a tight trust and
  redaction contract.
- **Splitting `server/tests/http.rs`:** one file keeps one test binary.
- **Touching** Callkeep's `LocalTranscription` package, Golink's extension code, the Minecraft mod's
  structure, Folding's sealed CloudKit schemas and applied migrations, or Tendr's `Still` target and
  bundle identity.

## Done when

- Every batch above is ticked or has a recorded reason for being skipped.
- No test file in the repository lacks a runner.
- Each deploy, backup, release and selection process has one implementation.
- `AGENTS.md` and the product READMEs describe the repository as it is.
