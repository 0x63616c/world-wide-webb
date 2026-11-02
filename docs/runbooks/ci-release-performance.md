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
  Xcode and suite, then always rebuild and run their full selected suites. Simulator
  boot overlaps compilation.
- Bun caches downloaded packages; installs still validate the frozen lockfile.
- Superseded PR smoke runs cancel; signing/upload runs retain their shared lock.
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
