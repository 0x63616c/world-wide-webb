#!/usr/bin/env python3
"""Fence automatic delivery when newer main changes affect this app's release."""

import argparse
import json
import os
from ios_delivery import tag_target
from pathlib import Path
import subprocess

import yaml

ROOT = Path(__file__).resolve().parent.parent


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def current(app, source, latest):
    # Divergent/rewritten main must never publish an abandoned source.
    if subprocess.run(["git", "merge-base", "--is-ancestor", source, latest], cwd=ROOT, check=False).returncode != 0:
        return False
    config = yaml.safe_load(git("show", f"{latest}:apps/{app}/app.yml"))
    if config.get("testflight") is not True:
        return False
    affected = json.loads(
        subprocess.check_output(["scripts/affected", source, "--head", latest, "--intent", "ship"], cwd=ROOT, text=True)
    )
    listing = git(
        "diff", "--name-only", source, latest, "--", f"apps/{app}/fastlane/metadata", f"apps/{app}/screenshots.json"
    )
    return app not in affected["apps"] and not listing


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("app")
    parser.add_argument("source")
    args = parser.parse_args()
    if os.environ.get("GITHUB_REF_TYPE") == "tag":
        app, _version = tag_target(os.environ["GITHUB_REF"], args.source)
        if app != args.app:
            raise ValueError("Release tag names another app")
        print(json.dumps({"current": True, "latest": args.source}))
        return
    # Full ancestry is needed for both impact and ownership checks. Refresh under
    # the per-app publisher lock, including immediately before Apple mutations.
    fetch = ["fetch", "--no-tags", "origin", "+refs/heads/main:refs/remotes/origin/main"]
    if git("rev-parse", "--is-shallow-repository") == "true":
        fetch.insert(1, "--unshallow")
    git(*fetch)
    latest = git("rev-parse", "origin/main")
    print(json.dumps({"current": current(args.app, args.source, latest), "latest": latest}))


if __name__ == "__main__":
    main()
