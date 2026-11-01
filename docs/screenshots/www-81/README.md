# WWW-81 native grid interaction evidence

These are original `XCUIScreen.main.screenshot()` XCTest attachments, preserved
without cropping, resizing or pixel edits. Their orientation metadata presents
them at 2732×2048 pixels: the wall panel's 1366×1024 points at scale 2.
All runs use explicit synthetic fixtures through the real live providers.

- `before-home.png`: [baseline run 41338215221](https://github.com/0x63616c/world-wide-webb/actions/runs/41338215221),
  source `cb26d3f241c5814dd8e2bfce43119ffe58005159`. App code is identical to
  WWW-81's starting commit `d602ef3a`; only the existing UI test's capture helper
  changes to use the whole screen. The unsigned baseline smoke suite passed.
- `after-home.png` and `after-fan-auto.png`: [run 41340782999](https://github.com/0x63616c/world-wide-webb/actions/runs/41340782999),
  source `053500df782c881d9bd68eae3fe943b8dcb61986`. The fan segment test passed:
  selecting Auto and Off releases forced circulation without opening detail.
  This fixture is cooling, so the returned label is Auto. The baseline uses
  the existing HVAC-Off fixture; its independent forced fan still reports On.
- `after-fan-rollback.png`: the failed command restores On and displays the shared
  Fan action failed banner, with Home still available.
- `after-fan-detail-0.png` through `-2.png`: three successive openings from
  that run's passing presentation test. Each controller filled the presentation,
  was centered horizontally, and returned to Home before reopening.

`app.screenshot()` incorrectly cropped these landscape captures before exporting
orientation metadata. Using the existing suites' whole-screen API fixes the
capture itself; the PNGs above need no image processing.

## Verification

Local checks (exit 0):

- `bun run lint:tracked`
- `bun run knip`
- `bun run test --maxWorkers 4`: 1,860 passed, 71 skipped.
- `bunx vitest run features/ctrl/api.test.ts features/ac/enforcer.test.ts --maxWorkers 4`:
  129 passed.
- `bun run --sequential --filter '*' typecheck`
- `bun run typecheck:config`
- `bun run apps:check`
- `python3 -B .github/scripts/apple-prototype-changes-test.py`: 6 passed.
- `python3 -B .github/scripts/apple-prototype-unit-schemes-test.py`: 2 passed.
- `bash scripts/test-deploy-www.sh`: 5 scenarios passed after merging main.
- `git diff --check`

[Native run 41335584873](https://github.com/0x63616c/world-wide-webb/actions/runs/41335584873)
passed PanelKit tests, the macOS app build, 156 iPad unit tests and 120 Panel unit
tests. [UI run 41335480691](https://github.com/0x63616c/world-wide-webb/actions/runs/41335480691)
passed all eight smoke cases, including the four new grid interaction tests.

The repeat at `41335584966` passed all new grid tests but failed two existing
Notification Center pull-down cases. Capture run `41338035061` passed those
Notification Center cases but failed startup in the new combined Off/rollback
case: the Home pager tap reached Classic before fan assertions ran. Its initial
three grid cases, including all presentation checks, passed. Test setup now
rotates the running app and checks the mounted Home bounds before tapping,
so XCTest's touch coordinates agree with UIKit after launch. The corrected setup passed all eight smoke cases in
[run 41340782999](https://github.com/0x63616c/world-wide-webb/actions/runs/41340782999).
The failed runs above are not counted as passing. The final documentation-only
commit also passed all native suites in
[run 41340854816](https://github.com/0x63616c/world-wide-webb/actions/runs/41340854816).

The Linux workspace has no Xcode. Native checks use the repo's existing unsigned
macOS CI workflows; TestFlight upload is disabled for these runs.
