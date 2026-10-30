#!/bin/bash
set -euo pipefail
# Serialize simulator captures across all WWW-8 jobs on the shared mini.
if [[ -z "${WWW8_SIMLOCK:-}" ]]; then
  export WWW8_SIMLOCK=1
  exec "$HOME/bin/www8-simlock" bash "$0" "$@"
fi
export DEVELOPER_DIR=/Applications/Xcode-27.0.app/Contents/Developer
ipad=A0ECBA0E-5E14-4DE2-ACD7-7C2A5EA0AFBF
phone=BC914470-C6AF-4F53-9F85-5B0967309F68
app=co.worldwidewebb.prototype.ipad
out="$HOME/wwwebb-proto-snapshots"
mkdir -p "$out"
ipad_installed=0
[[ "${1:-}" == --ipad-installed ]] && ipad_installed=1
prepare() {
  local device="$1"
  xcrun simctl boot "$device" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$device" -b
  if [[ "$device" != "$ipad" || "${ipad_installed:-0}" != 1 ]]; then
    xcrun simctl install "$device" "$HOME/wwwebb-proto-dd/Build/Products/Debug-iphonesimulator/WorldWideWebb-iPad.app"
  fi
  xcrun simctl status_bar "$device" override --time '10:10' --dataNetwork wifi --wifiMode active --wifiBars 3 --batteryState charged --batteryLevel 100
  # SpringBoard reference so captures of the home screen are rejected.
  xcrun simctl terminate "$device" "$app" >/dev/null 2>&1 || true
  sleep 3
  xcrun simctl io "$device" screenshot "$out/.springboard-$device.png" >/dev/null 2>&1 || true
}
capture_once() {
  local device="$1" name="$2"
  shift 2
  local data marker ready=0
  data=$(xcrun simctl get_app_container "$device" "$app" data)
  marker="$data/Documents/capture-ready"
  rm -f "$marker"
  xcrun simctl launch --terminate-running-process "$device" "$app" "$@" -snapshot
  for attempt in {1..300}; do
    if [[ -f "$marker" ]]; then ready=1; break; fi
    sleep 1
  done
  if [[ "$ready" != 1 ]]; then
    echo "Capture failed: $name never reached app readiness" >&2
    return 1
  fi
  sleep 3
  xcrun simctl io "$device" screenshot "$out/sim-$name.png"
  "$HOME/bin/www8-validate-png" "$out/sim-$name.png" "$out/.springboard-$device.png"
}
capture() {
  local attempt
  for attempt in 1 2 3; do
    if capture_once "$@"; then return 0; fi
    echo "Capture retry $attempt for $2" >&2
    sleep 5
  done
  echo "Capture failed: $2 invalid after 3 attempts" >&2
  return 1
}
# Keep our own simulators serial on the shared build mini.
xcrun simctl shutdown "$phone" >/dev/null 2>&1 || true
prepare "$ipad"
capture "$ipad" home -face home
capture "$ipad" lamps -openTile lamps
capture "$ipad" clock-near -face clock -presence near
capture "$ipad" controls -face controls
capture "$ipad" nowplaying -face music
capture "$ipad" weather -face home
capture "$ipad" weather-full -openTile weather
capture "$ipad" calendar-full -openTile calendar
capture "$ipad" media-full -openTile media
capture "$ipad" video -openTile media -showVideo
capture "$ipad" sonos-rooms -openTile sonosRooms
capture "$ipad" cameras-full -openTile cameras
capture "$ipad" photos-face -openTile photos
capture "$ipad" dogwalk-tile -face controls
capture "$ipad" dogwalk-tile-running -face controls -walkRunning
capture "$ipad" dogwalk-full -openTile dogwalk
capture "$ipad" dogwalk-full-running -openTile dogwalk -walkRunning
capture "$ipad" dogwalk-remote -openTile dogwalk -walkStartedRemotely
xcrun simctl shutdown "$ipad"
prepare "$phone"
capture "$phone" iphone-home -face home
capture "$phone" iphone-home-bottom -face home -homeScrollBottom
capture "$phone" iphone-nowplaying -face music
capture "$phone" iphone-more -face controls
capture "$phone" iphone-more-bottom -face controls -homeScrollBottom
capture "$phone" iphone-liveactivity -walkActivityPreview
capture "$phone" iphone-dogwalk -openTile dogwalk
xcrun simctl shutdown "$phone"
xcrun simctl boot "$ipad"
xcrun simctl bootstatus "$ipad" -b
