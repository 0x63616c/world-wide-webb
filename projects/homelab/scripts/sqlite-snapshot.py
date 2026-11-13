"""Consistent cold snapshots of the native Control Center SQLite volume."""

from contextlib import closing
import json
from pathlib import Path
import sqlite3
import subprocess
import tempfile


def snapshot_database(source, destination):
    if source.is_symlink() or not source.is_file():
        raise ValueError("SQLite source must be a regular file")
    if destination.exists() or destination.is_symlink():
        raise ValueError("Snapshot destination already exists")
    destination.touch(mode=0o600, exist_ok=False)
    # WAL bookkeeping is allowed only in this private cold copy; never open the
    # production volume from macOS SQLite or copy only its main database file.
    with closing(sqlite3.connect(source.resolve().as_uri() + "?mode=rw", uri=True)) as src:
        src.execute("PRAGMA query_only=ON")
        with closing(sqlite3.connect(destination)) as dst:
            src.backup(dst)
            if dst.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise RuntimeError("SQLite snapshot integrity failed")
            if dst.execute("PRAGMA foreign_key_check").fetchone() is not None:
                raise RuntimeError("SQLite snapshot foreign keys failed")


def snapshot_container(destination, docker, run):
    name = "www-control-center-www-1"
    projection = '{"running":{{json .State.Running}},"mounts":{{json .Mounts}}}'
    facts = json.loads(
        run(
            docker("services", "inspect", "--format", projection, name), capture_output=True, text=True, timeout=30
        ).stdout
    )
    if facts["running"]:
        raise RuntimeError("Refusing to copy a running SQLite writer")
    mounts = [m for m in facts["mounts"] if m["Destination"] == "/app/data"]
    if len(mounts) != 1 or mounts[0]["Type"] != "volume":
        raise RuntimeError("SQLite requires a Linux-local Docker volume")
    name_volume = mounts[0]["Name"]
    volume = json.loads(
        run(docker("services", "volume", "inspect", name_volume), capture_output=True, text=True, timeout=30).stdout
    )[0]
    if volume["Driver"] != "local" or volume.get("Options"):
        raise RuntimeError("Network-backed SQLite storage is forbidden")
    with tempfile.TemporaryDirectory(prefix="homelab-sqlite-") as directory:
        run(
            docker("services", "cp", name + ":/app/data/.", directory),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        snapshot_database(Path(directory) / "control-center.sqlite", destination)
