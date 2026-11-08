#!/usr/bin/env python3
"""Fail closed on a different Apple toolchain; resolve a matching installed simulator."""
import argparse
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
pins = json.loads((ROOT / "tool-versions.json").read_text())


def output(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT).strip()


def resolve_device(simulator, *, create=False):
    runtimes = json.loads(output("xcrun", "simctl", "list", "runtimes", "-j"))["runtimes"]
    if not any(
        runtime["identifier"] == simulator["runtime"]
        and runtime.get("isAvailable")
        and runtime.get("buildversion") == simulator["build"]
        for runtime in runtimes
    ):
        raise ValueError("Install the pinned Duo simulator runtime; do not substitute another device.")
    devices = json.loads(output("xcrun", "simctl", "list", "devices", "available", "-j"))["devices"]
    matches = [
        device for device in devices.get(simulator["runtime"], [])
        if device.get("deviceTypeIdentifier") == simulator["device_type"]
    ]
    if not matches and create:
        # Only an explicit CI/bootstrap request creates a device; no runtime substitution.
        output("xcrun", "simctl", "create", "Folding Duo", simulator["device_type"], simulator["runtime"])
        return resolve_device(simulator)
    if not matches:
        raise ValueError("Create an iPhone Duo simulator for the pinned runtime before building.")
    return sorted(matches, key=lambda device: (device.get("state") != "Booted", device["udid"]))[0]["udid"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--create-device", action="store_true", help="Create only the missing pinned Duo simulator")
    args = parser.parse_args()
    expected = f"Xcode {pins['xcode']['version']}\nBuild version {pins['xcode']['build']}"
    if output("xcodebuild", "-version") != expected:
        raise ValueError(f"Select Xcode {pins['xcode']['version']} ({pins['xcode']['build']}) before building.")
    if output("xcodegen", "--version") != f"Version: {pins['xcodegen']}":
        raise ValueError(f"Install XcodeGen {pins['xcodegen']} before generating the project.")
    if output("xcrun", "--sdk", "iphonesimulator", "--show-sdk-version") != pins["iphonesimulator_sdk"]:
        raise ValueError("Selected simulator SDK does not match tool-versions.json.")
    if f"Apple Swift version {pins['swift']} " not in output("swift", "--version"):
        raise ValueError("Selected Swift compiler does not match tool-versions.json.")
    selected = resolve_device(pins["simulator"], create=args.create_device)
    print(f"platform=iOS Simulator,id={selected}")


if __name__ == "__main__":
    try:
        main()
    except ValueError as error:
        raise SystemExit(str(error)) from None
