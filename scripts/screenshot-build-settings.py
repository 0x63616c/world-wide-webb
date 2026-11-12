#!/usr/bin/env python3
"""Match simulator screenshot metadata to the processed release build."""

import json
import os
from pathlib import Path
import re
import sys


def build_settings(app, environment):
    version = environment.get("RELEASE_VERSION")
    build = environment.get("RELEASE_BUILD")
    if manifest_path := environment.get("RELEASE_MANIFEST"):
        manifest = json.loads(Path(manifest_path).read_text())
        if (
            not isinstance(manifest, dict)
            or manifest.get("app") != app
            or not environment.get("GITHUB_SHA")
            or manifest.get("sha") != environment["GITHUB_SHA"]
        ):
            raise ValueError("Screenshot manifest must match the release app and source revision")
        if (version and version != str(manifest.get("version"))) or (build and build != str(manifest.get("build"))):
            raise ValueError("Screenshot version/build override conflicts with the processed release manifest")
        if any(manifest.get(key) in (None, "") for key in ("version", "build")):
            raise ValueError("Screenshot manifest must specify the processed version and build")
        version, build = str(manifest["version"]), str(manifest["build"])
    settings = []
    for value, name, pattern in (
        (version, "MARKETING_VERSION", r"[0-9]+\.[0-9]+(?:\.[0-9]+)?"),
        (build, "CURRENT_PROJECT_VERSION", r"[1-9][0-9]*"),
    ):
        if value:
            if not re.fullmatch(pattern, value):
                raise ValueError(f"Invalid screenshot {name}")
            settings.append(f"{name}={value}")
    return settings


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: screenshot-build-settings.py <app>")
    try:
        print("\n".join(build_settings(sys.argv[1], os.environ)))
    except (OSError, ValueError, KeyError) as error:
        sys.exit(str(error))
