#!/usr/bin/env python3
"""Reuse a trusted processed-upload receipt before allocating another TestFlight build."""

import io
import json
import os
import re
import subprocess
import zipfile


def trusted(run, repository):
    return (
        run.get("name") == "Apple Panel TestFlight"
        and run.get("event") == "workflow_run"
        and run.get("head_branch") == "main"
        and run.get("head_repository", {}).get("full_name") == repository
    )


def parse_receipt(archive, sha):
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        info = zipped.getinfo("testflight-receipt.json")
        if info.file_size > 4096:
            raise ValueError("oversized upload receipt")
        receipt = json.loads(zipped.read(info))
    if receipt.get("sha") != sha or type(receipt.get("build")) is not int or not 0 < receipt["build"] <= 2_147_483_647:
        raise ValueError("upload receipt does not match this source")
    return receipt["build"]


def main():
    sha = os.environ["SOURCE_SHA"]
    if not re.fullmatch("[a-f0-9]{40}", sha):
        raise ValueError("invalid tested source SHA")
    repo = os.environ["GITHUB_REPOSITORY"]

    def api(path):
        return subprocess.check_output(["gh", "api", path], timeout=30)

    artifacts = json.loads(api(f"repos/{repo}/actions/artifacts?name=panel-testflight-{sha}&per_page=100"))["artifacts"]
    build = None
    for artifact in sorted(artifacts, key=lambda row: row["id"], reverse=True):
        if artifact["expired"] or artifact["size_in_bytes"] > 1_048_576:
            continue
        run = json.loads(api(f"repos/{repo}/actions/runs/{artifact['workflow_run']['id']}"))
        if not trusted(run, repo):
            continue
        build = parse_receipt(api(f"repos/{repo}/actions/artifacts/{artifact['id']}/zip"), sha)
        break
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write("uploaded=" + ("true" if build else "false") + "\n")
    if build:
        with open(os.environ["GITHUB_ENV"], "a") as output:
            output.write(f"PANEL_UPLOADED_BUILD={build}\n")
        print("Reusing processed upload; only release publication will retry")


if __name__ == "__main__":
    main()
