#!/usr/bin/env python3
"""Select the same supported Xcode major for CI and local release validation."""
import glob
import os
from pathlib import Path
import re
import subprocess

XCODE_MAJOR = 27


def select(candidates, version):
    matches = []
    for path in candidates:
        if any(marker in str(path).lower() for marker in ("beta", "release_candidate")):
            continue
        match = re.search(r"^Xcode (\d+(?:\.\d+)*)$", version(path), re.MULTILINE)
        if match:
            number = tuple(map(int, match[1].split(".")))
            if number[0] == XCODE_MAJOR and number >= (27, 1):
                matches.append((number, str(path)))
    if not matches:
        raise ValueError(f"Xcode {XCODE_MAJOR}.1+ is required for release validation. "
                         "Install it alongside your development Xcode; no newer-major fallback is allowed.")
    return max(matches)[1]


def developer_dir():
    candidates = {str((Path(path) / "Contents/Developer").resolve()) for path in glob.glob('/Applications/Xcode*.app')}
    if os.environ.get("DEVELOPER_DIR"):
        candidates.add(str(Path(os.environ["DEVELOPER_DIR"]).resolve()))

    def version(path):
        try:
            return subprocess.check_output([str(Path(path) / "usr/bin/xcodebuild"), "-version"],
                                           text=True, stderr=subprocess.DEVNULL)
        except (OSError, subprocess.CalledProcessError):
            return ""
    return select(candidates, version)


if __name__ == "__main__":
    try:
        print(developer_dir())
    except ValueError as error:
        raise SystemExit(str(error))
