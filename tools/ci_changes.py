#!/usr/bin/env python3
"""One path-selection policy shared by CI and release workflows."""

import argparse
import json
import os
import re
import subprocess
from pathlib import Path


def classify(paths, force=False):
    all_changed = force or any(
        p.startswith((".github/", "tools/"))
        or p
        in {
            "tools/ci_changes.py",
            "tools/ci_gate.py",
            "tools/check",
            "lefthook.yml",
        }
        for p in paths
    )
    rust = all_changed or any(
        p.startswith(("server/", "contracts/"))
        or p
        in {
            "Cargo.toml",
            "Cargo.lock",
            "rust-toolchain.toml",
        }
        for p in paths
    )
    return {
        "apple": all_changed
        or rust
        or any(p.startswith(("apple/", "contracts/")) or p == ".swift-format" for p in paths),
        "image": all_changed
        or rust
        or any(p in {"Dockerfile", ".dockerignore"} or p.startswith("deploy/mini/") for p in paths),
        "infra": all_changed or any(p.startswith("infra/") or p == ".opentofu-version" for p in paths),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("base")
    parser.add_argument("head")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if not all(re.fullmatch("[a-f0-9]{40}", ref) for ref in [args.base, args.head]):
        parser.error("base and head must be full commit SHAs")
    if args.base == "0" * 40:
        selected = classify([], True)
    else:
        paths = (
            subprocess.check_output(["git", "diff", "--name-only", "-z", args.base, args.head, "--"])
            .decode()
            .split("\0")
        )
        selected = classify(paths, args.force)
    Path("ci-selection.json").write_text(json.dumps(selected) + "\n")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            for key, value in selected.items():
                output.write(f"{key}={str(value).lower()}\n")
    print(json.dumps(selected))


if __name__ == "__main__":
    main()
