#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
args=()
if [[ -n "${CALLKEEP_SIGNING_IDENTITY:-}" ]]; then
  args+=("CODE_SIGN_IDENTITY=$CALLKEEP_SIGNING_IDENTITY")
fi
if ((${#args[@]})); then
  xcodebuild -project Callkeep.xcodeproj -scheme Callkeep -configuration Release -derivedDataPath build "${args[@]}" build
else
  xcodebuild -project Callkeep.xcodeproj -scheme Callkeep -configuration Release -derivedDataPath build build
fi
printf '\nBuilt: %s/build/Build/Products/Release/Callkeep.app\n' "$PWD"
