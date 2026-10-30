#!/bin/bash
set -euo pipefail
export DEVELOPER_DIR=/Applications/Xcode-27.0.app/Contents/Developer
ipad=A0ECBA0E-5E14-4DE2-ACD7-7C2A5EA0AFBF
phone=BC914470-C6AF-4F53-9F85-5B0967309F68
app=co.worldwidewebb.prototype.ipad
out="$HOME/wwwebb-proto-snapshots"
mkdir -p "$out"
for device in "$ipad" "$phone"; do
  xcrun simctl install "$device" "$HOME/wwwebb-proto-dd/Build/Products/Debug-iphonesimulator/WorldWideWebb-iPad.app"
  xcrun simctl status_bar "$device" override --time '10:10' --dataNetwork wifi --wifiMode active --wifiBars 3 --batteryState charged --batteryLevel 100
 done
capture() {
  local device="$1" name="$2"
  shift 2
  xcrun simctl terminate "$device" "$app" >/dev/null 2>&1 || true
  xcrun simctl launch "$device" "$app" "$@" -snapshot
  sleep 3
  xcrun simctl io "$device" screenshot "$out/sim-$name.png"
}
capture "$ipad" home -face home
capture "$ipad" lamps -openTile lamps
capture "$ipad" clock-near -face clock -presence near
capture "$ipad" controls -face controls
capture "$ipad" nowplaying -face music
capture "$phone" iphone-home -face home
capture "$phone" iphone-home-bottom -face home -homeScrollBottom
capture "$phone" iphone-nowplaying -face music
capture "$ipad" weather -face home
capture "$ipad" weather-full -openTile weather
capture "$ipad" calendar-full -openTile calendar
capture "$ipad" media-full -openTile media
capture "$ipad" video -openTile media -showVideo
capture "$ipad" sonos-rooms -openTile sonosRooms
capture "$ipad" cameras-full -openTile cameras
capture "$ipad" photos-face -openTile photos
capture "$phone" iphone-more -face controls
capture "$phone" iphone-more-bottom -face controls -homeScrollBottom
