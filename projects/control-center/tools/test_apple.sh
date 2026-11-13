#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bash tools/test_canvas_layout.sh
out="${APPLE_DERIVED_DATA:-${TMPDIR:-/tmp}/www-apple-derived}"
mkdir -p "$out"
stamp=$(date -u +%Y%m%dT%H%M%SZ)-$$
destinations=$(
  python3 - << 'PY'
import json,re,subprocess
sdk=tuple(map(int,subprocess.check_output(['xcrun','--sdk','iphonesimulator','--show-sdk-version'],text=True).strip().split('.')))
sdk=sdk+(0,)*(3-len(sdk))
devices=json.loads(subprocess.check_output(['xcrun','simctl','list','devices','available','--json'],text=True))['devices']
choices=[]
phones=[]
for runtime,rows in devices.items():
    match=re.search(r'\.iOS-(\d+(?:-\d+)*)$',runtime)
    if not match:continue
    version=tuple(map(int,match[1].split('-')))
    version=version+(0,)*(3-len(version))
    if version<(26,) or version>sdk:continue
    for row in rows:
        if row.get('isAvailable'):
            if row['name'].startswith('iPad'):choices.append((version,row['name'],row['udid']))
            if row['name'].startswith('iPhone'):phones.append((version,row['name'],row['udid']))
if not choices:raise SystemExit('Install an iPad simulator for the selected Xcode SDK.')
if not phones:raise SystemExit('Install an iPhone simulator for the selected Xcode SDK.')
print(max(choices)[2],max(phones)[2])
PY
)
read -r simulator phone_simulator <<< "$destinations"
xcodegen generate --spec apple/project.yml --project apple > "$out/generate.log"
args=(-project apple/WorldWideWebb.xcodeproj -scheme Panel -destination "id=$simulator"
  -derivedDataPath "$out" CODE_SIGNING_ALLOWED=NO -parallel-testing-enabled NO)
xcodebuild "${args[@]}" build-for-testing > "$out/build.log" 2>&1 || {
  tail -50 "$out/build.log"
  exit 1
}
xcodebuild "${args[@]}" test-without-building -only-testing:PanelTests \
  -resultBundlePath "$out/unit-$stamp.xcresult" > "$out/unit.log" 2>&1 || {
  python3 - "$out/unit.log" << 'PY'
import sys
from pathlib import Path
for line in Path(sys.argv[1]).read_text().splitlines():
    if ": error:" in line or "Failing tests:" in line:
        print(line)
PY
  tail -20 "$out/unit.log"
  exit 1
}
xcodebuild -project apple/WorldWideWebb.xcodeproj -scheme Panel -destination "id=$phone_simulator" \
  -derivedDataPath "$out" CODE_SIGNING_ALLOWED=NO -parallel-testing-enabled NO \
  test-without-building -only-testing:PanelTests/PanelPlatformPolicyTests \
  -resultBundlePath "$out/phone-$stamp.xcresult" > "$out/phone.log" 2>&1 || {
  tail -30 "$out/phone.log"
  exit 1
}
echo 'PASS: iPad production target/unit tests and iPhone platform/layout policy'
