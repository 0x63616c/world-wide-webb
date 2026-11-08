#!/usr/bin/env python3
"""Bind a runtime-tested registry image to its successful trusted CI revision."""

import argparse
import json
import os
import re
import subprocess
from pathlib import Path

REPOSITORY = "ghcr.io/0x63616c/www-control-center-mini"


def verify(value, sha):
    if (
        not isinstance(value, dict)
        or not re.fullmatch(r"[a-f0-9]{40}", sha)
        or value.get("sha") != sha
        or value.get("os") != "linux"
        or value.get("architecture") != "arm64"
        or not isinstance(value.get("image"), str)
        or not re.fullmatch(re.escape(REPOSITORY) + r"@sha256:[a-f0-9]{64}", value["image"])
    ):
        raise ValueError("A matching immutable ARM64 image from trusted CI is required")
    return value["image"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=["record", "select"])
    parser.add_argument("sha")
    parser.add_argument("--tag")
    args = parser.parse_args()
    artifact = Path("ci-image.json")
    if args.operation == "record":
        if args.tag != REPOSITORY + ":" + args.sha:
            parser.error("the pushed image tag must match the CI revision")
        image = json.loads(subprocess.check_output(["docker", "image", "inspect", args.tag], text=True))[0]
        digest = next((v for v in image.get("RepoDigests", []) if v.startswith(REPOSITORY + "@")), None)
        value = {"sha": args.sha, "image": digest, "os": image["Os"], "architecture": image["Architecture"]}
        verify(value, args.sha)
        artifact.write_text(json.dumps(value) + "\n")
    selected = verify(json.loads(artifact.read_text()), args.sha)
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write("image=" + selected + "\n")


if __name__ == "__main__":
    main()
