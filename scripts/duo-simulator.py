#!/usr/bin/env python3
"""Runtime simctl capability detection and the UI-test capture/resize handshake.

Only commands advertised by the installed simctl help are attempted, on the
script's disposable simulator. Display IDs always come from enumeration. The
optional Device Hub bridge pairs native modes with Open/Closed controls; the iOS
tests independently verify the resulting layout before release export.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time


class NativeControlTimeout(ValueError):
    """The native controller did not acknowledge an issued control."""


def simctl(*args, check=False):
    timeout = float(os.environ.get("DUO_SIMCTL_TIMEOUT", "180"))
    # Cold CoreSimulator startup can stall even help (including subcommand help).
    # Only retry read-only probes; a timed-out mutation may already have applied.
    attempts = 2 if args and args[0] in ("help", "list") else 1
    for attempt in range(attempts):
        try:
            return subprocess.run(["xcrun", "simctl", *args], text=True,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  timeout=timeout, check=check)
        except subprocess.TimeoutExpired:
            if attempt == attempts - 1:
                raise


def fold_candidates(udid, help_text):
    """Known command shapes, gated on documented verbs AND state names."""
    top, ui, io, fold = (help_text.get(key, "") for key in ("top", "ui", "io", "fold"))
    candidates = []
    for help_body, prefix in [(fold, ["fold", udid]),
                              (ui, ["ui", udid, "fold"]),
                              (ui, ["ui", udid, "display"]),
                              (io, ["io", udid, "display"])]:
        verb = prefix[0] if len(prefix) == 2 else prefix[2]
        if not re.search(rf"\b{verb}\b", help_body):
            continue
        for outer, inner in [("folded", "unfolded"), ("closed", "open"), ("outer", "inner")]:
            if all(re.search(rf"\b{state}\b", help_body) for state in (outer, inner)):
                candidates.append({"outer": [*prefix, outer], "inner": [*prefix, inner]})
    if re.search(r"(?m)^\s*fold\s", top) and re.search(r"(?m)^\s*unfold\s", top):
        candidates.append({"outer": ["fold", udid], "inner": ["unfold", udid]})
    return candidates


def named_displays(output):
    """Accept explicit names only. A main/external display is not an inner/outer pair."""
    result = {}
    try:
        payload = json.loads(output)
        displays = payload.get("displays", []) if isinstance(payload, dict) else payload
        if isinstance(displays, dict):
            displays = [dict(value, id=key) for key, value in displays.items() if isinstance(value, dict)]
        for item in displays:
            name = str(item.get("name", "")).lower()
            identifier = item.get("id", item.get("displayID", item.get("identifier")))
            for pose in ("inner", "outer"):
                if re.search(rf"\b{pose}\b", name) and identifier is not None:
                    result[pose] = str(identifier)
    except (ValueError, TypeError, AttributeError):
        pass
    # simctl io enumerate traditionally emits a readable list of Display N lines.
    for line in output.splitlines():
        match = re.search(r"\bDisplay\s+(\d+)\b.*\b(inner|outer)\b", line, re.IGNORECASE)
        if match:
            result[match[2].lower()] = match[1]
    return result if set(result) == {"inner", "outer"} else {}


def integrated_displays(output):
    """Capture reported integrated screen IDs without assigning fold poses."""
    displays = {}
    for block in re.split(r"(?=^\s*Screen ID:\s*\d+\s*$)", output, flags=re.MULTILINE):
        identifier = re.search(r"^\s*Screen ID:\s*(\d+)\s*$", block, re.MULTILINE)
        if identifier and re.search(r"^\s*Screen Type:\s*Integrated\s*$", block, re.MULTILINE):
            value = identifier[1]
            displays[f"default-screen-{value}"] = value
    return displays


def probe(udid, directory):
    help_text = {"top": simctl("help").stdout}
    for command in ("ui", "io", "fold"):
        help_text[command] = simctl("help", command).stdout
    enumeration = simctl("io", udid, "enumerate").stdout
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "simctl-capabilities.txt").write_text(
        "\n\n".join(f"{key}:\n{value}" for key, value in help_text.items()) + "\n\n" + enumeration)
    for commands in fold_candidates(udid, help_text):
        outer = simctl(*commands["outer"]).returncode == 0
        inner = simctl(*commands["inner"]).returncode == 0  # restore even after a partial failure
        if outer and inner:
            plan = {"mode": "fold", "commands": commands}
            break
    else:
        displays = named_displays(enumeration)
        integrated = integrated_displays(enumeration)
        if displays and "--display" in help_text["io"]:
            plan = {"mode": "displays", "displays": displays}
        elif integrated and "--display" in help_text["io"]:
            plan = {"mode": "unmapped", "displays": integrated}
        else:
            plan = {"mode": "default"}
    (directory / "plan.json").write_text(json.dumps(plan))
    note = {
        "fold": "Fold controls accepted: capture inner and outer, and run live-fold state checks.",
        "displays": "Named inner/outer displays exposed: capture both with --display. No supported live-fold control; live-fold checks skipped.",
        "unmapped": "Integrated screen IDs exposed without inner/outer names: capture each as default-screen-<id>. No pose mapping or supported live-fold control; live-fold checks skipped.",
        "default": "No supported fold control or named inner/outer display pair. Capturing the device default only (default-*); live-fold checks skipped.",
    }[plan["mode"]]
    (directory / "capture-notes.txt").write_text(
        note + "\nLandscape filenames describe requested device orientation; inner windows and centered sheets may retain portrait geometry.\n"
        "See simctl-capabilities.txt for the installed interface.\n")
    print(note)


def configure_host(directory, set_pose=None):
    """Map reported IDs to the two known native display modes, then verify via UI tests."""
    plan = json.loads((directory / "plan.json").read_text())
    if plan["mode"] != "unmapped":
        raise ValueError("Device Hub bridge requires two enumerated integrated displays")
    text = (directory / "simctl-capabilities.txt").read_text()
    displays = {}
    expected = {(2007, 2853): "inner", (2853, 2007): "inner",
                (1398, 2034): "outer", (2034, 1398): "outer"}
    for block in re.split(r"(?=^\s*Screen ID:\s*\d+\s*$)", text, flags=re.MULTILINE):
        identifier = re.search(r"^\s*Screen ID:\s*(\d+)\s*$", block, re.MULTILINE)
        pixels = re.search(r"Pixel Size:\s*\{(\d+),\s*(\d+)\}", block)
        if identifier and pixels and re.search(r"Screen Type:\s*Integrated", block):
            pose = expected.get((int(pixels[1]), int(pixels[2])))
            if pose:
                if pose in displays:
                    raise ValueError("Ambiguous integrated Duo display modes")
                displays[pose] = identifier[1]
    if set(displays) != {"inner", "outer"}:
        raise ValueError("Expected both native Duo display modes")
    if not (directory / "host-ready").exists():
        raise ValueError("Device Hub controller is not ready")
    (set_pose or host_pose)(directory, "inner")
    (directory / "plan.json").write_text(json.dumps({"mode": "fold", "host_control": True, "displays": displays}))
    (directory / "capture-notes.txt").write_text(
        "Device Hub Open/Closed controls select each pose. Display IDs come from enumeration and their native pixel modes. "
        "The iOS tests assert native inner/outer navigation and live state retention. Blank or incorrectly sized releases are rejected.\n")


def host_pose(directory, pose):
    host_command(directory, {"pose": pose})


def host_command(directory, command):
    identifier = str(time.time_ns())
    temporary = directory / "host-request.tmp"
    temporary.write_text(json.dumps({"id": identifier, **command}))
    temporary.replace(directory / "host-request.json")
    # Native menu selection includes XCTest idle and snapshot waits. Keep a
    # slow request intact until its matching acknowledgement, within this bound.
    deadline = time.monotonic() + 120
    while time.monotonic() < deadline:
        try:
            response = json.loads((directory / "host-response.json").read_text())
            if response["id"] == identifier:
                if response.get("ok") is not True:
                    raise ValueError("Device Hub control failed")
                return
        except FileNotFoundError:
            pass
        time.sleep(0.1)
    try:
        native_tail = (directory / "host-control.log").read_text(errors="replace")[-4000:]
    except OSError:
        native_tail = "Native controller log unavailable"
    failure = NativeControlTimeout(
        f"Device Hub did not acknowledge the requested control within 120s "
        f"(request {identifier}: {json.dumps(command, sort_keys=True)}).\n"
        f"Native controller log tail:\n{native_tail}"
    )
    marker = directory / "native-control-timeout.json"
    temporary = marker.with_suffix(".tmp")
    temporary.write_text(json.dumps({"request": identifier, "control": command, "error": str(failure)}))
    temporary.replace(marker)
    raise failure


def serve(udid, directory, output, appearance):
    plan = json.loads((directory / "plan.json").read_text())
    pose = "inner" if plan["mode"] == "fold" else "default"
    request_path = directory / "request.json"
    previous = None
    host_pose_known = False
    while True:
        if not request_path.exists():
            time.sleep(0.1)
            continue
        request = json.loads(request_path.read_text())  # UI test writes atomically
        if request["id"] == previous:
            time.sleep(0.1)
            continue
        previous = request["id"]
        response = {"id": previous}
        try:
            if request["action"] == "pose":
                target = request["name"]
                if plan["mode"] != "fold" or target not in ("inner", "outer"):
                    raise ValueError(f"Unsupported pose: {target}")
                if plan.get("host_control"):
                    host_pose(directory, target)
                    host_pose_known = True
                else:
                    simctl(*plan["commands"][target], check=True)
                pose = target
                time.sleep(2)  # window/scene transition must finish before the test proceeds
            elif request["action"] == "orientation":
                orientation = request["name"]
                if not plan.get("host_control") or orientation not in ("portrait", "landscape-left", "landscape-right"):
                    raise ValueError("Native host orientation is unavailable or invalid")
                # Selecting Open/Closed resets that pose's physical orientation.
                # Choose the display first, then rotate; reselecting it afterward
                # can undo a successful landscape command back to portrait.
                # This process owns the native controls. Once a pose is acknowledged,
                # rotating it needs no extra Open/Closed click (which resets orientation).
                if not host_pose_known:
                    host_pose(directory, pose)
                    host_pose_known = True
                host_command(directory, {"orientation": orientation})
                time.sleep(2)
            elif request["action"] == "capture":
                screen = request["name"]
                if not re.fullmatch(r"[a-z0-9-]+", screen):
                    raise ValueError("Invalid screenshot name")
                displays = {pose: plan["displays"][pose]} if plan.get("host_control") else plan.get("displays", {pose: None})
                for label, display in displays.items():
                    destination = output / f"{label}-{appearance}-{screen}.png"
                    options = [f"--display={display}"] if display is not None else []
                    simctl("io", udid, "screenshot", "--type=png", *options, str(destination), check=True)
            else:
                raise ValueError("Unknown UI-test request")
            response["ok"] = True
        except (ValueError, subprocess.SubprocessError) as error:
            host_pose_known = False
            response.update(ok=False, error=str(error))
        temporary = directory / "response.tmp"
        temporary.write_text(json.dumps(response))
        temporary.replace(directory / "response.json")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["probe", "serve", "configure-host"])
    parser.add_argument("udid")
    parser.add_argument("directory", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--appearance", choices=["light", "dark"])
    args = parser.parse_args()
    if args.action == "probe":
        probe(args.udid, args.directory)
    elif args.action == "configure-host":
        configure_host(args.directory)
    else:
        if args.output is None or args.appearance is None:
            parser.error("serve requires --output and --appearance")
        serve(args.udid, args.directory, args.output, args.appearance)
