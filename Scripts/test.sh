#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 Scripts/test-release-notes.py
xcodebuild -project Callkeep.xcodeproj -scheme Callkeep -destination 'platform=macOS' -derivedDataPath build build-for-testing
# These are unhosted XCTest tests. Run the built bundle directly, outside
# Documents/iCloud folders where macOS privacy prompts can block the runner.
test_directory=$(mktemp -d -t callkeep-tests)
trap 'rm -rf "$test_directory"' EXIT
ditto build/Build/Products/Debug/CallkeepTests.xctest "$test_directory/CallkeepTests.xctest"
xcrun xctest "$test_directory/CallkeepTests.xctest"
swiftc -D DEBUG -parse-as-library -target "$(uname -m)-apple-macos15.0" \
  -F "$PWD/build/SourcePackages/artifacts/sparkle/Sparkle/Sparkle.xcframework/macos-arm64_x86_64" \
  -framework Sparkle -Xlinker -rpath -Xlinker "$PWD/build/Build/Products/Debug/Callkeep.app/Contents/Frameworks" \
  Sources/Callkeep/AppUpdater.swift Sources/Callkeep/AppIdentity.swift Sources/Callkeep/AppLog.swift Scripts/UpdaterHarness.swift -o "$test_directory/updater-checks"
"$test_directory/updater-checks"
swiftc -parse-as-library -target "$(uname -m)-apple-macos15.0" \
  -F "$PWD/build/Build/Products/Debug" -framework CallkeepCore \
  -Xlinker -rpath -Xlinker "$PWD/build/Build/Products/Debug" \
  Sources/Callkeep/Playback.swift Scripts/PlaybackHarness.swift -o "$test_directory/playback-checks"
"$test_directory/playback-checks"
