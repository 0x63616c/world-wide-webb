#!/usr/bin/env python3
"""Prepare a local release-manifest edit for review; never deploy or merge."""

import argparse
import json
from pathlib import Path
import re


def validate(value):
    required = {"schemaVersion", "sourceRepository", "sourceRevision", "image", "databaseEngine"}
    if not isinstance(value, dict) or set(value) != required or value["schemaVersion"] != 2:
        raise ValueError("Invalid release manifest schema")
    if value["sourceRepository"] != "0x63616c/world-wide-webb":
        raise ValueError("Unexpected source repository")
    if not isinstance(value["sourceRevision"], str) or not re.fullmatch(r"[a-f0-9]{40}", value["sourceRevision"]):
        raise ValueError("Source revision must be an exact commit")
    if value["databaseEngine"] != "sqlite":
        raise ValueError("Only the native SQLite runtime is supported")
    for key, prefix in (("image", "ghcr.io/0x63616c/www-control-center-mini"),):
        if not isinstance(value[key], str) or not re.fullmatch(re.escape(prefix) + r"@sha256:[a-f0-9]{64}", value[key]):
            raise ValueError("Image must use the approved repository and an immutable digest")
    return value


def promote(current, revision, image):
    # Database engine changes are separate, manually reviewed migrations.
    return validate({**validate(current), "sourceRevision": revision, "image": image})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("services/control-center/release.json"))
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--image", required=True)
    args = parser.parse_args()
    value = promote(json.loads(args.manifest.read_text()), args.source_revision, args.image)
    args.manifest.write_text(json.dumps(value, indent=2) + "\n")
    print("Prepared release manifest. Verify source CI and image provenance before opening a promotion PR.")


if __name__ == "__main__":
    main()
