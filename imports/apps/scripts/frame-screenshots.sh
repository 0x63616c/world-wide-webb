#!/usr/bin/env bash
# Frames an app's raw captures for the App Store with RDesign's rframe (macOS only), using the
# frame list in apps/<app>/screenshots.json.
# Usage: scripts/frame-screenshots.sh <app> [raw-dir] [output-dir] [overview.png]
set -euo pipefail
cd "$(dirname "$0")/.."
app=${1:?usage: frame-screenshots.sh <app> [raw-dir] [output-dir] [overview.png]}
dir=$(ruby scripts/app-config.rb "$app" dir)
raw=${2:-build/screenshots/$app/raw}
out=${3:-$dir/fastlane/screenshots/en-US}
overview=${4:-build/screenshots/$app/overview.png}
swift run --package-path packages/RDesign -c release rframe "$dir/screenshots.json" "$raw" "$out" "$overview"
