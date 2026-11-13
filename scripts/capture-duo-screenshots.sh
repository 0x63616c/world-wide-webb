#!/usr/bin/env bash
# Raw Duo captures, without App Store framing or a fixed pixel-size requirement.
# Usage: scripts/capture-duo-screenshots.sh <app> [output-dir] [appearance...]
# Override R_SIM_DEVICE_TYPE / R_SIM_RUNTIME to use an installed simulator.
set -euo pipefail
cd "$(dirname "$0")/.."

# A processed release may recover once from a native controller timeout. Use a
# fresh child process so conditional retry handling cannot disable set -e in
# the capture, and rerun the full suite on a newly created disposable device.
if [[ -n "${RELEASE_MANIFEST:-}" && -z "${DUO_CAPTURE_ATTEMPT:-}" ]]; then
  retry_directory=$(mktemp -d "${TMPDIR:-/tmp}/duo-capture-retry.XXXXXX")
  trap 'rm -rf "$retry_directory"' EXIT
  for attempt in 1 2; do
    retry_report="$retry_directory/attempt-$attempt.json"
    if DUO_CAPTURE_ATTEMPT="$attempt" DUO_CAPTURE_REPORT="$retry_report" bash scripts/capture-duo-screenshots.sh "$@"; then
      exit 0
    else
      capture_status=$?
    fi
    if [[ "$attempt" == 2 || ! -f "$retry_report" ]]; then exit "$capture_status"; fi
    echo "Native controller timed out. Retrying the complete Duo capture on a fresh device (2/2); failed evidence is retained." >&2
  done
fi

app=${1:?usage: capture-duo-screenshots.sh <app> [output-dir] [appearance...]}
for tool in ruby python3 xcrun xcodebuild; do
  command -v "$tool" > /dev/null || {
    echo "Missing $tool; run on macOS with Xcode and Ruby installed." >&2
    exit 1
  }
