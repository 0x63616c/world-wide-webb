#!/usr/bin/env python3
"""Pin one stable Xcode release across CI runners and local release validation."""
import glob
import os
from pathlib import Path
import re
import subprocess

# Runner images roll out gradually. Choosing the newest installed release can
# compile UI products with a different Xcode than the parallel test runners.
XCODE_VERSION = (27, 1)


def select(candidates, version):
    matches = []
    for path in candidates:
        if any(marker in str(path).lower() for marker in ("beta", "release_candidate")):
            continue
        match = re.search(r"^Xcode (\d+(?:\.\d+)*)$", version(path), re.MULTILINE)
        if match:
            number = tuple(map(int, match[1].split(".")))
            while len(number) > 2 and number[-1] == 0:
                number = number[:-1]
            if number == XCODE_VERSION:
                matches.append((number, str(path)))
    if not matches:
        release = ".".join(map(str, XCODE_VERSION))
        raise ValueError(f"Xcode {release} is required for release validation. "
                         "Install it alongside your development Xcode; no other-version fallback is allowed.")
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
