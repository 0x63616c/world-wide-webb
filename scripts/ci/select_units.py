#!/usr/bin/env python3
"""Select verification units and delivery candidates; never authorize publication."""

import argparse
import fnmatch
import json
import os
import re
import subprocess
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[2]
CONFIG = Path(__file__).with_name("units.json")


def matches(path, patterns):
    return any(fnmatch.fnmatchcase(path, pattern) for pattern in patterns)


def documentation(path):
    parts = PurePosixPath(path).parts
    # Listing/capture assets are product inputs even when their source is Markdown.
    if any(part in {"fastlane", "listing", "metadata", "screenshots"} for part in parts):
        return False
    return "docs" in parts or path.endswith(".md") or path.startswith(".agents/")


def validate(config):
    if config.get("version") != 1 or not isinstance(config.get("units"), dict):
        raise ValueError("Unsupported selection manifest")
    for name, unit in config["units"].items():
        if not re.fullmatch(r"[a-z][a-z0-9.-]*", name):
            raise ValueError(f"Invalid unit: {name}")
        for key in ("paths", "exclude", "delivery_paths", "delivery_exclude"):
            for pattern in unit.get(key, []):
                if not isinstance(pattern, str) or pattern.startswith("/") or ".." in pattern.split("/"):
                    raise ValueError(f"Invalid {name} {key}")
        for dependent in unit.get("verify_dependents", []):
            if dependent not in config["units"]:
                raise ValueError(f"Unknown dependent: {dependent}")
    return config


def select(paths, config, force=False):
    units = validate(config)["units"]
    direct = set()
    delivery = set()
    unknown = set()
    shared = False
    for path in paths:
        if not path:
            continue
        if path.startswith("/") or ".." in path.split("/"):
            raise ValueError("Changes must use repository-relative paths")
        if documentation(path):
            continue
        if matches(path, config.get("shared_verify", [])):
            shared = True
            continue
        owners = {
            name
            for name, unit in units.items()
            if matches(path, unit["paths"]) and not matches(path, unit.get("exclude", []))
        }
        direct.update(owners)
        delivery.update(name for name in owners if units[name].get("delivery") and
                        matches(path, units[name].get("delivery_paths", units[name]["paths"])) and
                        not matches(path, units[name].get("delivery_exclude", [])))
        if not owners:
            unknown.add(path)
    # Unknown paths fail conservatively into verification, never deployment.
    verify = set(units) if force or shared or unknown else set(direct)
    pending = list(verify)
    while pending:
        for dependent in units[pending.pop()].get("verify_dependents", []):
            if dependent not in verify:
                verify.add(dependent)
                pending.append(dependent)
    return {
        "version": 1,
        "verify": sorted(verify),
        "delivery_candidates": sorted(delivery),
        "shared_tooling": shared,
        "unmapped": sorted(unknown),
    }


def changed_paths(base, head, event, repo=ROOT):
    for revision in (base, head):
        if not re.fullmatch(r"[0-9a-f]{40}", revision):
            raise ValueError("base and head must be full commit SHAs")
    if base == "0" * 40:
        return None
    if event == "pull_request":
        base = subprocess.check_output(["git", "merge-base", base, head], cwd=repo, text=True).strip()
    # --no-renames includes both sides of moves and deletions. NUL handles whitespace.
    raw = subprocess.check_output(["git", "diff", "--no-renames", "--name-only", "-z", base, head, "--"], cwd=repo)
    return [p for p in raw.decode().split("\0") if p]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base")
    parser.add_argument("head")
    parser.add_argument("--event", choices=["push", "pull_request"], default="push")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--output", type=Path, default=Path("ci-selection.json"))
    args = parser.parse_args()
    try:
        paths = changed_paths(args.base, args.head, args.event)
        result = select(paths or [], json.loads(CONFIG.read_text()), force=args.force or paths is None)
    except (ValueError, subprocess.CalledProcessError) as error:
        parser.error(str(error))
    result.update({"base": args.base, "head": args.head, "event": args.event})
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            for key in ("verify", "delivery_candidates"):
                output.write(f"{key}={json.dumps(result[key], separators=(',', ':'))}\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
