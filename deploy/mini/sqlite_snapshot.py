"""Consistent SQLite backups shared by nightly and cutover workflows."""

import json
import os
import re
import sqlite3
import subprocess
import tempfile
from contextlib import closing, contextmanager
from pathlib import Path


@contextmanager
def read_database(source):
    """Allow SQLite to initialize cold WAL sidecars while keeping SQL read-only.

    macOS SQLite cannot query a copied WAL-mode database opened with mode=ro
    until sidecars exist. mode=rw still requires an existing file; query_only
    prevents database writes, while allowing SQLite's own WAL bookkeeping.
    """
    if not source.is_file():
        raise FileNotFoundError("SQLite source does not exist")
    with closing(sqlite3.connect(source.resolve().as_uri() + "?mode=rw", uri=True)) as connection:
        connection.execute("PRAGMA query_only=ON")
        yield connection


def sqlite_snapshot(source, destination):
    """SQLite backup API includes committed WAL data; never overwrite a backup."""
    if not source.is_file():
        raise FileNotFoundError("SQLite source does not exist")
    destination.touch(exist_ok=False, mode=0o600)
    with read_database(source) as src:
        with closing(sqlite3.connect(destination)) as target:
            src.backup(target)
            if target.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise RuntimeError("SQLite backup integrity check failed")
            if target.execute("PRAGMA foreign_key_check").fetchone() is not None:
                raise RuntimeError("SQLite backup foreign key check failed")


DOCKER = os.environ.get("WWW_DOCKER_BIN", "/opt/homebrew/bin/docker")
VOLUME = "www-control-center-sqlite"


def docker(*args):
    return [DOCKER, "--context", "orbstack", *map(str, args)]


def inspect_volume(name):
    if name != VOLUME:
        raise RuntimeError("Unexpected production SQLite volume")
    info = json.loads(subprocess.check_output(docker("volume", "inspect", name), text=True))[0]
    if info["Driver"] != "local" or info.get("Options"):
        raise RuntimeError("SQLite requires a Linux-local volume without network or bind options")


def snapshot_container(name, destination):
    """Caller holds deploy.lock; reject a running writer even if it forgot to stop it."""
    info = json.loads(subprocess.check_output(docker("inspect", name), text=True))[0]
    if info["State"]["Running"]:
        raise RuntimeError("Stop the SQLite writer before copying its database directory")
    mounts = [m for m in info["Mounts"] if m["Destination"] == "/app/data"]
    if len(mounts) != 1 or mounts[0]["Type"] != "volume":
        raise RuntimeError("SQLite must use Linux-local volume storage")
    inspect_volume(mounts[0]["Name"])
    with tempfile.TemporaryDirectory(prefix="www-sqlite-snapshot-") as temp:
        # A stopped container preserves the complete SQLite/WAL/SHM set. macOS
        # SQLite opens only this private copy; it never touches the live files.
        subprocess.run(docker("cp", f"{name}:/app/data/.", temp), check=True, capture_output=True)
        sqlite_snapshot(Path(temp) / "control-center.sqlite", Path(destination))


def prune_release_snapshots(root):
    """Bound automatic release copies; never touch incident or migration archives."""
    for prefix, count in [("before-release-", 7), ("before-recovery-", 3)]:
        pattern = (
            r"before-release-\d+-[0-9a-f]{40}-\d{8}T\d{6}Z-\d+\.sqlite"
            if prefix == "before-release-"
            else r"before-recovery-\d{8}T\d{6}Z-\d+\.sqlite"
        )
        copies = sorted(
            (
                p
                for p in root.glob(prefix + "*.sqlite")
                if p.is_file() and not p.is_symlink() and re.fullmatch(pattern, p.name)
            ),
            key=lambda p: p.stat().st_mtime,
        )
        for old in copies[:-count]:
            old.unlink()
            for suffix in ["-wal", "-shm"]:
                Path(str(old) + suffix).unlink(missing_ok=True)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--container", action="store_true", help="Copy a stopped Linux-volume writer")
    parser.add_argument("--prune", action="store_true")
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path, nargs="?")
    args = parser.parse_args()
    if args.prune:
        if args.destination is not None or args.container:
            parser.error("--prune accepts only the backup directory")
        prune_release_snapshots(args.source)
    elif args.destination is None:
        parser.error("Snapshot destination required")
    elif args.container:
        snapshot_container(str(args.source), args.destination)
    else:
        sqlite_snapshot(args.source, args.destination)
