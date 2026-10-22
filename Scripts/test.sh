#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
xcodebuild -project Callkeep.xcodeproj -scheme Callkeep -destination 'platform=macOS' -derivedDataPath build test
