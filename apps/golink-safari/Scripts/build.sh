#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
platform=${1:-macos}
shift "$(( $# > 0 ? 1 : 0 ))"
xcodegen generate --spec "$root/project.yml" --quiet
case "$platform" in
  macos) scheme=Golink-macOS; destination='generic/platform=macOS' ;;
  simulator) scheme=Golink-iOS; destination='generic/platform=iOS Simulator' ;;
  ios) scheme=Golink-iOS; destination='generic/platform=iOS' ;;
  *) echo 'Usage: Scripts/build.sh [macos|simulator|ios] [xcodebuild arguments...]' >&2; exit 64 ;;
esac
exec xcodebuild -project "$root/Golink.xcodeproj" -scheme "$scheme" \
  -destination "$destination" -derivedDataPath "$root/build/$platform" "$@" build
