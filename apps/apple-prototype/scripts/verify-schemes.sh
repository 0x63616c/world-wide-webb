#!/bin/bash
# Run on the mini. Build outside the shared simulator lock; test inside it.
set -uo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode-27.0.app/Contents/Developer
out="$HOME/wwwebb-proto-snapshots/${1:-scheme-verification}"
mkdir -p "$out"
/opt/homebrew/bin/xcodegen generate > "$out/generate.log" || exit 1
status=0
run_build() {
  local scheme="$1" dd="$2"
  shift 2
  xcodebuild -jobs 2 -project WorldWideWebb.xcodeproj -scheme "$scheme" \
    -derivedDataPath "$dd" CODE_SIGNING_ALLOWED=NO "$@" > "$out/$scheme-build.log" 2>&1
}
if run_build WorldWideWebb "$HOME/wwwebb-proto-mac-dd" -destination 'generic/platform=macOS' build; then
  echo 'WorldWideWebb: build PASS (scheme has no test action)'
else
  tail -40 "$out/WorldWideWebb-build.log"; status=1
fi
for scheme in WorldWideWebb-iPad WorldWideWebb-Snapshots Panel Panel-Smoke; do
  dd="$HOME/wwwebb-proto-dd"
  # A smoke-only build strips the unit-test plugin from Panel.app. Keep those
  # products independent so test-without-building always uses its own bundle.
  [[ "$scheme" == Panel ]] && dd="$HOME/wwwebb-proto-panel-dd"
  [[ "$scheme" == Panel-Smoke ]] && dd="$HOME/wwwebb-proto-smoke-dd"
  destination='platform=iOS Simulator,id=A0ECBA0E-5E14-4DE2-ACD7-7C2A5EA0AFBF'
  if ! run_build "$scheme" "$dd" -destination "$destination" -parallel-testing-enabled NO build-for-testing; then
    tail -40 "$out/$scheme-build.log"; status=1; continue
  fi
  echo "$scheme: build PASS"
  if "$HOME/bin/www8-simlock" xcodebuild -jobs 2 -project WorldWideWebb.xcodeproj \
    -scheme "$scheme" -derivedDataPath "$dd" -destination "$destination" \
    -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO test-without-building > "$out/$scheme-test.log" 2>&1; then
    echo "$scheme: test PASS"
  else
    tail -40 "$out/$scheme-test.log"; status=1
  fi
done
exit "$status"
