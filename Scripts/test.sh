#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
xcodebuild -project Callkeep.xcodeproj -scheme Callkeep -destination 'platform=macOS' -derivedDataPath build build-for-testing
# These are unhosted XCTest tests. Run the built bundle directly, outside
# Documents/iCloud folders where macOS privacy prompts can block the runner.
test_directory=$(mktemp -d -t callkeep-tests)
trap 'rm -rf "$test_directory"' EXIT
ditto build/Build/Products/Debug/CallkeepTests.xctest "$test_directory/CallkeepTests.xctest"
xcrun xctest "$test_directory/CallkeepTests.xctest"
