#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
platform=${1:-macos}
shift "$(( $# > 0 ? 1 : 0 ))"
xcodegen generate --spec "$root/project.yml" --quiet
case "$platform" in
  macos) scheme=Golink-macOS; destination='generic/platform=macOS' ;;
  macos-release)
    scheme=Golink-macOS; destination='generic/platform=macOS'
    set -- -configuration Release ONLY_ACTIVE_ARCH=NO CODE_SIGN_STYLE=Manual \
      CODE_SIGN_INJECT_BASE_ENTITLEMENTS=NO OTHER_CODE_SIGN_FLAGS=--timestamp "$@"
    ;;
  simulator) scheme=Golink-iOS; destination='generic/platform=iOS Simulator' ;;
  ios) scheme=Golink-iOS; destination='generic/platform=iOS' ;;
  *) echo 'Usage: Scripts/build.sh [macos|macos-release|simulator|ios] [xcodebuild arguments...]' >&2; exit 64 ;;
esac
exec xcodebuild -project "$root/Golink.xcodeproj" -scheme "$scheme" \
  -destination "$destination" -derivedDataPath "$root/build/$platform" "$@" build
