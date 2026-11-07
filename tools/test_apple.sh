#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
out="${APPLE_DERIVED_DATA:-${TMPDIR:-/tmp}/www-apple-derived}"
mkdir -p "$out"
stamp=$(date -u +%Y%m%dT%H%M%SZ)-$$
simulator=$(python3 - <<'PY'
import json,re,subprocess
sdk=tuple(map(int,subprocess.check_output(['xcrun','--sdk','iphonesimulator','--show-sdk-version'],text=True).strip().split('.')))
sdk=sdk+(0,)*(3-len(sdk))
devices=json.loads(subprocess.check_output(['xcrun','simctl','list','devices','available','--json'],text=True))['devices']
choices=[]
for runtime,rows in devices.items():
    match=re.search(r'\.iOS-(\d+(?:-\d+)*)$',runtime)
    if not match:continue
    version=tuple(map(int,match[1].split('-')))
    version=version+(0,)*(3-len(version))
    if version<(26,) or version>sdk:continue
    for row in rows:
        if row.get('isAvailable') and row['name'].startswith('iPad'):
            choices.append((version,row['name'],row['udid']))
if not choices:raise SystemExit('Install an iPad simulator for the selected Xcode SDK.')
print(max(choices)[2])
PY
)
xcodegen generate --spec apple/project.yml --project apple > "$out/generate.log"
args=(-project apple/WorldWideWebb.xcodeproj -scheme Panel -destination "id=$simulator"
      -derivedDataPath "$out" CODE_SIGNING_ALLOWED=NO -parallel-testing-enabled NO)
xcodebuild "${args[@]}" build-for-testing > "$out/build.log" 2>&1 || {
  tail -50 "$out/build.log"; exit 1;
}
xcodebuild "${args[@]}" test-without-building -only-testing:PanelTests \
  -resultBundlePath "$out/unit-$stamp.xcresult" > "$out/unit.log" 2>&1 || {
  tail -50 "$out/unit.log"; exit 1;
}
echo 'PASS: iPad production target and native unit tests'
