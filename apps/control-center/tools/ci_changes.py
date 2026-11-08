#!/usr/bin/env python3
"""One path-selection policy shared by CI and release workflows."""

import argparse
import importlib.util
import json
import os
import re
import subprocess
from pathlib import Path


def classify(paths, force=False):
    # Routing policy/tests are exercised by the always-on operations checks.
    # They do not change the Apple application or its container inputs.
    selection_policy = {"tools/ci_changes.py", "tools/test_ci.py"}
    penpot_operations = {
        "deploy/mini/penpot_backup.py",
        "deploy/mini/penpot_provision.py",
        "deploy/mini/test_penpot_backup.py",
    }
    all_changed = force or any(
        p.startswith(".github/")
        or (p.startswith("tools/") and p not in selection_policy)
        or p
        in {
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
        or any(
            p in {"Dockerfile", ".dockerignore"} or (p.startswith("deploy/mini/") and p not in penpot_operations)
            for p in paths
        ),
        "publish_apple": force
        or any(
            p.startswith(
                (
                    "apple/App/",
                    "apple/Extensions/",
                    "apple/Resources/",
                    "apple/Packages/PanelKit/Sources/",
                    "apple/fastlane/",
                )
            )
            or p
            in {
                "apple/Packages/PanelKit/Package.swift",
                "apple/Packages/PanelKit/Package.resolved",
                "apple/project.yml",
                "apple/VERSION",
                "apple/Gemfile",
                "apple/Gemfile.lock",
                "tools/ci_signing_env.py",
            }
            for p in paths
        ),
        "infra": all_changed or any(p.startswith("infra/") or p == ".opentofu-version" for p in paths),
    }


def classify_repository(paths, force=False):
    """Adapt the existing product policy to repository-relative inputs."""
    root = Path(__file__).resolve().parents[3]
    spec = importlib.util.spec_from_file_location("monorepo_selection", root / "scripts/ci/select.py")
    policy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(policy)
    selection = policy.select(paths, json.loads(policy.CONFIG.read_text()), force=force)
    selected = set(selection["verify"])
    local = [path[len("apps/control-center/") :] for path in paths if path.startswith("apps/control-center/")]
    result = classify(local)
    result.update(
        {
            "apple": result["apple"] or "control-center.native" in selected,
            "image": result["image"] or "control-center.server" in selected,
            "infra": "cloudflare.home" in selected,
            "checks": any(unit.startswith("control-center.") for unit in selected),
        }
    )
    # Publication remains product-input based; force/shared verification cannot upload.
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("base")
    parser.add_argument("head")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if not all(re.fullmatch("[a-f0-9]{40}", ref) for ref in [args.base, args.head]):
        parser.error("base and head must be full commit SHAs")
    if args.base == "0" * 40:
        selected = classify_repository([], True)
    else:
        paths = (
            subprocess.check_output(["git", "diff", "--no-renames", "--name-only", "-z", args.base, args.head, "--"])
            .decode()
            .split("\0")
        )
        selected = classify_repository(paths, args.force)
    Path("ci-selection.json").write_text(json.dumps(selected) + "\n")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            for key, value in selected.items():
                output.write(f"{key}={str(value).lower()}\n")
    print(json.dumps(selected))


if __name__ == "__main__":
    main()
