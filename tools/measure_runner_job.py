#!/usr/bin/env python3
"""Record a validation workload's interval and resource use, preserving its exit."""

import argparse
import datetime
import json
import os
import pathlib
import platform
import resource
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cohort", required=True)
    parser.add_argument("--slot", type=int, required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("a workload command is required")
    started = datetime.datetime.now(datetime.timezone.utc)
    clock = time.monotonic()
    result = subprocess.run(command, check=False)
    usage = resource.getrusage(resource.RUSAGE_CHILDREN)
    record = {
        "cohort": args.cohort,
        "slot": args.slot,
        "revision": os.environ.get("GITHUB_SHA"),
        "run_id": os.environ.get("GITHUB_RUN_ID"),
        "run_attempt": os.environ.get("GITHUB_RUN_ATTEMPT"),
        "system": platform.system(),
        "machine": platform.machine(),
        "started_at": started.isoformat(),
        "finished_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "elapsed_seconds": time.monotonic() - clock,
        "user_cpu_seconds": usage.ru_utime,
        "system_cpu_seconds": usage.ru_stime,
        # Darwin reports bytes; Linux reports KiB. This is the maximum child
        # process RSS, not total guest RAM or a sum of overlapping processes.
        "max_child_rss_bytes": usage.ru_maxrss * (1 if platform.system() == "Darwin" else 1024),
        "exit_code": result.returncode,
    }
    pathlib.Path("runner-measurement.json").write_text(json.dumps(record, indent=2) + "\n")
    return result.returncode if result.returncode >= 0 else 128 - result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
