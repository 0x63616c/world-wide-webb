#!/usr/bin/env python3
"""Resolve and validate the production SQLite mount without printing Compose secrets."""

import json
import sqlite3
import sys
from pathlib import Path


def main():
    config = json.load(sys.stdin)
    mounts = config["services"]["www"]["volumes"]
    sources = [v["source"] for v in mounts if v.get("target") == "/app/data" and v.get("type") == "bind"]
    if len(sources) != 1:
        raise RuntimeError("exactly one SQLite data directory must be mounted")
    directory = Path(sources[0]).resolve()
    database = directory / "control-center.sqlite"
    if not database.is_file():
        raise RuntimeError("restore the production SQLite database before deploying")
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as connection:
        if connection.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
            raise RuntimeError("SQLite integrity check failed")
        # Reject a freshly created/incorrect database, even when SQLite itself is valid.
        required = {"settings", "booth_photo", "walk", "_sqlx_migrations"}
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not required.issubset(tables):
            raise RuntimeError("production SQLite schema is missing")
    print(directory)


if __name__ == "__main__":
    main()
