#!/usr/bin/env python3
"""Fail closed on a different Apple toolchain; resolve a matching installed simulator."""
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
pins = json.loads((ROOT / "tool-versions.json").read_text())


def output(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT).strip()


expected = f"Xcode {pins['xcode']['version']}\nBuild version {pins['xcode']['build']}"
if output("xcodebuild", "-version") != expected:
    raise SystemExit(f"Select Xcode {pins['xcode']['version']} ({pins['xcode']['build']}) before building.")
if output("xcodegen", "--version") != f"Version: {pins['xcodegen']}":
    raise SystemExit(f"Install XcodeGen {pins['xcodegen']} before generating the project.")
if output("xcrun", "--sdk", "iphonesimulator", "--show-sdk-version") != pins["iphonesimulator_sdk"]:
    raise SystemExit("Selected simulator SDK does not match tool-versions.json.")
if f"Apple Swift version {pins['swift']} " not in output("swift", "--version"):
    raise SystemExit("Selected Swift compiler does not match tool-versions.json.")
runtimes = json.loads(output("xcrun", "simctl", "list", "runtimes", "-j"))["runtimes"]
simulator = pins["simulator"]
if not any(r["identifier"] == simulator["runtime"] and r.get("isAvailable") and r.get("buildversion") == simulator["build"] for r in runtimes):
    raise SystemExit("Install the pinned Duo simulator runtime; do not substitute another device.")
devices = json.loads(output("xcrun", "simctl", "list", "devices", "available", "-j"))["devices"]
matches = [d for d in devices.get(simulator["runtime"], []) if d.get("deviceTypeIdentifier") == simulator["device_type"]]
if not matches:
    raise SystemExit("Create an iPhone Duo simulator for the pinned runtime before building.")
selected = sorted(matches, key=lambda d: (d.get("state") != "Booted", d["udid"]))[0]
print(f"platform=iOS Simulator,id={selected['udid']}")
