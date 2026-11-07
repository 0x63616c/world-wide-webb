#!/bin/bash
# Run on the build mini. Review evidence always comes from the live compositor.
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode-27.0.app/Contents/Developer}
verification_output="$HOME/wwwebb-proto-snapshots"
mkdir -p "$verification_output"
/opt/homebrew/bin/xcodegen generate > "$verification_output/generate.log"
args=(-jobs 2 -project WorldWideWebb.xcodeproj -scheme WorldWideWebb-Snapshots
      -destination 'platform=iOS Simulator,id=A0ECBA0E-5E14-4DE2-ACD7-7C2A5EA0AFBF'
      -derivedDataPath "$HOME/wwwebb-proto-dd" -parallel-testing-enabled NO
      CODE_SIGNING_ALLOWED=NO)
xcodebuild "${args[@]}" build-for-testing > "$verification_output/build.log" 2>&1 || {
    tail -60 "$verification_output/build.log"; exit 1;
}
xcodebuild "${args[@]}" -skip-testing:WorldWideWebbTests/SnapshotRenderTests \
    test-without-building > "$verification_output/tests.log" 2>&1 || {
    tail -60 "$verification_output/tests.log"; exit 1;
}
bash scripts/capture-live.sh --ipad-installed
tail -10 "$verification_output/tests.log"
