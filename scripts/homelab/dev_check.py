#!/usr/bin/env python3
"""Focused local homelab tests; verbose diagnostics stay in a private log."""

import argparse
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AREAS = {
    "planner": ["test_deployment_plan.py"],
    "activation": [
        "test_stateful_activation.py",
        "test_operation_lock.py",
        "test_service_child.py",
        "test_reconcile_selected.py",
    ],
    "backup": ["test_backup*.py", "test_snapshot.py", "test_verify_backup.py", "test_nas_upload.py"],
    "all": ["test_*.py"],
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("areas", nargs="*", metavar="AREA")
    args = parser.parse_args()
    args.areas = args.areas or ["planner", "activation"]
    if set(args.areas) - AREAS.keys():
        parser.error("choose areas: " + ", ".join(AREAS))
    patterns = sorted({pattern for area in args.areas for pattern in AREAS[area]})
    started = time.monotonic()
    with tempfile.NamedTemporaryFile(prefix="homelab-check-", suffix=".log", delete=False, mode="w+") as log:
        os.fchmod(log.fileno(), 0o600)
        for pattern in patterns:
            command = [sys.executable, "-m", "unittest", "discover", "-s", "homelab/tests", "-p", pattern, "-v"]
            result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=log, check=False)
            if result.returncode:
                log.flush()
                log.seek(0)
                print("".join(log.readlines()[-100:]), file=sys.stderr)
                print("FAIL " + pattern + "; full log: " + log.name, file=sys.stderr)
                return result.returncode
        print("PASS " + ", ".join(args.areas) + f" ({time.monotonic() - started:.2f}s); log: " + log.name)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
