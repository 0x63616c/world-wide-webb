#!/usr/bin/env python3
"""Incrementally build, install and reopen Panel on an already-booted iPad."""

import argparse
import json
import os
from pathlib import Path
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", help="Booted iPad simulator UDID (auto-detects one)")
    parser.add_argument("--server-url", default="http://localhost:4201")
    parser.add_argument("--state-dir", type=Path,
                        default=Path.home() / ".local/state/world-wide-webb")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    version = subprocess.check_output(["xcodebuild", "-version"], text=True).splitlines()[0]
    print(f"Preview toolchain: {version}. Release validation: python3 scripts/panel-validate.py", flush=True)
    native = root / "apps/apple-prototype"
    state = args.state_dir.resolve()
    state.mkdir(parents=True, exist_ok=True)
    derived = state / "ipad-build"
    catalog = json.loads(subprocess.check_output(
        ["xcrun", "simctl", "list", "devices", "booted", "--json"], text=True))
    devices = [device for group in catalog["devices"].values() for device in group
               if "iPad" in device["name"] and device.get("isAvailable", True)]
    if args.device:
        devices = [device for device in devices if device["udid"] == args.device]
    if len(devices) != 1:
        parser.error("Boot one iPad simulator, or select a booted iPad with --device.")
    device = devices[0]["udid"]
    started = time.monotonic()
    timings = {}

    def run(stage, command, env=None):
        begin = time.monotonic()
        log = state / f"panel-dev-{stage}.log"
        print(f"{stage}…", flush=True)
        with log.open("w") as output:
            result = subprocess.run(command, cwd=native, env=env,
                                    stdout=output, stderr=subprocess.STDOUT)
        timings[stage] = round(time.monotonic() - begin, 2)
        print(f"{stage}: {timings[stage]}s", flush=True)
        if result.returncode:
            raise SystemExit(f"{stage} failed (exit {result.returncode}); see {log}")

    # XcodeGen preserves unchanged generated files, allowing incremental builds.
    run("generate", ["xcodegen", "generate"])
    run("build", ["xcodebuild", "build", "-project", "WorldWideWebb.xcodeproj",
                  "-scheme", "Panel", "-configuration", "Debug", "-destination",
                  f"platform=iOS Simulator,id={device}", "-derivedDataPath", str(derived),
                  "CODE_SIGNING_ALLOWED=NO"])
    run("install", ["xcrun", "simctl", "install", device,
                    str(derived / "Build/Products/Debug-iphonesimulator/Panel.app")])
    env = dict(os.environ, SIMCTL_CHILD_PANEL_SERVER_URL=args.server_url)
    run("launch", ["xcrun", "simctl", "launch", "--terminate-running-process", device,
                   "co.worldwidewebb.theworkflowengine"], env=env)
    timings["total"] = round(time.monotonic() - started, 2)
    (state / "panel-dev-timings.json").write_text(json.dumps(timings, indent=2) + "\n")
    print(f"Panel reloaded in {timings['total']}s. Timings: {state / 'panel-dev-timings.json'}")


if __name__ == "__main__":
    main()
