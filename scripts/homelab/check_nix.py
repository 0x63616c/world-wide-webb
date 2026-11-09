#!/usr/bin/env python3
"""Evaluate the full flake; build host outputs for service-only changes."""

import argparse
import re
import subprocess


def service_only(paths):
    return bool(paths) and all(p.startswith("homelab/services/") for p in paths)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="")
    parser.add_argument("--head", default="")
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
    command = ["nix", "flake", "check", "--no-update-lock-file", "--print-build-logs"]
    if service_only(paths):
        subprocess.run([*command, "--no-build"], check=True)
        subprocess.run(
            [
                "nix",
                "build",
                "--no-update-lock-file",
                "--print-build-logs",
                "--no-link",
                ".#checks.aarch64-darwin.mac-mini",
                ".#checks.aarch64-darwin.macbook",
                ".#checks.aarch64-darwin.deployment-inputs",
            ],
            check=True,
        )
    else:
        subprocess.run(command, check=True)


if __name__ == "__main__":
    main()
