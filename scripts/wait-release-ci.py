#!/usr/bin/env python3
"""Require successful CI for this exact source revision before publishing."""
import json
import os
import subprocess
import time

# CI jobs allow 60 minutes, plus hosted-runner queue time. This wait runs on
# Linux so it cannot hold a Mac slot needed by the source checks.
for _ in range(160):
    runs = json.loads(subprocess.check_output([
        "gh", "run", "list", "--repo", os.environ["GITHUB_REPOSITORY"],
        "--workflow", "tendr-ci.yml", "--commit", os.environ["GITHUB_SHA"],
        "--branch", "main", "--event", "push", "--limit", "1",
        "--json", "status,conclusion,url",
    ]))
    if runs and runs[0]["status"] == "completed":
        if runs[0]["conclusion"] != "success":
            raise SystemExit(f"Source CI did not pass: {runs[0]['url']}")
        print(f"Source CI passed: {runs[0]['url']}")
        break
    time.sleep(30)
else:
    raise SystemExit("Timed out waiting for source CI; no release uploaded")
