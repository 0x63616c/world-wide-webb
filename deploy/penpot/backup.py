#!/usr/bin/env python3
"""Consistent Penpot snapshots and read-back verified copies on the existing NAS."""

import contextlib
import datetime
import gzip
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

DOCKER = "/opt/homebrew/bin/docker"
ROOT = Path.home() / "penpot"
BACKUPS = Path.home() / "penpot-backups"


def docker(*args, **kwargs):
    return subprocess.run([DOCKER, "--context", "orbstack", *args], check=True, **kwargs)


@contextlib.contextmanager
def quiesced():
    # Verify all writers before stopping any; restore only those we stopped.
    writers = ["penpot-penpot-backend-1", "penpot-penpot-exporter-1"]
    for name in writers:
        result = docker("inspect", "--format", "{{.State.Running}}", name, capture_output=True, text=True)
        if result.stdout.strip() != "true":
            raise RuntimeError(f"{name} was already stopped")
    stopped = []
    try:
        for name in writers:
            docker("stop", "--time", "60", name, stdout=subprocess.DEVNULL)
            stopped.append(name)
        yield
    finally:
        # Attempt every restart even if one fails.
        failures = []
        for name in stopped:
            try:
                docker("start", name, stdout=subprocess.DEVNULL)
            except subprocess.CalledProcessError:
                failures.append(name)
        if failures:
            raise RuntimeError("Failed to restart " + ", ".join(failures))


def snapshot(destination):
    with quiesced():
        with (destination / "penpot.dump").open("xb") as out:
            docker("exec", "penpot-penpot-postgres-1", "pg_dump", "-U", "penpot", "-d", "penpot", "-Fc", stdout=out)
        with gzip.open(destination / "assets.tar.gz", "wb") as out:
            process = subprocess.Popen(
                [DOCKER, "--context", "orbstack", "cp", "penpot-penpot-backend-1:/opt/data/assets/.", "-"],
                stdout=subprocess.PIPE,
            )
            try:
                shutil.copyfileobj(process.stdout, out, 1024 * 1024)
            finally:
                process.stdout.close()
            if process.wait() != 0:
                raise RuntimeError("Penpot assets snapshot failed")
        subprocess.run(
            [
                "tar",
                "-czf",
                str(destination / "instance.tar.gz"),
                "-C",
                str(ROOT),
                "compose.yaml",
                "runtime.env",
                "provision.py",
                "backup.py",
                "bootstrap.yaml",
                "mcp-locations.conf.template",
            ],
            check=True,
        )


def main():
    os.umask(0o077)
    BACKUPS.mkdir(mode=0o700, exist_ok=True)
    if shutil.disk_usage(BACKUPS).free < 5 * 1024**3:
        raise RuntimeError("Less than 5 GiB free")
    lock = BACKUPS / "backup.lock"
    lock.mkdir()
    try:
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        destination = BACKUPS / stamp
        destination.mkdir()
        snapshot(destination)
        # The existing uploader pins the NAS certificate and verifies every uploaded byte.
        uploader = Path.home() / "homelab-backups/nas-upload.py"
        payloads = sorted(destination.iterdir())
        with (destination / "verified-files.jsonl").open("x") as out:
            subprocess.run(
                [
                    sys.executable,
                    str(uploader),
                    "--config",
                    str(Path.home() / "homelab-backups/nas-credentials.json"),
                    "--destination",
                    f"/Homelab/backups/mac-mini/penpot-{stamp}",
                    *map(str, payloads),
                ],
                stdout=out,
                check=True,
            )
        (destination / "NAS_VERIFIED").write_text(json.dumps({"snapshot": stamp}) + "\n")
        # Retain seven verified local sets, preserving all incomplete sets and all NAS copies.
        completed = sorted(p for p in BACKUPS.iterdir() if p.is_dir() and (p / "NAS_VERIFIED").is_file())
        for old in completed[:-7]:
            shutil.rmtree(old)
        print(f"Penpot snapshot {stamp} verified on NAS")
    finally:
        lock.rmdir()


if __name__ == "__main__":
    main()
