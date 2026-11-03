"""Reuse successful PR smoke only for identical native validation inputs.

Read GitHub-owned run/job metadata and the checkout action's recorded commit.
Never download or execute PR build products in the signing job. Missing evidence
is a cache miss: the full smoke suite still runs.
"""
import json
import hashlib
import base64
import os
import posixpath
import re
import subprocess
import sys

WORKFLOW = "apple-panel-testflight.yml"


def is_input(path):
    if path.startswith(("apps/apple-prototype/", "apps/panel/")):
        return path.rsplit("/", 1)[-1] not in {"README.md", "AGENTS.md"}
    return path.startswith(".github/scripts/apple-") or path in (
        ".github/workflows/" + WORKFLOW, ".github/workflows/apple-prototype-ci.yml")


def validate_links(inputs, read_link):
    entries = {path: (mode, kind, sha) for path, mode, kind, sha in inputs}
    for path, mode, _, _ in inputs:
        if mode == "160000":
            raise ValueError("Submodule inputs require explicit dependency coverage")
        seen = set()
        current = path
        while entries[current][0] == "120000":
            if current in seen:
                raise ValueError("Cyclic native asset link")
            seen.add(current)
            target = read_link(current, entries[current][2])
            if posixpath.isabs(target):
                raise ValueError("Absolute native asset link")
            current = posixpath.normpath(posixpath.join(posixpath.dirname(current), target))
            if current not in entries:
                raise ValueError("Native asset link target is outside validated inputs or missing")
        if entries[current][0] == "160000":
            raise ValueError("Native asset link points into a submodule")


def local_fingerprint():
    records = subprocess.check_output(["git", "ls-tree", "-rz", "HEAD", "--",
                                       "apps/apple-prototype", "apps/panel", ".github/scripts", ".github/workflows"])
    inputs = []
    entries = []
    for record in records.split(b"\0"):
        if record:
            metadata, path = record.split(b"\t", 1)
            if is_input(path.decode()):
                inputs.append(record)
                mode, kind, sha = metadata.decode().split()
                entries.append((path.decode(), mode, kind, sha))
    validate_links(entries, lambda path, _: subprocess.check_output(["git", "show", "HEAD:" + path]).decode())
    return hashlib.sha256(b"\0".join(sorted(inputs))).hexdigest()


def validation_inputs(api, repo, commit):
    """Compare Git object identities, never execute code from the evidence ref.

    Read only the native and workflow subtrees, not a recursively expanded whole
    monorepo. Missing paths or truncated API responses invalidate the proof.
    All native files except README/AGENTS documentation participate, including resources, fixtures,
    package locks, project settings, tests and the signing/release lane.
    """
    root = f"repos/{repo}/git/trees/"
    cache = {}

    def tree(ref, recursive=False):
        key = (ref, recursive)
        if key not in cache:
            data = api(root + ref + ("?recursive=1" if recursive else ""))
            if data.get("truncated"):
                raise ValueError("Incomplete native input tree")
            cache[key] = data["tree"]
        return cache[key]

    def subtree(path):
        ref = commit
        for part in path.split("/"):
            entry = next((item for item in tree(ref) if item["path"] == part), None)
            if not entry or entry["type"] != "tree":
                raise ValueError(f"Missing input directory: {path}")
            ref = entry["sha"]
        return tree(ref, recursive=True)

    inputs = []
    for path in ("apps/apple-prototype", "apps/panel", ".github/scripts", ".github/workflows"):
        for entry in subtree(path):
            name = entry["path"]
            if entry["type"] == "tree":
                continue
            if not is_input(path + "/" + name):
                continue
            inputs.append((path + "/" + name, entry["mode"], entry["type"], entry["sha"]))
    def read_link(path, sha):
        blob = api(f"repos/{repo}/git/blobs/{sha}")
        if blob.get("encoding") != "base64":
            raise ValueError("Unrecognized native asset link encoding")
        return base64.b64decode(blob["content"]).decode()
    validate_links(inputs, read_link)
    return sorted(inputs)


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
    inputs = validation_inputs(api, repo, source)
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
                if tested and validation_inputs(api, repo, tested) == inputs:
                    return str(run["id"])
    return ""


def github(path, raw=False):
    value = subprocess.check_output(["gh", "api", "--allow-escape-sequences", path], text=True)
    return value if raw else json.loads(value)


if __name__ == "__main__":
    if sys.argv[1:] == ["--fingerprint"]:
        print(local_fingerprint())
        raise SystemExit(0)
    proof = ""
    if os.environ.get("EVENT_NAME") != "pull_request":
        try:
            proof = find_proof(github, os.environ["GITHUB_REPOSITORY"], os.environ["SOURCE_SHA"])
        except (subprocess.CalledProcessError, ValueError, KeyError, TypeError):
            print("No verifiable prior smoke result; running the full suite.")
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write(f"verified_run={proof}\n")
    if proof:
        print(f"Identical native validation inputs passed PR smoke: run {proof}")
