# CI release performance

## Baseline (2026-11-02)

Native release run 41513479930 spent 20m17s building simulator products after
about five minutes of setup. The 25-minute timeout cancelled the UI tests just
after they started; signing and TestFlight upload never ran. PR run 41509647420
had already passed smoke for the identical Git tree. GitHub cache scope prevented
the PR's products from being restored by the main run. Earlier ARM jobs failed
runner acquisition twice due to GitHub capacity constraints.

## Reuse validation, not untrusted binaries

The release planner runs on Ubuntu. For a merged main commit it locates the
associated same-repository PR, a successful run of the native release workflow
for that PR's exact head, and a successful `smoke` job. It reads the checkout
commit recorded by `actions/checkout` in GitHub's job log and compares its full
Git tree with the requested release commit. Only an exact match reuses the result.
Missing logs, failed/cancelled runs, forks, unrelated workflows, and changed trees
all fall back to the full smoke suite. PRs always run smoke. No artifacts or PR
code are executed in the signing job, which builds the requested immutable source.

This removes a redundant 25-minute simulator job from an already-validated
release. It does not claim a 10x reduction in cold compilation or Apple processing.

## Avoid paying for work twice

- General CI runs on pull requests and main pushes, not both a feature-branch
  push and its PR event. Required check names and test suites are unchanged.
- Native unit/build jobs restore compiler and asset caches scoped by OS, architecture,
  Xcode and suite, including SwiftPM manifest caches, then always rebuild and run
  their full selected suites. Unit simulators start after compilation: overlapping
  startup did not establish a speed improvement on the small Intel runners.
  A follow-up Panel job (125547635631) had a cache miss yet compiled in 126
  seconds after removing early boot, versus the preceding much slower run.
  Smoke now also leaves simulator boot to XCTest after compilation.
  Cold native jobs allow 40 minutes after an observed 20-minute compile timeout;
  that is a reliability ceiling, not a claimed speed improvement.
- Bun caches downloaded packages; installs still validate the frozen lockfile.
- Superseded PR smoke runs cancel; signing/upload runs retain their shared lock.
- Simulator cache keys include the ref, preventing reservation conflicts with
  inaccessible caches from another PR. The first live save exposed this conflict
  as a warning despite the action reporting success; do not infer a cache save
  solely from a green action step.
- Simulator products are saved immediately after a successful build, before UI
  tests. A test failure or timeout no longer discards the completed compilation.
- Smoke uses the generated xctestrun file directly rather than reopening the
  project/package graph. Cold Intel smoke has enough timeout to finish; increasing
  the timeout is a reliability guard, not the performance improvement.

## Verify

Run `python3 -B .github/scripts/apple-smoke-proof-test.py` and `actionlint` before
publishing workflow changes. The planner reports the reused run ID, or explicitly
runs smoke when proof is unavailable. Compare GitHub job/step timestamps before
and after. Keep reporting queue time, compilation, testing, signing and Apple
processing separately; main being merged is not the same as TestFlight readiness.

## Delivery experiment follow-up

The two-line Wi-Fi UI change in PR #880 hit the old 25-minute smoke timeout: compilation took 15m35s and three UI tests passed before cancellation. The branch now includes the existing cache/proof changes and uses standard Apple Silicon `macos-26` runners. Earlier ARM allocation failures were capacity failures; runner availability and speed must be measured again, not assumed. All test selectors remain unchanged.

## Local iteration

Run `python3 scripts/panel-dev.py` from the worktree. It selects the single booted iPad (or use `--device UDID`), regenerates the project without cleaning, incrementally builds into `~/.local/state/world-wide-webb/ipad-build`, installs, and reopens Panel with the local server URL. Use `--server-url` to override localhost:4201. It never reads credentials or launches fixture mode. Each stage has a separate log and the last run's timings are in `panel-dev-timings.json` in the same state directory. This is the local preview loop, not a TestFlight release or a substitute for CI tests.

The smoke job additionally saves compiler intermediates, module caches and SwiftPM caches before UI tests. Restore fallback is restricted to the same runner architecture, toolchain and ref; a changed source tree still always runs build-for-testing and all selected tests. Only exact-tree products can skip compilation.

## Parallel UI validation

The serial Apple Silicon baseline (run 41641311220) compiled in 83 seconds but spent 769 seconds executing UI tests. The next experiment builds once, archives products with executable permissions preserved, and runs HomeViewLaunchTests, GridInteractionTests, NotificationHistoryTests and UpdateReadyBannerTests on four independent Apple Silicon runners. Each creates its own iPad simulator, verifies the identical Xcode toolchain, and runs only its assigned class. App launches and assertions are unchanged.

Every group must report a nonempty result with no failures or skips. The stable `smoke` check is an aggregate gate that fails if the shared build or any matrix group fails, cancels or skips. Its pinned checkout records the same source tree used by all groups; the existing exact-tree release proof remains valid. Test artifacts have group-specific names. Wall-clock improvement depends on runner availability and the slowest group; compare the complete build-to-gate interval as well as individual test steps. `apple-smoke-parallel-test.py` guards complete suite partitioning and the gate's failure cases.

The first parallel attempt exposed cold-simulator launch failures and a controls-test gesture delayed beyond the 60-second dim timer. UI runners now explicitly finish `simctl bootstatus -b` before XCTest starts. Controls tests disable the unrelated dimming overlay with the existing preference override; their assertions are unchanged and PanelReturnTests still explicitly enables idle dimming for wake coverage. No automatic retries or ignored failures are used.
