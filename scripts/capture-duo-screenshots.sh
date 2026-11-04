#!/usr/bin/env bash
# Raw Duo captures, without App Store framing or a fixed pixel-size requirement.
# Usage: scripts/capture-duo-screenshots.sh <app> [output-dir] [appearance...]
# Override R_SIM_DEVICE_TYPE / R_SIM_RUNTIME to use an installed simulator.
set -euo pipefail
cd "$(dirname "$0")/.."

app=${1:?usage: capture-duo-screenshots.sh <app> [output-dir] [appearance...]}
for tool in ruby python3 xcrun xcodebuild; do
  command -v "$tool" >/dev/null || { echo "Missing $tool; run on macOS with Xcode and Ruby installed." >&2; exit 1; }
done
project=$(ruby scripts/app-config.rb "$app" project_path)
scheme=$(ruby scripts/app-config.rb "$app" scheme)
test_id=$(ruby scripts/app-config.rb "$app" duo_screenshot_test)
name=$(ruby scripts/app-config.rb "$app" name)
out=${2:-build/duo-screenshots/$app/raw}
shift $(( $# > 1 ? 2 : 1 ))
appearances=("$@")
[[ ${#appearances[@]} -gt 0 ]] || appearances=(light dark)
for appearance in "${appearances[@]}"; do
  [[ "$appearance" == light || "$appearance" == dark ]] || { echo "Unsupported appearance: $appearance" >&2; exit 1; }
done
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
work="$PWD/$work"
derived="$work/DerivedData"
udid=
worker=
cleanup() {
  if [[ -n "$worker" ]]; then kill "$worker" 2>/dev/null || true; wait "$worker" 2>/dev/null || true; fi
  if [[ -n "$udid" ]]; then
    xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
    xcrun simctl delete "$udid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

xcrun simctl list devicetypes --json > "$work/devicetypes.json"
device_type=${R_SIM_DEVICE_TYPE:-$(python3 - "$work/devicetypes.json" <<'PY'
import json, sys
matches = [d for d in json.load(open(sys.argv[1]))["devicetypes"] if "iphone duo" in d["name"].lower()]
print(matches[0]["identifier"] if matches else "")
PY
)}
[[ -n "$device_type" ]] || { echo "No iPhone Duo simulator device type found. Install Xcode 27.1+ with its iOS runtime, or set R_SIM_DEVICE_TYPE explicitly. See $work/devicetypes.json." >&2; exit 1; }
# Pin the hosted runtime: iOS 27.1 has Duo only; other iPhones use iOS 27.0.
runtime=${R_SIM_RUNTIME:-com.apple.CoreSimulator.SimRuntime.iOS-27-1}
echo "Using $device_type on $runtime"
simulator_name="$name Duo Screenshots"
# Interrupted runs can leave simulators consuming resources on a persistent runner.
# Match only our name prefix, including devices from older/unavailable runtimes.
xcrun simctl list devices --json > "$work/devices.json"
python3 - "$work/devices.json" "$simulator_name" > "$work/stale-simulators.txt" <<'PY'
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
  xcrun simctl shutdown "$stale_udid" >/dev/null 2>&1 || true
  xcrun simctl delete "$stale_udid"
done < "$work/stale-simulators.txt"
udid=$(xcrun simctl create "$simulator_name" "$device_type" "$runtime")
scripts/boot-simulator.sh "$udid" 300
python3 scripts/duo-simulator.py probe "$udid" "$work"
cp "$work/capture-notes.txt" "$work/simctl-capabilities.txt" "$work/plan.json" "$out/"
fold=$(python3 -c 'import json,sys; print("1" if json.load(open(sys.argv[1]))["mode"] == "fold" else "0")' "$work/plan.json")

xcodebuild build-for-testing -project "$project" -scheme "$scheme" \
  -destination "id=$udid" -derivedDataPath "$derived" CODE_SIGNING_ALLOWED=NO -quiet

for appearance in "${appearances[@]}"; do
  xcrun simctl ui "$udid" appearance "$appearance"
  xcrun simctl status_bar "$udid" override --time "9:41" \
    --dataNetwork wifi --wifiMode active --wifiBars 3 \
    --cellularMode active --cellularBars 4 --operatorName "" \
    --batteryState discharging --batteryLevel 100
  # Use a fresh handshake and staging directory, so old output cannot pass validation.
  capture="$work/$appearance"
  mkdir -p "$capture"
  rm -f "$work/request.json" "$work/response.json"
  python3 scripts/duo-simulator.py serve "$udid" "$work" --output "$capture" --appearance "$appearance" &
  worker=$!
  TEST_RUNNER_DUO_CONTROL_DIR="$work" TEST_RUNNER_DUO_CAN_FOLD="$fold" \
    xcodebuild test-without-building -project "$project" -scheme "$scheme" \
    -destination "id=$udid" -derivedDataPath "$derived" -only-testing:"$test_id" \
    -parallel-testing-enabled NO \
    -test-timeouts-enabled YES -default-test-execution-time-allowance 300 -maximum-test-execution-time-allowance 600 \
    -resultBundlePath "$work/DuoScreenshotTests-$appearance.xcresult" -quiet
  kill "$worker" 2>/dev/null || true
  wait "$worker" 2>/dev/null || true
  worker=
  python3 - "$capture" "$work/plan.json" "$appearance" "$out" <<'PY'
import json, pathlib, shutil, struct, sys
source, plan_path, appearance, output = sys.argv[1:]
plan = json.load(open(plan_path))
mode = plan["mode"]
poses = list(plan["displays"]) if mode in ("displays", "unmapped") else ["inner", "outer"] if mode == "fold" else ["default"]
screens = ["home", "treatment", "progress", "journal", "settings", "log-dose", "landscape-home", "landscape-progress", "landscape-log-dose"]
for pose in poses:
    for screen in screens:
        png = pathlib.Path(source) / f"{pose}-{appearance}-{screen}.png"
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
PY
done
echo "Raw Duo screenshots: $out"
cat "$out/capture-notes.txt"
