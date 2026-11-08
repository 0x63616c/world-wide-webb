#!/usr/bin/env python3
"""Resume a Tendr update deferred by review, using the latest main source."""
import io
import json
import subprocess
import zipfile


def gh(*args):
    return subprocess.check_output(["gh", *args])


def pending_state(runs, artifacts, read_state):
    # Ignore green no-op runs and unrelated failures. The newest durable release
    # decision wins: a later submitted release supersedes an older deferral.
    for run in runs:
        if run["status"] != "completed":
            return None
        for artifact in artifacts(run["databaseId"]):
            if artifact["name"] == "release-state" and not artifact["expired"]:
                state = read_state(artifact["id"])
                return state if state["state"] == "deferred" else None
    return None


def workflow_runs(repo):
    # A long review can outlast hundreds of unrelated main pushes. Do not lose
    # its durable deferral behind a fixed recent-run window; stop lazily as soon
    # as pending_state finds a decision or an active publisher.
    page = 1
    while True:
        batch = json.loads(gh("api", f"repos/{repo}/actions/workflows/testflight.yml/runs?branch=main&per_page=100&page={page}"))["workflow_runs"]
        yield from ({"databaseId": row["id"], "status": row["status"]} for row in batch)
        if len(batch) < 100:
            return
        page += 1


def main():
    import os
    repo = os.environ["GITHUB_REPOSITORY"]
    runs = workflow_runs(repo)

    def artifacts(run_id):
        return json.loads(gh("api", f"repos/{repo}/actions/runs/{run_id}/artifacts"))["artifacts"]

    def read_state(artifact_id):
        archive = gh("api", f"repos/{repo}/actions/artifacts/{artifact_id}/zip")
        with zipfile.ZipFile(io.BytesIO(archive)) as files:
            return json.loads(files.read("release-state.json"))

    state = pending_state(runs, artifacts, read_state)
    if state:
        if state["app"] != "tendr":
            raise ValueError("Unexpected deferred app")
        gh("workflow", "run", "testflight.yml", "--repo", repo, "--ref", "main", "-f", "app=tendr")
        print("Resumed deferred Tendr delivery from current main; the planner rechecks Apple's state under the release lock.")
    else:
        print("No deferred release to resume.")


if __name__ == "__main__":
    main()
