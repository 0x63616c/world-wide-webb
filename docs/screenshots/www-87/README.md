# WWW-87 verification

![Backend test evidence](https://raw.githubusercontent.com/0x63616c/world-wide-webb/8cbb26048c4bb4d9cec72a8e8d30afc2a570eead/docs/screenshots/www-87/backend-tests.png)

The PNG shows actual test output rendered at 1366×1024. Native UI screenshots
remain XCTest attachments from the Panel smoke workflow; this Linux executor
has no Swift/Xcode or iPad simulator.

All build/check shells sourced `.job.env` and prepended `$HOME/.cargo/bin`.
The following checks completed with exit 0:

- `bun install --frozen-lockfile`
- `bun run check` (Biome and all workspace/config typechecks)
- `bun run lint`
- `bun run apps:check`
- `bun run knip`
- `bun run test:unit --maxWorkers=4`: 1,875 passed, 71 skipped (database contract
  suites require their test database configuration).
- `bunx vitest run features/ac/enforcer.test.ts features/ctrl/api.test.ts packages/core/test/ha-mapping.test.ts apps/api/src/__tests__/native-panel-contract.test.ts --maxWorkers=4`: 181 passed.
- `bash scripts/check-alias-parity.sh`
- `bun run test:dockerfile-manifests`
- `bash scripts/test-deploy-gate.sh`
- `bash scripts/test-deploy-www.sh`
- `bash scripts/test-build-matrix.sh`
- `node scripts/test-panel-health.mjs`
- `git diff --check`

Workflow YAML parsing and event-condition scenarios checked main push, PR,
manual release, smoke-only dispatch, shared upload locking, and receipt guards.
Actionlint 1.7.7 exits 1 on both the original and changed workflows: seven
pre-existing diagnostics (unknown `macos-26` labels and shellcheck findings in
unchanged scripts), with zero introduced diagnostics.

Swift compilation, PanelKit/PanelTests, simulator UI interaction tests, signing,
and TestFlight upload were not run here. `apple-prototype-ci.yml` runs the native
build/unit checks; `apple-panel-testflight.yml` runs GridInteractionTests and
retains screenshots before allowing an upload. Ruby/Fastlane is also unavailable
on this executor. Nothing was pushed or uploaded by the executor.
