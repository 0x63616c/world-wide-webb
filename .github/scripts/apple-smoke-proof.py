"""Reuse successful PR smoke only for the exact checkout tree being released.

Read GitHub-owned run/job metadata and the checkout action's recorded commit.
Never download or execute PR build products in the signing job. Missing evidence
is a cache miss: the full smoke suite still runs.
"""
import json
import os
import re
import subprocess

WORKFLOW = "apple-panel-testflight.yml"


def checkout_commit(log):
    lines = log.splitlines()
    for index, line in enumerate(lines[:-1]):
        if re.search(r"\[command\].*/git log -1 --format=%H$", line):
            match = re.fullmatch(r"\S+ ([0-9a-f]{40})", lines[index + 1])
            if match:
                return match[1]
    return None


def eligible_run(run, repo, head):
    return (run.get("event") == "pull_request"
            and run.get("status") == "completed"
            and run.get("conclusion") == "success"
            and run.get("head_sha") == head
            and run.get("head_repository", {}).get("full_name") == repo
            and run.get("path") == f".github/workflows/{WORKFLOW}")


def find_proof(api, repo, source):
    root = f"repos/{repo}"
    tree = api(f"{root}/git/commits/{source}")["tree"]["sha"]
    pulls = api(f"{root}/commits/{source}/pulls?per_page=100")
    for pull in pulls:
        if not (pull.get("merged_at") and pull.get("merge_commit_sha") == source
                and pull.get("base", {}).get("ref") == "main"
                and pull.get("base", {}).get("repo", {}).get("full_name") == repo
                and pull.get("head", {}).get("repo", {}).get("full_name") == repo):
            continue
        head = pull["head"]["sha"]
        runs = api(f"{root}/actions/workflows/{WORKFLOW}/runs?head_sha={head}&event=pull_request&status=success&per_page=100")
        for run in runs["workflow_runs"]:
            if not eligible_run(run, repo, head):
                continue
            jobs = api(f"{root}/actions/runs/{int(run['id'])}/jobs?per_page=100")["jobs"]
            for job in jobs:
                if job.get("name") != "smoke" or job.get("conclusion") != "success":
                    continue
                tested = checkout_commit(api(f"{root}/actions/jobs/{int(job['id'])}/logs", raw=True))
                if tested and api(f"{root}/git/commits/{tested}")["tree"]["sha"] == tree:
                    return str(run["id"])
    return ""


def github(path, raw=False):
    value = subprocess.check_output(["gh", "api", "--allow-escape-sequences", path], text=True)
    return value if raw else json.loads(value)


if __name__ == "__main__":
    proof = ""
    if os.environ.get("EVENT_NAME") != "pull_request":
        try:
            proof = find_proof(github, os.environ["GITHUB_REPOSITORY"], os.environ["SOURCE_SHA"])
        except (subprocess.CalledProcessError, ValueError, KeyError, TypeError):
            print("No verifiable prior smoke result; running the full suite.")
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"verified_run={proof}\n")
    if proof:
        print(f"Exact source tree passed PR smoke: run {proof}")
