#!/usr/bin/env python3
"""Replay the same affected path through two committed Homelab policies and handlers."""

import argparse
import importlib.util
import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCENARIOS = {
    "backup-test": "projects/homelab/tests/test_backup.py",
    "service": "projects/homelab/services/control-center/release.json",
}


def plan(repository, path):
    filename = repository / "scripts/ci/select_units.py"
    spec = importlib.util.spec_from_file_location("benchmark_selection", filename)
    policy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(policy)
    selected = policy.select([path], json.loads((filename.parent / "units.json").read_text()))
    # The baseline had one coarse configuration flag and no check-level output.
    if "checks" not in selected:
        selected["checks"] = (
            ["homelab.operations", "homelab.linux", "homelab.darwin"] if "homelab.config" in selected["verify"] else []
        )
    return selected


def commands(check, repository, path):
    if check == "homelab.operations":
        return [
            ["python3", "-m", "unittest", "discover", "-s", folder]
            for folder in ("projects/homelab/tests", "scripts/homelab")
        ] + [["bash", "-n", "projects/homelab/bootstrap.sh"]]
    if check == "homelab.linux":
        return [
            ["cargo", command, "--locked", "--manifest-path", "projects/homelab/runner/Cargo.toml", *extra]
            for command, extra in [("test", []), ("clippy", ["--all-targets", "--", "-D", "warnings"])]
        ]
    if check == "homelab.host":
        return [
            ["cargo", "fmt", "--manifest-path", "projects/homelab/host/Cargo.toml", "--check"],
            [
                "cargo",
                "clippy",
                "--locked",
                "--manifest-path",
                "projects/homelab/host/Cargo.toml",
                "--all-targets",
                "--",
                "-D",
                "warnings",
            ],
            ["cargo", "test", "--locked", "--manifest-path", "projects/homelab/host/Cargo.toml"],
        ]
    if check == "homelab.darwin":
        # Call the actual source-owned Nix selection handler. A no-op fixture
        # commit produces the same path diff without changing service semantics.
        base = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repository, text=True).strip()
        fixture = repository / path
        fixture.write_text(fixture.read_text() + "\n")
        subprocess.run(["git", "add", "--", path], cwd=repository, check=True)
        subprocess.run(
            [
                "git",
                "-c",
                "user.name=CI benchmark",
                "-c",
                "user.email=benchmark@example.invalid",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-qm",
                "Benchmark fixture",
            ],
            cwd=repository,
            check=True,
        )
        head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repository, text=True).strip()
        commands = [
            ["python3", "scripts/homelab/check_nix.py", "--base", base, "--head", head],
            [
                "nix",
                "develop",
                "--no-update-lock-file",
                "--command",
                "cargo",
                "fmt",
                "--manifest-path",
                "projects/homelab/host/Cargo.toml",
                "--check",
            ],
            [
                "nix",
                "develop",
                "--no-update-lock-file",
                "--command",
                "cargo",
                "clippy",
                "--manifest-path",
                "projects/homelab/host/Cargo.toml",
                "--locked",
                "--all-targets",
                "--",
                "-D",
                "warnings",
            ],
        ]
        config = json.loads((repository / "scripts/ci/units.json").read_text())
        return commands[:1] if "homelab.host" in config.get("checks", {}) else commands
    raise ValueError("Unsupported benchmark check")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("scenario", choices=SCENARIOS)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.source):
        parser.error("Source must be a full commit SHA")
    results = {
        "source": args.source,
        "scenario": args.scenario,
        "platform": os.uname().sysname,
        "interpretation": "Same-path handler replay on one Mac, not distributed workflow latency",
        "rounds": [],
    }
    with tempfile.TemporaryDirectory(prefix="ci-measure-") as directory:
        repository = Path(directory) / "source"
        subprocess.run(["git", "clone", "--shared", "--no-checkout", str(ROOT), str(repository)], check=True)
        subprocess.run(["git", "checkout", "--detach", args.source], cwd=repository, check=True)
        results["selection"] = plan(repository, SCENARIOS[args.scenario])
        # Same runner/toolchain for both rounds. "Warm" means the second local
        # execution, not a claimed cross-run GitHub cache hit.
        for name in ("first", "warm"):
            round_result = {"name": name, "checks": {}}
            for check in results["selection"]["checks"]:
                check_commands = commands(check, repository, SCENARIOS[args.scenario])
                started = time.monotonic()
                for command in check_commands:
                    subprocess.run(command, cwd=repository, check=True)
                round_result["checks"][check] = round(time.monotonic() - started, 3)
            round_result["maxCheckSeconds"] = max(round_result["checks"].values(), default=0)
            results["rounds"].append(round_result)
            args.output.write_text(json.dumps(results, indent=2) + "\n")
    print(json.dumps(results))


if __name__ == "__main__":
    main()
