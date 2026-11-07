#!/usr/bin/env python3
"""Freeze the old app and retain the release lock through migration acceptance.

Unlike nightly backup.py, this command NEVER restarts the app or automatically
releases its lock. Failed snapshots keep the writer frozen and artifacts intact.
Run only as the cutover owner after automated release gates are held.
"""

import argparse
import hashlib
import json
import os
import subprocess
import tarfile
import uuid
from pathlib import Path

from sqlite_snapshot import sqlite_snapshot

DOCKER = "/opt/homebrew/bin/docker"
APP = "www-control-center-www-1"
POSTGRES = "www-control-center-postgres-1"


def docker(*args):
    return [DOCKER, "--context", "orbstack", *args]


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def snapshot(app_root, destination, engine):
    app_root = app_root.resolve()
    destination = destination.resolve()
    if destination == app_root or app_root in destination.parents:
        raise ValueError("Backup must be outside the app directory")
    if destination.exists():
        raise FileExistsError("Use a new backup destination")
    destination.mkdir(parents=True, mode=0o700)
    lock = app_root / "deploy.lock"
    lock.mkdir()  # Never steal a deployment/backup lock.
    marker = {"owner": uuid.uuid4().hex, "destination": str(destination)}
    (lock / "cutover.json").write_text(json.dumps(marker))
    (destination / "cutover.json").write_text(json.dumps(marker))
    # Everything after acquisition intentionally retains the lock, including errors.
    state = subprocess.check_output(docker("inspect", "--format", "{{.State.Running}}", APP), text=True).strip()
    if state not in ("true", "false"):
        raise RuntimeError("Cannot determine app writer state")
    if state == "true":
        subprocess.run(docker("stop", "--time", "60", APP), check=True, stdout=subprocess.DEVNULL)
    running = subprocess.check_output(docker("inspect", "--format", "{{.State.Running}}", APP), text=True).strip()
    if running != "false":
        raise RuntimeError("App writer did not stop")
    if engine == "postgres":
        with (destination / "control-center.dump").open("xb") as output:
            subprocess.run(
                docker("exec", POSTGRES, "pg_dump", "-U", "postgres", "-d", "control_center", "-Fc"),
                check=True,
                stdout=output,
            )
    elif engine == "sqlite":
        sqlite_snapshot(app_root / "data/sqlite/control-center.sqlite", destination / "control-center.sqlite")
    else:
        raise ValueError("Unsupported database engine")
    with tarfile.open(destination / "control-center-files.tar.gz", "x:gz") as archive:
        for name in ("data/media", "secrets", "runtime.env", "current.env", "compose.yaml", "release.sh", "recover.sh"):
            archive.add(app_root / name, arcname=name)
    # Manifest contains only archive metadata, never payload/secret values.
    files = [
        {"name": p.name, "bytes": p.stat().st_size, "sha256": digest(p)}
        for p in sorted(destination.iterdir())
        if p.name != "cutover.json"
    ]
    (destination / "SNAPSHOT.json").write_text(json.dumps({"engine": engine, "files": files}, indent=2))
    return marker


def release_lock(app_root, destination):
    """Explicit operator action after successful acceptance or completed rollback."""
    lock = app_root.resolve() / "deploy.lock"
    marker = json.loads((destination.resolve() / "cutover.json").read_text())
    if json.loads((lock / "cutover.json").read_text()) != marker:
        raise RuntimeError("Cutover lock ownership mismatch")
    if marker["destination"] != str(destination.resolve()):
        raise RuntimeError("Cutover destination mismatch")
    (lock / "cutover.json").unlink()
    lock.rmdir()  # Unexpected files prevent removal; never recursively remove a lock.


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["snapshot", "release-lock"])
    parser.add_argument("--app-root", type=Path, required=True)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--engine", choices=["postgres", "sqlite"], default="postgres")
    args = parser.parse_args()
    if args.operation == "snapshot":
        snapshot(args.app_root, args.destination, args.engine)
        print("Snapshot complete. App remains stopped; deployment lock remains held.")
    else:
        release_lock(args.app_root, args.destination)
        print("Cutover lock released. No service was started.")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Some subprocess/file exception strings may expose configuration; types suffice.
        print(
            f"Cutover operation failed: {type(error).__name__}. Inspect lock and retained snapshots.",
            file=__import__("sys").stderr,
        )
        raise SystemExit(1)
