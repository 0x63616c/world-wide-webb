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
        for key in ("paths", "exclude", "delivery_paths", "delivery_exclude", "preview_paths"):
            for pattern in unit.get(key, []):
                if not isinstance(pattern, str) or pattern.startswith("/") or ".." in pattern.split("/"):
                    raise ValueError(f"Invalid {name} {key}")
        for dependent in unit.get("verify_dependents", []):
            if dependent not in config["units"]:
                raise ValueError(f"Unknown dependent: {dependent}")
    for path, consumers in config.get("workflow_units", {}).items():
        if not path.startswith(".github/") or any(name not in config["units"] for name in consumers):
            raise ValueError(f"Invalid workflow consumers: {path}")
    for name, check in config.get("checks", {}).items():
        if not check.get("units") or any(unit not in config["units"] for unit in check["units"]):
            raise ValueError(f"Invalid check consumers: {name}")
        for pattern in check.get("paths", []) + check.get("exclude", []):
            if not isinstance(pattern, str) or pattern.startswith("/") or ".." in pattern.split("/"):
                raise ValueError(f"Invalid check input: {name}")
    return config


def select(paths, config, force=False):
    units = validate(config)["units"]
    direct = set()
    delivery = set()
    unknown = set()
    shared = False
    reasons = {}
    workflow_consumers = set()
    for path in paths:
        if not path:
            continue
        if path.startswith("/") or ".." in path.split("/"):
            raise ValueError("Changes must use repository-relative paths")
        if documentation(path):
            continue
        consumers = config.get("workflow_units", {}).get(path)
        if consumers is not None:
            direct.update(consumers)
            workflow_consumers.update(consumers)
            for name in consumers:
                reasons.setdefault(name, []).append(path)
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
        for name in owners:
            reasons.setdefault(name, []).append(path)
        delivery.update(
            name
            for name in owners
            if units[name].get("delivery")
            and matches(path, units[name].get("delivery_paths", units[name]["paths"]))
            and not matches(path, units[name].get("delivery_exclude", []))
        )
        if not owners:
            unknown.add(path)
    # Unknown paths fail conservatively into verification, never deployment.
    verify = set(units) if force or shared or unknown else set(direct)
    pending = list(verify)
    while pending:
        pending_name = pending.pop()
        for dependent in units[pending_name].get("verify_dependents", []):
            if dependent not in verify:
                verify.add(dependent)
                reasons.setdefault(dependent, []).append("dependency: " + pending_name)
                pending.append(dependent)
    checks = {}
    for name, check in config.get("checks", {}).items():
        consumers = set(check["units"])
        inputs = [
            path
            for path in paths
            if path
            and not documentation(path)
            and matches(path, check["paths"])
            and not matches(path, check.get("exclude", []))
        ]
        if force or shared or unknown or consumers.intersection(workflow_consumers):
            inputs.append("forced/shared/unmapped/workflow consumer")
        if inputs and consumers.intersection(verify):
            checks[name] = sorted(set(inputs))
    # Optional UI captures use their actual inputs, not conservative verification
    # fan-out. Shared selector tests do not need to render every product's UI.
    previews = {
        name
        for name, unit in units.items()
        if name.endswith(".native")
        and (
            force
            or any(
                path and not documentation(path) and matches(path, unit.get("preview_paths", unit["paths"]))
                for path in paths
            )
        )
    }
    standard_preview = force or any(
        path and not documentation(path) and matches(path, config.get("standard_preview_paths", [])) for path in paths
    )
    return {
        "version": 1,
        "verify": sorted(verify),
        "delivery_candidates": sorted(delivery),
        "shared_tooling": shared,
        "unmapped": sorted(unknown),
        "checks": sorted(checks),
        "previews": sorted(previews),
        "standard_preview": standard_preview,
        "check_reasons": checks,
        "reasons": {name: sorted(set(reasons.get(name, ["forced/shared/unmapped"]))) for name in sorted(verify)},
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
            for key in ("verify", "delivery_candidates", "checks", "previews"):
                output.write(f"{key}={json.dumps(result[key], separators=(',', ':'))}\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
