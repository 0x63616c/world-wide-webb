#!/bin/bash
set -euo pipefail
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode-27.0.app/Contents/Developer}"
udid="${1:?Pass the WWW iPad simulator UDID}"
out="${2:?Pass the capture output directory}"
bundle=co.worldwidewebb.prototype.ipad
mkdir -p "$out/screenshots"
capture() {
  local name="$1"
  shift
  xcrun simctl terminate "$udid" "$bundle" >/dev/null 2>&1 || true
  xcrun simctl launch "$udid" "$bundle" "$@"
  sleep 4
  xcrun simctl io "$udid" screenshot "$out/screenshots/$name.png"
}
capture home -face home
capture controls-lights -openTile lamps
capture climate-cool -openTile climate
capture climate-heat -openTile climate -climateMode heat
capture climate-heat_cool -openTile climate -climateMode heat_cool
capture climate-off -openTile climate -climateMode off
capture wifi -openTile wifi
capture wifi-open -openTile wifi -wifiFixture open
capture wifi-unconfigured -openTile wifi -wifiFixture unconfigured
capture clock-alarms -openTile clock
capture weather -openTile weather
capture hourly -openTile hourly
capture sound -openTile sound
xcrun simctl terminate "$udid" "$bundle" >/dev/null 2>&1 || true
xcrun simctl launch "$udid" "$bundle" -demo
xcrun simctl io "$udid" recordVideo --codec=h264 --force "$out/expand.mp4" &
record_pid=$!
trap 'kill -INT "$record_pid" 2>/dev/null || true' EXIT
sleep 21
kill -INT "$record_pid"
wait "$record_pid" || true
trap - EXIT
