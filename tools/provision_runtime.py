#!/usr/bin/env python3
"""Render required runtime credentials privately from sops exec-env, without printing values.

Run only during the final cutover. Existing installation tokens are retained on rerun.
Native clients connect through Tailscale and have no provisioned application credentials.
"""

import argparse
import os
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
        env={key: value for key, value in os.environ.items() if not key.startswith("GIT_")},
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


def render(root, environment):
    outside_git(root)
    missing = [source for source in FIELDS.values() if source not in environment]
    if missing:
        raise ValueError("required runtime credential fields are missing")
    root.mkdir(parents=True, exist_ok=True)
    directory = root / "secrets"
    if directory.is_symlink():
        raise ValueError("credential directory cannot be a symlink")
    directory.mkdir(mode=0o700, exist_ok=True)
    os.chmod(directory, 0o700)
    for target, source in FIELDS.items():
        private_write(directory / target, environment[source])
    print("Rendered private runtime credentials without changing application data")


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    args = parser.parse_args()
    render(args.root, os.environ)


if __name__ == "__main__":
    main()
