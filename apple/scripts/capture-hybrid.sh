#!/usr/bin/env bash
# The caller builds/installs Panel and rotates their OWN simulator to landscape.
set -euo pipefail
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode-27.0.app/Contents/Developer}
device=${1:?Pass your dedicated simulator UDID}
output=${2:?Pass your capture output directory}
app=co.worldwidewebb.theworkflowengine
mkdir -p "$output"
data=$(xcrun simctl get_app_container "$device" "$app" data)
marker="$data/Documents/hybrid-capture-ready"
capture() {
    local name=$1
    shift
    rm -f "$marker"
    xcrun simctl launch --terminate-running-process "$device" "$app" -hybridFixtures "$@"
    local ready=0
    for attempt in {1..120}; do
        if [[ -f "$marker" ]]; then ready=1; break; fi
        sleep 1
    done
    if [[ "$ready" != 1 ]]; then
        echo "Panel never rendered $name" >&2
        return 1
    fi
    xcrun simctl io "$device" screenshot "$output/$name.png"
}
for module in lights climate fan weather wifi sonos; do
    capture "$module-tile" "-moduleFlag.$module" native
    capture "$module-detail" "-moduleFlag.$module" native -hybridDetail
done
capture unavailable-web-fallback -hybridUnavailable -moduleFlag.lights native
capture default-web-board
echo 'CAPTURES COMPLETE'
