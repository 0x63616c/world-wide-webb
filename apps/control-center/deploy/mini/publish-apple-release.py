#!/usr/bin/env python3
"""Publish a processed Apple build through the private API without exporting credentials."""

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
    token = os.environ.get("PANEL_ALARMS__TOKEN") or credential.read_text().strip()
    origin = os.environ.get("WWW_RELEASE_ORIGIN", "http://127.0.0.1:4202").rstrip("/")
    request = urllib.request.Request(
        origin + "/api/v1/releases/latest",
        data=json.dumps({"app": "panel", "build": build}).encode(),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status != 200:
            raise RuntimeError("could not publish processed Apple build")
        receipt = json.load(response)
        if receipt.get("app") != "panel" or type(receipt.get("build")) is not int or receipt["build"] < build:
            raise RuntimeError("API did not confirm the processed Apple build")
    print("Published processed Apple build")


if __name__ == "__main__":
    main()