done
project=$(ruby scripts/app-config.rb "$app" project_path)
scheme=$(ruby scripts/app-config.rb "$app" scheme)
test_id=$(ruby scripts/app-config.rb "$app" duo_screenshot_test)
name=$(ruby scripts/app-config.rb "$app" name)
out=${2:-build/duo-screenshots/$app/raw}
shift $(($# > 1 ? 2 : 1))
appearances=("$@")
[[ ${#appearances[@]} -gt 0 ]] || appearances=(light dark)
for appearance in "${appearances[@]}"; do
  [[ "$appearance" == light || "$appearance" == dark ]] || {
    echo "Unsupported appearance: $appearance" >&2
    exit 1
  }
done
screenshot_settings=$(python3 scripts/screenshot-build-settings.py "$app")
screenshot_xcargs=("CODE_SIGNING_ALLOWED=NO")
while IFS= read -r build_setting; do
  if [[ -n "$build_setting" ]]; then screenshot_xcargs+=("$build_setting"); fi
done <<< "$screenshot_settings"
out=$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve())' "$out")
mkdir -p "$out" "build/duo-screenshots/$app"
# A reused output directory must describe only this run, including after failure.
# Remove our capture names, preserving unrelated files in a caller-supplied folder.
for pose in inner outer default; do
  for appearance in light dark; do
    rm -f "$out/$pose-$appearance-"*.png
  done
done
for appearance in light dark; do
  rm -f "$out/default-screen-"[0-9]*-"$appearance"-*.png
done
rm -f "$out/capture-notes.txt" "$out/simctl-capabilities.txt" "$out/plan.json"
work=$(mktemp -d "build/duo-screenshots/$app/run.XXXXXX")
work=$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).resolve())' "$work")
derived="$work/DerivedData"
udid=
worker=
host_worker=
host_application_worker=
cleanup() {
  local capture_status=$?
  if [[ -n "$host_worker" ]]; then
    touch "$work/host-stop"
    kill "$host_worker" 2> /dev/null || true
    wait "$host_worker" 2> /dev/null || true
  fi
  if [[ -n "$worker" ]]; then
    kill "$worker" 2> /dev/null || true
    wait "$worker" 2> /dev/null || true
  fi
  if [[ -n "$host_application_worker" ]]; then
    kill "$host_application_worker" 2> /dev/null || true
    wait "$host_application_worker" 2> /dev/null || true
  fi
  local evidence="$out/diagnostics/${work##*/}"
  if [[ -f "$work/host-control.log" ]]; then
    if mkdir -p "$evidence"; then
      cp "$work/host-control.log" "$evidence/" || true
    fi
  fi
  if ((capture_status > 0 && capture_status < 128)) && [[ -n "${DUO_CAPTURE_REPORT:-}" && -f "$work/native-control-timeout.json" ]]; then
    cp "$work/native-control-timeout.json" "$DUO_CAPTURE_REPORT" || true
  fi
  if ((capture_status != 0)); then
    # The release job already retains raw/. Keep failed native evidence there
    # too, isolated by run and separate from the uploadable gallery.
    local item
    if mkdir -p "$evidence"; then
      for item in "$work"/*.log "$work"/*.txt "$work"/*.json "$work"/*.plist "$work"/*.xcresult "$work/light" "$work/dark" "$work/capture"; do
        [[ -f "$item" || -d "$item" ]] || continue
        cp -R "$item" "$evidence/" || echo "Could not retain $item" >&2
      done
      echo "Duo capture failed; native evidence retained in $evidence" >&2
    fi
  fi
  if [[ -n "$udid" ]]; then
    xcrun simctl shutdown "$udid" > /dev/null 2>&1 || true
    xcrun simctl delete "$udid" > /dev/null 2>&1 || true
  fi
  return "$capture_status"
}
trap cleanup EXIT

xcrun simctl list devicetypes --json > "$work/devicetypes.json"
device_type=${R_SIM_DEVICE_TYPE:-$(
  python3 - "$work/devicetypes.json" << 'PY'
import json, sys
matches = [d for d in json.load(open(sys.argv[1]))["devicetypes"] if "iphone duo" in d["name"].lower()]
print(matches[0]["identifier"] if matches else "")
PY
)}
[[ -n "$device_type" ]] || {
  echo "No iPhone Duo simulator device type found. Install Xcode 27.1+ with its iOS runtime, or set R_SIM_DEVICE_TYPE explicitly. See $work/devicetypes.json." >&2
  exit 1
}
# Match the validated Xcode 27.2 runner image; Duo uses its device-specific runtime.
runtime=${R_SIM_RUNTIME:-com.apple.CoreSimulator.SimRuntime.iOS-27-2-iPhone19-4}
echo "Using $device_type on $runtime"
simulator_name="$name Duo Screenshots"
# Interrupted runs can leave simulators consuming resources on a persistent runner.
# Match only our name prefix, including devices from older/unavailable runtimes.
xcrun simctl list devices --json > "$work/devices.json"
python3 - "$work/devices.json" "$simulator_name" > "$work/stale-simulators.txt" << 'PY'
import json, sys
with open(sys.argv[1]) as file:
    runtimes = json.load(file)["devices"]
for devices in runtimes.values():
    for device in devices:
        if device["name"].startswith(sys.argv[2]):
            print(device["udid"])
PY
while IFS= read -r stale_udid; do
  echo "Removing stale Duo screenshot simulator: $stale_udid"
  xcrun simctl shutdown "$stale_udid" > /dev/null 2>&1 || true
  xcrun simctl delete "$stale_udid"
done < "$work/stale-simulators.txt"
udid=$(xcrun simctl create "$simulator_name" "$device_type" "$runtime")
scripts/boot-simulator.sh "$udid" 300
python3 scripts/duo-simulator.py probe "$udid" "$work"
cp "$work/capture-notes.txt" "$work/simctl-capabilities.txt" "$work/plan.json" "$out/"
# A powered framebuffer is not an open foldable device. On hosted runners, use
# a macOS UI test to operate Device Hub's actual Open/Closed controls.
if [[ "${DUO_HOST_CONTROL:-0}" == 1 ]] && [[ "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["mode"])' "$work/plan.json")" == unmapped ]]; then
  echo "Building the native Device Hub controller"
  cp -R scripts/duo-host-control "$work/host-project"
  (cd "$work/host-project" && xcodegen generate --quiet)
  xcodebuild build-for-testing -project "$work/host-project/DuoCaptureHost.xcodeproj" \
    -scheme DuoCaptureHost -destination 'platform=macOS' -derivedDataPath "$work/HostDerivedData" \
    DUO_HOST_CONTROL_DIRECTORY="$work" -quiet > "$work/host-build.log" 2>&1
  codesign -d --entitlements :- "$work/HostDerivedData/Build/Products/Debug/DuoHostControlTests-Runner.app" \
    2> /dev/null > "$work/host-entitlements.plist"
  python3 - "$work" << 'ENTITLEMENTSPY'
import pathlib, plistlib, sys
folder = pathlib.Path(sys.argv[1])
with (folder / "host-entitlements.plist").open("rb") as file:
    grants = plistlib.load(file)
if grants.get("com.apple.security.app-sandbox") is not True or grants.get("com.apple.security.temporary-exception.files.absolute-path.read-write") != [str(folder) + "/"]:
    sys.exit("Native controller must retain its sandbox and have write access only to this capture directory")
print("Verified scoped capture handoff access")
ENTITLEMENTSPY
  echo "Starting the native Device Hub controller"
  # The outer app's DevicesTrampoline can publish PID -1 to AppKit/XCTest.
  # Start the actual executable on this disposable CI host, retaining only our PID.
  if pgrep -x DeviceHub > /dev/null; then
    echo "Device Hub is already running; refusing to replace another session" >&2
    exit 1
  fi
  developer_dir=${DEVELOPER_DIR:-$(xcode-select -p)}
  host_application="${developer_dir%/Developer}/Applications/DeviceHub.app"
  "$host_application/Contents/MacOS/DeviceHub" \
    > "$work/host-application.log" 2>&1 &
  host_application_worker=$!
  TEST_RUNNER_DUO_HOST_APPLICATION_PATH="$host_application" \
    TEST_RUNNER_DUO_HOST_APPLICATION_PID="$host_application_worker" \
    TEST_RUNNER_DUO_HOST_CONTROL_DIR="$work" TEST_RUNNER_DUO_HOST_DEVICE_NAME="$simulator_name" \
    TEST_RUNNER_DUO_HOST_DEVICE_ID="$udid" \
    xcodebuild test-without-building -project "$work/host-project/DuoCaptureHost.xcodeproj" \
    -scheme DuoCaptureHost -destination 'platform=macOS' -derivedDataPath "$work/HostDerivedData" \
    DUO_HOST_CONTROL_DIRECTORY="$work" -parallel-testing-enabled NO -test-timeouts-enabled NO -resultBundlePath "$work/DuoHostControl.xcresult" \
    > "$work/host-control.log" 2>&1 &
  host_worker=$!
  python3 - "$work" "$host_worker" << 'HOSTPY'
import os, pathlib, subprocess, sys, time
folder, process = pathlib.Path(sys.argv[1]), int(sys.argv[2])
for _ in range(120):
    if (folder / "host-ready").exists():
        break
    try:
        os.kill(process, 0)
    except ProcessLookupError:
        print((folder / "host-control.log").read_text()[-8000:])
        result = folder / "DuoHostControl.xcresult"
        if result.exists():
            subprocess.run(["xcrun", "xcresulttool", "get", "test-results", "summary", "--path", str(result)], check=False)
        sys.exit(f"Device Hub controller stopped; see {folder}/host-control.log")
    time.sleep(1)
else:
    print((folder / "host-control.log").read_text()[-8000:])
    sys.exit(f"Device Hub controller did not start; see {folder}/host-control.log")
HOSTPY
  python3 scripts/duo-simulator.py configure-host "$udid" "$work"
  echo "Device Hub controller ready; capturing active inner and outer displays"
fi
cp "$work/capture-notes.txt" "$work/simctl-capabilities.txt" "$work/plan.json" "$out/"
fold=$(python3 -c 'import json,sys; print("1" if json.load(open(sys.argv[1]))["mode"] == "fold" else "0")' "$work/plan.json")
host_orientation=$(python3 -c 'import json,sys; print("1" if json.load(open(sys.argv[1])).get("host_control") else "0")' "$work/plan.json")

xcodebuild build-for-testing -project "$project" -scheme "$scheme" \
  -destination "id=$udid" -derivedDataPath "$derived" "${screenshot_xcargs[@]}" -quiet

# Keep both appearances and both poses in the same XCTest/app session.
# Group by appearance to avoid repeated appearance switches; staging owns gallery order.
shots=$(
  python3 - "projects/$app/screenshots.json" "${appearances[@]}" << 'PYSHOTS'
import json, sys
shots = json.load(open(sys.argv[1]))["duo_shots"]
selected = [shot for appearance in sys.argv[2:] for shot in shots if shot["appearance"] == appearance]
if not selected:
    sys.exit("No configured Duo screenshots match the requested appearances")
print(json.dumps(selected))
PYSHOTS
)
xcrun simctl status_bar "$udid" override --time "9:41" \
  --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --operatorName "" \
  --batteryState discharging --batteryLevel 100
capture="$work/capture"
mkdir -p "$capture"
python3 scripts/duo-simulator.py serve "$udid" "$work" --output "$capture" --appearance "${appearances[0]}" &
worker=$!
TEST_RUNNER_DUO_CONTROL_DIR="$work" TEST_RUNNER_DUO_CAN_FOLD="$fold" TEST_RUNNER_DUO_HOST_ORIENTATION="$host_orientation" \
  TEST_RUNNER_DUO_CAPTURE_SHOTS="$shots" \
  xcodebuild test-without-building -project "$project" -scheme "$scheme" \
  -destination "id=$udid" -derivedDataPath "$derived" -only-testing:"$test_id" \
  -parallel-testing-enabled NO \
  -test-timeouts-enabled YES -default-test-execution-time-allowance 300 -maximum-test-execution-time-allowance 900 \
  -resultBundlePath "$work/DuoScreenshotTests.xcresult"
kill "$worker" 2> /dev/null || true
wait "$worker" 2> /dev/null || true
worker=
python3 - "$capture" "$work/plan.json" "$shots" "$out" << 'PYEXPORT'
import json, pathlib, shutil, struct, sys
source, plan_path, shots_json, output = sys.argv[1:]
plan = json.load(open(plan_path))
mode = plan["mode"]
poses = list(plan["displays"]) if mode in ("displays", "unmapped") else ["inner", "outer"] if mode == "fold" else ["default"]
for pose in poses:
    for shot in json.loads(shots_json):
        png = pathlib.Path(source) / f"{pose}-{shot['appearance']}-{shot['screen']}.png"
        if not png.is_file():
            sys.exit(f"Missing screenshot: {png}")
        data = png.read_bytes()
        if data[:8] != b"\x89PNG\r\n\x1a\n" or len(data) < 24:
            sys.exit(f"Invalid PNG: {png}")
        width, height = struct.unpack(">II", data[16:24])
        if min(width, height) <= 0:
            sys.exit(f"Empty PNG: {png}")
        print(f"{png.name}: {width}x{height}")
        shutil.copy2(png, pathlib.Path(output) / png.name)
PYEXPORT
if [[ -n "$host_worker" ]]; then
  touch "$work/host-stop"
  wait "$host_worker"
  host_worker=
fi
echo "Raw Duo screenshots: $out"
cat "$out/capture-notes.txt"
