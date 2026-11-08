"""Consistent SQLite backups shared by nightly and cutover workflows."""

import sqlite3
from contextlib import closing, contextmanager


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


if __name__ == "__main__":
    import argparse
    from pathlib import Path

    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    sqlite_snapshot(args.source, args.destination)
