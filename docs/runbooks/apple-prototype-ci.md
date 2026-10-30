# Apple Prototype CI

`.github/workflows/apple-prototype-ci.yml` runs on every PR and pushes to
`main` / `WWW-8-apple-prototype`. The Linux `changes` job selects native work;
`build-and-test` retains the original check name and always reports a result.
A failed or cancelled planner/suite fails that gate. An empty selection succeeds.

Four independent `macos-26` lanes preserve the previous coverage:

| Lane | Work |
| --- | --- |
| macos | Build the WorldWideWebb macOS app |
| panelkit | `swift test` (XCTest **and** Swift Testing) |
| ipad | Build WorldWideWebb-iPad and run all WorldWideWebbTests |
| panel | Build Panel and run all PanelTests |

UI test bundles were not executed by this workflow before this change and remain
in their separate workflows. No test methods are excluded within the selected
unit bundles. Matrix fail-fast is disabled so a failing lane does not cancel the
others.

After XcodeGen, a CI helper removes TestableReferences that this workflow never
executes from the generated schemes only. `-only-testing` alone still compiles
those bundles: the Panel scheme otherwise rebuilds WorldWideWebbTests and its
host on a separate runner, while the iPad scheme also builds UI automation.
The checked-in project configuration and all selected unit tests stay intact.

Each iOS lane chooses one available iPad simulator, starts booting before
compilation, runs `build-for-testing`, waits for that simulator to finish booting,
then uses `test-without-building`. XCTest parallel testing is explicitly disabled:
these unit bundles execute in roughly a minute or less, whereas launching cold
simulators dominates the previous test steps. Independent runners provide suite
parallelism without paying for extra XCTest simulator clones.

## Dependency filtering

`.github/scripts/apple-prototype-changes.py` classifies changed filenames:

- Hybrid, HybridTests, HybridUITests, NextAlarmWidget: Panel lane.
- Tests, UITests, WalkActivity: iPad lane.
- Sources, Shared, PanelKit (including test fixtures), project configuration,
  and any unknown native directory: all four lanes.
- This workflow or its helper scripts: all four lanes.
- No native changes: no macOS runners; the final gate still succeeds.

PRs compare the base SHA to the checked-out merge result. Pushes compare the
previous SHA to HEAD. A missing/zero baseline runs everything. A failed fetch or
diff fails planning rather than silently skipping work. Deleted paths are included.
When adding targets, keep the dependency map conservative; unknown paths default
to all suites. Planning runs the dependency-map tests and all 32 combinations of
planner/suite/selection outcomes for the final gate.

## Local checks

```sh
source .job.env
python3 -B .github/scripts/apple-prototype-changes-test.py
python3 -B .github/scripts/apple-prototype-unit-schemes-test.py
actionlint .github/workflows/apple-prototype-ci.yml
git diff --check
```

Native builds require macOS; Linux validation uses PR Actions runs. To compare
coverage, read both the XCTest `Executed N tests` totals and Swift Testing's
`Test run with N tests` line. Do not count repeated enclosing XCTest suite totals.

## Performance decisions

The October 30 baseline has 4–6 second Homebrew installation steps. PanelKit has
no remote Swift package dependencies, so an SPM download cache offers no benefit.
DerivedData caching is deferred: first remove serial execution and simulator
startup costs, without adding large cache transfers or compiler-cache invalidation
complexity. Build products remain local to each runner; they are reused directly
without artifact uploads/downloads.

Branch protection API returned 404 on October 30, 2026, and the active main
ruleset had no status-check rules. The original `build-and-test` name is preserved
so enabling protection later does not require a workflow redesign.
