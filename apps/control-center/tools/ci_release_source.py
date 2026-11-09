#!/usr/bin/env python3
"""Resolve a successful trusted main CI run to its immutable release inputs."""

import json
import os
import re
import sys
import urllib.request


def verify(run, repository):
    path = run.get("path")
    if not (
        run.get("name") == "CI"
        and isinstance(path, str)
        and path.split("@", 1)[0] == ".github/workflows/ci.yml"
        and run.get("status") == "completed"
        and run.get("conclusion") == "success"
        and run.get("event") == "push"
        and run.get("head_branch") == "main"
        and run.get("head_repository", {}).get("full_name") == repository
        and re.fullmatch("[a-f0-9]{40}", run.get("head_sha", ""))
        and all(type(run.get(key)) is int and run[key] > 0 for key in ("id", "run_number", "run_attempt"))
    ):
        raise ValueError("a successful trusted main CI run is required")
    return dict(sha=run["head_sha"], generation=run["run_number"], run_id=run["id"], attempt=run["run_attempt"])


def main():
    run_id = sys.argv[1]
    if not re.fullmatch("[0-9]+", run_id):
        raise ValueError("invalid CI run ID")
    repository = os.environ["GITHUB_REPOSITORY"]
    url = os.environ.get("GITHUB_API_URL", "https://api.github.com") + f"/repos/{repository}/actions/runs/{run_id}"
    request = urllib.request.Request(
        url, headers={"Authorization": "Bearer " + os.environ["GH_TOKEN"], "Accept": "application/vnd.github+json"}
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        result = verify(json.load(response), repository)
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        for key, value in result.items():
            output.write(f"{key}={value}\n")


if __name__ == "__main__":
    main()
