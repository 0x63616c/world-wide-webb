#!/usr/bin/env python3
"""Select the same supported Xcode major for CI and local release validation."""

import argparse
import glob
import hashlib
import os
import re
import subprocess
from pathlib import Path

XCODE_MINIMUM = (26, 4)


def select(candidates, version):
    matches = []
    for path in candidates:
        match = re.search(r"^Xcode (\d+(?:\.\d+)*)$", version(path), re.MULTILINE)
        if match:
            number = tuple(map(int, match[1].split(".")))
            if number >= XCODE_MINIMUM:
                matches.append((number, str(path)))
    if not matches:
        raise ValueError(
            "Xcode 26.4 or newer is required for release validation. Install a supported Xcode before building."
        )
    return max(matches)[1]


def developer_dir():
    candidates = {str(Path(path) / "Contents/Developer") for path in glob.glob("/Applications/Xcode*.app")}
    if os.environ.get("DEVELOPER_DIR"):
        candidates.add(os.environ["DEVELOPER_DIR"])

    def version(path):
        try:
            return subprocess.check_output(
                [str(Path(path) / "usr/bin/xcodebuild"), "-version"], text=True, stderr=subprocess.DEVNULL
            )
        except (OSError, subprocess.CalledProcessError):
            return ""

    return select(candidates, version)


if __name__ == "__main__":
    try:
        parser = argparse.ArgumentParser()
        parser.add_argument("--cache-key", action="store_true")
        args = parser.parse_args()
        path = developer_dir()
        if args.cache_key:
            version = subprocess.check_output([str(Path(path) / "usr/bin/xcodebuild"), "-version"])
            print(hashlib.sha256(version).hexdigest()[:16])
        else:
            print(path)
    except ValueError as error:
        raise SystemExit(str(error))
