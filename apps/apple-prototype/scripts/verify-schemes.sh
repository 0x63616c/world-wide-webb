#!/bin/bash
# Run on the mini. Compile all schemes outside the shared simulator lock; each
# simulator test phase gets a separate short lock so the pages job can interleave.
set -uo pipefail
cd "$(dirname "$0")/.."
export DEVELOPER_DIR=/Applications/Xcode-27.0.app/Contents/Developer
out="$HOME/wwwebb-proto-snapshots/${1:-scheme-verification}"
mkdir -p "$out"
/opt/homebrew/bin/xcodegen generate > "$out/generate.log" || exit 1
status=0
destination='platform=iOS Simulator,id=A0ECBA0E-5E14-4DE2-ACD7-7C2A5EA0AFBF'
derived_data() {
  case "$1" in
    WorldWideWebb) echo "$HOME/wwwebb-proto-mac-dd" ;;
    Panel) echo "$HOME/wwwebb-proto-panel-dd" ;;
    Panel-Smoke) echo "$HOME/wwwebb-proto-smoke-dd" ;;
    *) echo "$HOME/wwwebb-proto-dd" ;;
  esac
}
for scheme in WorldWideWebb WorldWideWebb-iPad WorldWideWebb-Snapshots Panel Panel-Smoke; do
  dd=$(derived_data "$scheme")
  build_args=(-destination "$destination" -parallel-testing-enabled NO build-for-testing)
  [[ "$scheme" == WorldWideWebb ]] && build_args=(-destination 'generic/platform=macOS' build)
  if xcodebuild -jobs 2 -project WorldWideWebb.xcodeproj -scheme "$scheme" \
    -derivedDataPath "$dd" CODE_SIGNING_ALLOWED=NO "${build_args[@]}" > "$out/$scheme-build.log" 2>&1; then
    echo "$scheme: build PASS"
  else
    tail -40 "$out/$scheme-build.log"; status=1
  fi
done
# Never test stale products after a failed compilation.
[[ "$status" == 0 ]] || exit "$status"
echo 'WorldWideWebb: no test action in project.yml'
run_test() {
  local scheme="$1" phase="$2" dd
  shift 2
  dd=$(derived_data "$scheme")
  if "$HOME/bin/www8-simlock" xcodebuild -jobs 2 -project WorldWideWebb.xcodeproj \
    -scheme "$scheme" -derivedDataPath "$dd" -destination "$destination" \
    -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO "$@" test-without-building > "$out/$scheme-$phase.log" 2>&1; then
    echo "$scheme / $phase: test PASS"
  else
    tail -40 "$out/$scheme-$phase.log"; status=1
  fi
}
for scheme in WorldWideWebb-iPad WorldWideWebb-Snapshots; do
  run_test "$scheme" unit -only-testing:WorldWideWebbTests -skip-testing:WorldWideWebbTests/SnapshotRenderTests
  run_test "$scheme" render -only-testing:WorldWideWebbTests/SnapshotRenderTests
done
# UI tours launch the app repeatedly. Yield the shared lock between each tour.
while IFS= read -r test_name; do
  run_test WorldWideWebb-iPad "$test_name" "-only-testing:WorldWideWebbUITests/PrototypeUITests/$test_name"
done < <(sed -n 's/.*func \(test[A-Za-z0-9_]*\)(.*/\1/p' UITests/PrototypeUITests.swift)
run_test Panel unit
run_test Panel-Smoke smoke
exit "$status"
