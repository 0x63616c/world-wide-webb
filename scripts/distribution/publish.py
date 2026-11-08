#!/usr/bin/env python3
"""Publish a validated immutable orphan artifact tag; never publish source branches."""

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from prepare import ROOT, fingerprint, git_command, run, validate_payload

REPOSITORY = "0x63616c/world-wide-webb"
REMOTE = "https://github.com/" + REPOSITORY + ".git"


def remote_commit(remote, tag):
    result = subprocess.run(
        git_command("ls-remote", "--exit-code", "--refs", remote, "refs/tags/" + tag),
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode == 2:
        return None
    if result.returncode != 0:
        raise RuntimeError("Could not confirm the artifact ref; do not assume it is absent")
    rows = result.stdout.strip().splitlines()
    if len(rows) != 1 or not re.fullmatch(r"[0-9a-f]{40}\trefs/tags/" + re.escape(tag), rows[0]):
        raise ValueError("Unexpected artifact ref identity")
    return rows[0].split("\t")[0]


def publish(prepared, remote=REMOTE):
    source, commit, tag = (prepared[key] for key in ("source_sha", "commit", "tag"))
    if not all(re.fullmatch(r"[0-9a-f]{40}", value) for value in (source, commit)):
        raise ValueError("Expected exact source and artifact commits")
    match = re.fullmatch(r"dist/(callkeep|homelab)/v(\d+\.\d+\.\d+)", tag)
    if not match:
        raise ValueError("Only a namespaced product artifact tag can be published")
    product, version = match.groups()
    repo = Path(prepared["repository"]).resolve()
    if run("git", "show", "-s", "--format=%P", commit, cwd=repo):
        raise ValueError("Distribution must have zero parents, without source history")
    raw = subprocess.check_output(["git", "show", commit + ":artifact-receipt.json"], cwd=repo)
    if hashlib.sha256(raw).hexdigest() != prepared["receipt_sha256"]:
        raise ValueError("Prepared artifact receipt changed")
    receipt = json.loads(raw)
    if (
        receipt.get("source_repository") != REPOSITORY
        or receipt.get("source_sha") != source
        or receipt.get("product") != product
        or receipt.get("product_version") != version
    ):
        raise ValueError("Prepared artifact identity differs")
    with tempfile.TemporaryDirectory(prefix="verified-distribution-") as directory:
        export = Path(directory) / "payload"
        run("git", "clone", "-q", "--no-local", "--no-checkout", str(repo), str(export))
        run("git", "checkout", "-q", "--detach", commit, cwd=export)
        shutil.rmtree(export / ".git")
        (export / "artifact-receipt.json").unlink()
        if fingerprint(export) != receipt["payload"]:
            raise ValueError("Committed payload differs from its receipt")
        validate_payload(export, product, source=source, version=version)
    existing = remote_commit(remote, tag)
    if existing:
        if existing != commit:
            raise ValueError("Immutable artifact tag already points to different bytes")
        return commit
    # No force and no source refs. A lost response is reconciled by exact readback.
    subprocess.run(
        git_command("push", remote, commit + ":refs/tags/" + tag), cwd=repo, capture_output=True, check=False
    )
    if remote_commit(remote, tag) != commit:
        raise RuntimeError("Artifact publication is not confirmed; retry the same prepared artifact")
    return commit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("prepared", type=Path)
    args = parser.parse_args()
    prepared = json.loads(args.prepared.read_text())
    if (
        run("git", "status", "--porcelain", cwd=ROOT)
        or run("git", "rev-parse", "HEAD", cwd=ROOT) != prepared["source_sha"]
    ):
        parser.error("Publish only the clean verified source used to prepare this artifact")
    if json.loads(run("gh", "repo", "view", REPOSITORY, "--json", "visibility"))["visibility"] != "PRIVATE":
        parser.error("Artifact publication requires the private destination repository")
    print(json.dumps({"tag": prepared["tag"], "commit": publish(prepared)}))


if __name__ == "__main__":
    main()
