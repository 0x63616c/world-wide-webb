#!/usr/bin/env bash
# Run the real composition tests without an iOS simulator or a macOS 26 UI host.
set -euo pipefail
prototype_dir=$(cd "$(dirname "$0")/.." && pwd)
check_dir=${WWW_HYBRID_CHECK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/www-hybrid-models.XXXXXX")}
mkdir -p "$check_dir"
export DEVELOPER_DIR=${DEVELOPER_DIR:-/Applications/Xcode-27.0.app/Contents/Developer}
python3 - "$prototype_dir" "$check_dir" <<'PY'
import json
import pathlib
import sys

root, check = map(pathlib.Path, sys.argv[1:])
# TeslaProvider.swift mixes its model and views. Copy the unchanged model prefix
# into the temporary harness, so the mini's macOS 15 can run these data tests.
# All code under test and all other model/provider files are compiled directly.
tesla = (root / "Sources/TeslaProvider.swift").read_text()
marker = "\nstruct TeslaTile: View {"
assert tesla.count(marker) == 1, "Tesla model boundary changed; update the harness"
(check / "TeslaModels.swift").write_text(tesla.split(marker)[0])
paths = ["Sources/HomeDataSource.swift", "Sources/ModuleProviders.swift",
         "Sources/DogWalkProvider.swift", "Sources/WalkLiveActivity.swift", "Sources/Live",
         "Hybrid/LiveHomeDataSource.swift", "Hybrid/UnavailableHomeData.swift",
         "Hybrid/ModuleFlags.swift", "Hybrid/HybridFixtures.swift"]
sources = [{"path": str(root / path)} for path in paths]
sources += [{"path": "TeslaModels.swift"},
            {"path": str(root / "PanelKit/Tests/PanelKitTests/Fixtures"),
             "type": "folder", "buildPhase": "resources"}]
project = {
    "name": "HybridLogic",
    "packages": {"PanelKit": {"path": str(root / "PanelKit")}},
    "settings": {"base": {"SWIFT_VERSION": "6.0", "SWIFT_STRICT_CONCURRENCY": "complete",
                           "CODE_SIGNING_ALLOWED": "NO", "GENERATE_INFOPLIST_FILE": "YES"}},
    "targets": {
        "Panel": {"type": "framework", "platform": "macOS", "deploymentTarget": "15.0",
                  "sources": sources, "dependencies": [{"package": "PanelKit"}],
                  "settings": {"base": {"PRODUCT_BUNDLE_IDENTIFIER": "co.worldwidewebb.hybrid44.logic"}}},
        "PanelLogicTests": {
            "type": "bundle.unit-test", "platform": "macOS", "deploymentTarget": "15.0",
            "sources": [{"path": str(root / "HybridTests/LiveHomeDataSourceTests.swift")}],
            "dependencies": [{"target": "Panel"}, {"package": "PanelKit"}],
            "settings": {"base": {"PRODUCT_BUNDLE_IDENTIFIER": "co.worldwidewebb.hybrid44.tests"}}}},
    "schemes": {"HybridLogic": {"build": {"targets": {"Panel": "all"}},
                                "test": {"targets": ["PanelLogicTests"]}}}}
(check / "project.json").write_text(json.dumps(project, indent=2))
PY
xcodegen_bin=$(command -v xcodegen || true)
"${xcodegen_bin:-/opt/homebrew/bin/xcodegen}" generate --spec "$check_dir/project.json" --project "$check_dir"
xcodebuild test -project "$check_dir/HybridLogic.xcodeproj" -scheme HybridLogic \
  -destination 'platform=macOS' -derivedDataPath "$check_dir/DerivedData" \
  -jobs 2 -parallel-testing-enabled NO CODE_SIGNING_ALLOWED=NO
