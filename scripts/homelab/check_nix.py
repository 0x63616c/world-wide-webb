#!/usr/bin/env python3
"""Evaluate the full flake; build host outputs for service-only changes."""

import argparse
import json
import re
import subprocess
from pathlib import Path

FLAKE = "./homelab"


def service_only(paths):
    return bool(paths) and all(p.startswith("homelab/services/") for p in paths)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="")
    parser.add_argument("--head", default="")
    parser.add_argument("--roots-output", type=Path)
    args = parser.parse_args()
    paths = []
    if all(re.fullmatch("[a-f0-9]{40}", value) for value in (args.base, args.head)) and args.base != "0" * 40:
        paths = (
            subprocess.check_output(
                ["git", "diff", "--name-only", "--no-renames", "-z", args.base, args.head, "--"], text=True
            )
            .strip("\0")
            .split("\0")
        )
    command = ["nix", "flake", "check", FLAKE, "--no-update-lock-file", "--print-build-logs"]
    if service_only(paths):
        subprocess.run([*command, "--no-build"], check=True)
        subprocess.run(
            [
                "nix",
                "build",
                "--no-update-lock-file",
                "--print-build-logs",
                "--no-link",
                f"{FLAKE}#checks.aarch64-darwin.mac-mini",
                f"{FLAKE}#checks.aarch64-darwin.macbook",
                f"{FLAKE}#checks.aarch64-darwin.deployment-inputs",
            ],
            check=True,
        )
    else:
        subprocess.run(command, check=True)
    if args.roots_output:
        outputs = json.loads(
            subprocess.check_output(
                [
                    "nix",
                    "eval",
                    "--no-update-lock-file",
                    "--json",
                    f"{FLAKE}#checks.aarch64-darwin",
                    "--apply",
                    "checks: builtins.mapAttrs (name: value: value.outPath) checks",
                ],
                text=True,
            )
        )
        # Cache the locally compiled tools, not whole Darwin generations and their
        # upstream runtime closures (3.73 GB in the measured full-check trial).
        # Both tools are installed by base.nix on both hosts, so service-only
        # builds also realize them. The runner is an explicit full-check output.
        names = ["management-client", "host-operations"]
        if not service_only(paths):
            names.append("runner-controller")
        args.roots_output.write_text(json.dumps(sorted({outputs[name] for name in names})) + "\n")


if __name__ == "__main__":
    main()
