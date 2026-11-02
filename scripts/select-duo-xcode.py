#!/usr/bin/env python3
"""Select the requested Xcode, either 27.1 bundle spelling, then the newest install."""
import os
from pathlib import Path
import plistlib
import re
import sys


def usable(developer):
    binary = developer / "usr/bin/xcodebuild"
    return binary.is_file() and os.access(binary, os.X_OK)


def version(app):
    for filename in ("version.plist", "Info.plist"):
        try:
            with (app / "Contents" / filename).open("rb") as file:
                value = plistlib.load(file).get("CFBundleShortVersionString", "")
            numbers = tuple(int(n) for n in re.findall(r"\d+", str(value)))
            if numbers:
                return numbers
        except (OSError, ValueError, plistlib.InvalidFileException):
            pass
    return tuple(int(n) for n in re.findall(r"\d+", app.name))


def select_xcode(requested, applications=Path("/Applications")):
    preferred = [Path(requested)] if requested else []
    preferred += [applications / name / "Contents/Developer"
                  for name in ("Xcode_27.1.app", "Xcode-27.1.app")]
    for developer in preferred:
        if usable(developer):
            return developer
    candidates = [app for app in applications.glob("Xcode*.app")
                  if usable(app / "Contents/Developer")]
    if not candidates:
        raise ValueError(f"No usable {applications}/Xcode*.app installation found; install Xcode 27.1+.")
    return max(candidates, key=lambda app: (version(app), app.name)) / "Contents/Developer"


if __name__ == "__main__":
    try:
        print(select_xcode(sys.argv[1] if len(sys.argv) > 1 else ""))
    except ValueError as error:
        sys.exit(str(error))
