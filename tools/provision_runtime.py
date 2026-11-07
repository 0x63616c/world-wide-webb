#!/usr/bin/env python3
"""Render required runtime credentials privately from sops exec-env, without printing values.

Run only during the final cutover. Existing installation tokens are retained on rerun.
Enrollment records require explicitly provisioned per-device Cloudflare credentials.
"""

import argparse
import json
import os
import secrets
import subprocess
import tempfile
from pathlib import Path

FIELDS = {
    "HA_TOKEN": "HOME_ASSISTANT_TOKEN__CREDENTIAL",
    "HOME_LAT": "HOME_LOCATION__LAT",
    "HOME_LON": "HOME_LOCATION__LON",
    "WIFI_GUEST_SSID": "WIFI_GUEST_WIFI_SSID",
    "WIFI_GUEST_PASSWORD": "WIFI_GUEST_WIFI_PASSWORD",
    "ALARM_API_TOKEN": "PANEL_ALARMS__TOKEN",
}


def outside_git(path):
    parent = path.resolve()
    while not parent.exists():
        parent = parent.parent
    probe = subprocess.run(
        ["git", "-C", str(parent), "rev-parse", "--is-inside-work-tree"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if probe.returncode == 0:
        raise ValueError("runtime credentials must stay outside every Git checkout")


def private_write(path, value):
    if path.is_symlink():
        raise ValueError("credential output cannot be a symlink")
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as output:
        temporary = Path(output.name)
        try:
            os.chmod(temporary, 0o600)
            output.write(value)
            output.flush()
            os.fsync(output.fileno())
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def render(root, environment, enrollment=None):
    outside_git(root)
    if enrollment:
        outside_git(enrollment.parent)
        # Validate before updating any runtime files.
        for key in ["CF_ACCESS_DEVICE_CLIENT_ID", "CF_ACCESS_DEVICE_CLIENT_SECRET"]:
            if not environment.get(key):
                raise ValueError("explicit per-device credentials are required for enrollment")
    missing = [source for source in FIELDS.values() if source not in environment]
    if missing:
        raise ValueError("required runtime credential fields are missing")
    root.mkdir(parents=True, exist_ok=True)
    directory = root / "secrets"
    if directory.is_symlink():
        raise ValueError("credential directory cannot be a symlink")
    directory.mkdir(mode=0o700, exist_ok=True)
    os.chmod(directory, 0o700)
    token_file = directory / "WWW_API_TOKEN"
    token = environment.get("WWW_API_TOKEN") or (
        token_file.read_text().strip() if token_file.is_file() else secrets.token_urlsafe(48)
    )
    if len(token) < 32 or any(c.isspace() for c in token):
        raise ValueError("invalid installation token")
    for target, source in FIELDS.items():
        private_write(directory / target, environment[source])
    private_write(token_file, token)
    if enrollment:
        enrollment.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        private_write(
            enrollment,
            json.dumps(
                {
                    "baseURL": "https://api.worldwidewebb.co",
                    "apiToken": token,
                    "accessClientID": environment["CF_ACCESS_DEVICE_CLIENT_ID"],
                    "accessClientSecret": environment["CF_ACCESS_DEVICE_CLIENT_SECRET"],
                }
            ),
        )
    print("Rendered private runtime credentials without changing application data")


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--enrollment-output", type=Path)
    args = parser.parse_args()
    render(args.root, os.environ, args.enrollment_output)


if __name__ == "__main__":
    main()
