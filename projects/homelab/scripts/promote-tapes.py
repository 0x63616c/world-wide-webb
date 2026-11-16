#!/usr/bin/env python3
"""Prepare a local Tapes release-manifest edit for review; never deploy or merge."""

import argparse
import json
from pathlib import Path
import re


def validate(value):
    required = {"schemaVersion", "sourceRepository", "sourceRevision", "image"}
    if not isinstance(value, dict) or set(value) != required or value["schemaVersion"] != 1:
        raise ValueError("Invalid release manifest schema")
    if value["sourceRepository"] != "0x63616c/world-wide-webb":
        raise ValueError("Unexpected source repository")
    if not isinstance(value["sourceRevision"], str) or not re.fullmatch(r"[a-f0-9]{40}", value["sourceRevision"]):
        raise ValueError("Source revision must be an exact commit")
    if not isinstance(value["image"], str) or not re.fullmatch(
        r"ghcr\.io/0x63616c/www-tapes@sha256:[a-f0-9]{64}", value["image"]
    ):
        raise ValueError("Image must use the approved repository and an immutable digest")
    return value


def promote(revision, image):
    # Every field is fixed or supplied, so the first pin needs no existing manifest.
    return validate(
        {"schemaVersion": 1, "sourceRepository": "0x63616c/world-wide-webb", "sourceRevision": revision, "image": image}
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("services/tapes/release.json"))
    parser.add_argument("--source-revision", required=True)
    parser.add_argument("--image", required=True)
    args = parser.parse_args()
    value = promote(args.source_revision, args.image)
    args.manifest.write_text(json.dumps(value, indent=2) + "\n")
    print("Prepared release manifest. Verify source CI and image provenance before opening a promotion PR.")


if __name__ == "__main__":
    main()
