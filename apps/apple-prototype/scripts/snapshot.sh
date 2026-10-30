#!/bin/bash
# Run on the mini. Reuse its booted iPad and warm derived data; never run UI tests.
set -euo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode-27.0.app/Contents/Developer}
snapshot_device=${SNAPSHOT_DEVICE:-A0ECBA0E-5E14-4DE2-ACD7-7C2A5EA0AFBF}
snapshot_dd=${SNAPSHOT_DERIVED_DATA:-$HOME/wwwebb-proto-dd}
snapshot_output=${SNAPSHOT_OUTPUT:-$HOME/wwwebb-proto-snapshots}
snapshot_started=$SECONDS
mkdir -p "$snapshot_output"
args=(-project WorldWideWebb.xcodeproj -scheme WorldWideWebb-Snapshots
      -destination "platform=iOS Simulator,id=$snapshot_device"
      -derivedDataPath "$snapshot_dd" -parallel-testing-enabled NO
      CODE_SIGNING_ALLOWED=NO)
if [[ " ${*:-} " != *" --no-build "* ]]; then
    /opt/homebrew/bin/xcodegen generate > "$snapshot_output/generate.log"
    xcodebuild "${args[@]}" build-for-testing > "$snapshot_output/build.log" 2>&1 || {
        tail -80 "$snapshot_output/build.log"; exit 1;
    }
fi
snapshot_container=$(xcrun simctl get_app_container "$snapshot_device" co.worldwidewebb.prototype.ipad data)
snapshot_documents="$snapshot_container/Documents/Snapshots"
mkdir -p "$snapshot_documents"
rm -f "$snapshot_documents/glass-check-ready"
if [[ " ${*:-} " == *" --glass-check "* ]]; then
    export TEST_RUNNER_SNAPSHOT_GLASS_CHECK=1
    (
        for ((i=0; i<180; i++)); do
            # XCTest can reinstall its host and change the data-container UUID.
            snapshot_container=$(xcrun simctl get_app_container "$snapshot_device" co.worldwidewebb.prototype.ipad data 2>/dev/null || true)
            if [[ -f "$snapshot_container/Documents/Snapshots/glass-check-ready" ]]; then
                xcrun simctl io "$snapshot_device" screenshot "$snapshot_output/home-simulator-check.png"
                exit
            fi
            sleep 1
        done
        exit 1
    ) &
    snapshot_check_pid=$!
fi
xcodebuild "${args[@]}" -only-testing:WorldWideWebbTests/SnapshotRenderTests \
    test-without-building > "$snapshot_output/render.log" 2>&1 || {
    tail -80 "$snapshot_output/render.log"; exit 1;
}
if [[ -n "${snapshot_check_pid:-}" ]]; then wait "$snapshot_check_pid"; fi
snapshot_container=$(xcrun simctl get_app_container "$snapshot_device" co.worldwidewebb.prototype.ipad data)
cp "$snapshot_container/Documents/Snapshots/"*.png "$snapshot_output/"
echo "Render loop: $((SECONDS - snapshot_started))s"
echo "PNGs: $snapshot_output"
