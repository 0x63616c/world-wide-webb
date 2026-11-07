#!/usr/bin/env python3
"""Publish a processed Apple build locally; no app/Cloudflare credential is bundled in CI artifacts."""

import json
import os
import sys
import urllib.request
from pathlib import Path


def main():
    build = int(sys.argv[1])
    if not 0 < build <= 2_147_483_647:
        raise ValueError("invalid Apple build number")
    root = Path(os.environ.get("WWW_ROOT", str(Path.home() / "www-control-center")))
    credential = Path(os.environ.get("WWW_RELEASE_TOKEN_FILE", str(root / "secrets/ALARM_API_TOKEN")))
    token = credential.read_text().strip()
    request = urllib.request.Request(
        "http://127.0.0.1:4202/api/v1/releases/latest",
        data=json.dumps({"app": "panel", "build": build}).encode(),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status != 200:
            raise RuntimeError("could not publish processed Apple build")
    print("Published processed Apple build")


if __name__ == "__main__":
    main()
