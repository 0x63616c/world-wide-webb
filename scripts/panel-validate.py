#!/usr/bin/env python3
"""Run Panel's release UI suites locally with the CI Xcode major and runtime."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("toolchain", ROOT / ".github/scripts/apple-toolchain.py")
toolchain = importlib.util.module_from_spec(spec)
spec.loader.exec_module(toolchain)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", help="Booted iOS 26 iPad simulator UDID")
    parser.add_argument("--preflight-only", action="store_true")
    args = parser.parse_args()
    try:
        developer = toolchain.developer_dir()
    except ValueError as error:
        parser.error(str(error))
    env = dict(os.environ, DEVELOPER_DIR=developer)
    subprocess.run(["xcodebuild", "-version"], env=env, check=True)
    if args.preflight_only:
        return
    catalog = json.loads(subprocess.check_output(
        ["xcrun", "simctl", "list", "devices", "booted", "--json"], env=env, text=True))
    devices = [device for runtime, group in catalog["devices"].items()
               if f".iOS-{toolchain.XCODE_MAJOR}-" in runtime
               for device in group if "iPad" in device["name"] and device.get("isAvailable", True)
               and (not args.device or device["udid"] == args.device)]
    if len(devices) != 1:
        parser.error("Boot an iOS 26 iPad simulator (12.9-inch Pro, 6th generation matches CI), "
                     "then select it with --device if more than one is booted.")
    state = Path.home() / ".local/state/world-wide-webb/panel-validation"
    state.mkdir(parents=True, exist_ok=True)
    timings = {}
    for stage, command in [
        ("generate", ["xcodegen", "generate"]),
        ("test", ["xcodebuild", "test", "-project", "WorldWideWebb.xcodeproj", "-scheme", "Panel-Smoke",
                  "-configuration", "Debug", "-destination", f"platform=iOS Simulator,id={devices[0]['udid']}",
                  "-derivedDataPath", str(state / "derived"), "-parallel-testing-enabled", "NO",
                  "-only-testing:PanelUITests/HomeViewLaunchTests", "-only-testing:PanelUITests/NotificationHistoryTests",
                  "-only-testing:PanelUITests/UpdateReadyBannerTests", "-only-testing:PanelUITests/GridInteractionTests",
                  "CODE_SIGNING_ALLOWED=NO"]),
    ]:
        started = time.monotonic()
        log = state / f"{stage}.log"
        print(f"{stage}: {log}", flush=True)
        with log.open("w") as output:
            result = subprocess.run(command, cwd=ROOT / "apps/apple-prototype", env=env,
                                    stdout=output, stderr=subprocess.STDOUT)
        timings[stage] = {"seconds": round(time.monotonic() - started, 2), "exit_code": result.returncode}
        (state / "timings.json").write_text(json.dumps(timings, indent=2) + "\n")
        if result.returncode:
            raise SystemExit(f"{stage} failed; see {log}")
    print("Panel release UI validation passed.")


if __name__ == "__main__": main()
