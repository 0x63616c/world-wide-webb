#!/usr/bin/env python3
"""Runtime simctl capability detection and the UI-test capture/resize handshake.

Only commands advertised by the installed simctl help are attempted, on the
script's disposable simulator. Unknown interfaces fall back to the default
screen; display IDs and fold syntax are never assumed from device dimensions.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time


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
        plan = ({"mode": "displays", "displays": displays}
                if displays and "--display" in help_text["io"] else {"mode": "default"})
    (directory / "plan.json").write_text(json.dumps(plan))
    note = {
        "fold": "Fold controls accepted: capture inner and outer, and run live-fold state checks.",
        "displays": "Named inner/outer displays exposed: capture both with --display. No supported live-fold control; live-fold checks skipped.",
        "default": "No supported fold control or named inner/outer display pair. Capturing the device default only (default-*); live-fold checks skipped.",
    }[plan["mode"]]
    (directory / "capture-notes.txt").write_text(note + "\nSee simctl-capabilities.txt for the installed interface.\n")
    print(note)


def serve(udid, directory, output, appearance):
    plan = json.loads((directory / "plan.json").read_text())
    pose = "inner" if plan["mode"] == "fold" else "default"
    request_path = directory / "request.json"
    previous = None
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
                if plan["mode"] != "fold" or target not in plan["commands"]:
                    raise ValueError(f"Unsupported pose: {target}")
                simctl(*plan["commands"][target], check=True)
                pose = target
                time.sleep(2)  # window/scene transition must finish before the test proceeds
            elif request["action"] == "capture":
                screen = request["name"]
                if not re.fullmatch(r"[a-z0-9-]+", screen):
                    raise ValueError("Invalid screenshot name")
                displays = plan.get("displays", {pose: None})
                for label, display in displays.items():
                    destination = output / f"{label}-{appearance}-{screen}.png"
                    options = [f"--display={display}"] if display is not None else []
                    simctl("io", udid, "screenshot", "--type=png", *options, str(destination), check=True)
            else:
                raise ValueError("Unknown UI-test request")
            response["ok"] = True
        except (ValueError, subprocess.SubprocessError) as error:
            response.update(ok=False, error=str(error))
        temporary = directory / "response.tmp"
        temporary.write_text(json.dumps(response))
        temporary.replace(directory / "response.json")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["probe", "serve"])
    parser.add_argument("udid")
    parser.add_argument("directory", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--appearance", choices=["light", "dark"])
    args = parser.parse_args()
    if args.action == "probe":
        probe(args.udid, args.directory)
    else:
        if args.output is None or args.appearance is None:
            parser.error("serve requires --output and --appearance")
        serve(args.udid, args.directory, args.output, args.appearance)
