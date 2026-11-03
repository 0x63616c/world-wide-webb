#!/usr/bin/env python3
"""Report release queues and step timings from GitHub metadata, without reading signing logs."""
import argparse
from datetime import datetime, timezone
import json
import subprocess


def api(path):
    return json.loads(subprocess.check_output(["gh", "api", path], text=True))


def elapsed(start, end):
    if not start or not end or start.startswith("0001") or end.startswith("0001"):
        return None
    return round((datetime.fromisoformat(end.replace("Z", "+00:00")) -
                  datetime.fromisoformat(start.replace("Z", "+00:00"))).total_seconds(), 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=int)
    parser.add_argument("--repo", default="0x63616c/world-wide-webb")
    args = parser.parse_args()
    root = f"repos/{args.repo}/actions/runs/{args.run}"
    run = api(root)
    now = datetime.now(timezone.utc).isoformat()
    attempts = []
    for attempt in range(1, run["run_attempt"] + 1):
        jobs = []
        page = 1
        while True:
            batch = api(f"{root}/attempts/{attempt}/jobs?per_page=100&page={page}")["jobs"]
            for job in batch:
                steps = job.get("steps", [])
                # started_at can equal queued time for an unassigned runner.
                # The first real step is the evidence that a runner executed.
                started = next((step["started_at"] for step in steps
                                if step.get("started_at", "0001").startswith("20")), None)
                jobs.append({"job": job["name"], "status": job["status"], "conclusion": job["conclusion"],
                             "runner_wait_seconds": elapsed(job.get("created_at"), started),
                             "steps": [{"step": step["name"], "status": step["status"],
                                        "conclusion": step["conclusion"],
                                        "seconds": elapsed(step.get("started_at"),
                                                           step.get("completed_at") if step["status"] == "completed" else now)
                                        if step["status"] != "pending" else None} for step in steps]})
            if len(batch) < 100:
                break
            page += 1
        attempts.append({"attempt": attempt, "jobs": jobs})
    print(json.dumps({"url": run["html_url"], "status": run["status"], "conclusion": run["conclusion"],
                      "created_at": run["created_at"], "observed_at": now,
                      "note": "Parallel job times overlap. Missing runner wait means no executed step is recorded. "
                              "Fastlane archive/upload/Apple processing share one step; inspect its filtered completion logs separately.",
                      "attempts": attempts}, indent=2))


if __name__ == "__main__": main()
