#!/usr/bin/env bash
# Renders an app's component galleries (its snapshot_test in apps/<app>/app.yml) to PNG on a fresh
# iPhone 17 simulator. Regenerates XcodeGen projects first so new test files are picked up.
# Usage: scripts/capture-snapshots.sh <app> [output-dir] [only-testing id]
# Writes <output-dir>/<gallery>.png and <gallery>-<variant>.png; defaults to build/snapshots/<app>.
set -euo pipefail
cd "$(dirname "$0")/.."

app=${1:?usage: capture-snapshots.sh <app> [output-dir] [only-testing id]}
project=$(ruby scripts/app-config.rb "$app" project_path)
scheme=$(ruby scripts/app-config.rb "$app" scheme)
test_id=${3:-$(ruby scripts/app-config.rb "$app" snapshot_test)}
name=$(ruby scripts/app-config.rb "$app" name)
out=${2:-build/snapshots/$app}
derived=build/snapshots-derived/$app

if [[ -f "apps/$app/project.yml" ]]; then
  command -v xcodegen >/dev/null || brew install xcodegen
  (cd "apps/$app" && xcodegen generate --quiet)
fi

# Pin the hosted runtime: iOS 27.1 has Duo only; other iPhones use iOS 27.0.
runtime=${R_SIM_RUNTIME:-com.apple.CoreSimulator.SimRuntime.iOS-27-0}
udid=$(xcrun simctl create "$name Snapshots" com.apple.CoreSimulator.SimDeviceType.iPhone-17 "$runtime")
trap 'xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true; xcrun simctl delete "$udid" >/dev/null 2>&1 || true' EXIT
scripts/boot-simulator.sh "$udid" 300

rm -rf "$out" "$derived/snapshots.xcresult"
mkdir -p "$out"
TEST_RUNNER_SNAPSHOT_DIR="$PWD/$out" xcodebuild test -project "$project" -scheme "$scheme" \
  -destination "id=$udid" -derivedDataPath "$derived" CODE_SIGNING_ALLOWED=NO \
  -only-testing:"$test_id" -resultBundlePath "$derived/snapshots.xcresult" -quiet
ls -1 "$out"
