# WWW-81 native grid interaction evidence

`before-home.png` is the retained HomeView XCTest attachment from
[unsigned simulator run 41317393140](https://github.com/0x63616c/world-wide-webb/actions/runs/41317393140),
source `3efac630fed62576688f85fc8e83f33e64b5886b`. Its native source tree is
identical to WWW-81's starting commit. The 12.9-inch iPad simulator is
1366×1024 points; XCTest exports the original PNG and orientation metadata.
The image is preserved unchanged.

The baseline's Fan Off/Auto/On labels are display-only; the Lamps bar is also
noninteractive. The new `GridInteractionTests` records Home, the fan selection,
the failure banner, and three repeated full-screen Fan presentations as retained
XCTest attachments. Native validation and after captures are pending.

Local checks so far:

- `bun run lint:tracked`: exit 0.
- `bun run knip`: exit 0.
- `bunx vitest run features/ctrl/api.test.ts features/ac/enforcer.test.ts --maxWorkers 4`:
  exit 0, 129 tests passed.
- `python3 -B .github/scripts/apple-prototype-changes-test.py`: exit 0, 6 tests.
- `python3 -B .github/scripts/apple-prototype-unit-schemes-test.py`: exit 0, 2 tests.
- `git diff --check`: exit 0.

This Linux box has no Swift/Xcode, so native compile, unit tests and UI tests
must run on the existing macOS GitHub Actions runners. No native test is claimed
as passing until that evidence is available.
