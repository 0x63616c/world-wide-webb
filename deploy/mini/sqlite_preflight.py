#!/usr/bin/env python3
"""Resolve and validate the production SQLite mount without printing Compose secrets."""

import json
import sys
from pathlib import Path

from sqlite_snapshot import read_database


def main():
    config = json.load(sys.stdin)
    service = config["services"]["www"]
    ports = service.get("ports", [])
    if (
        service.get("network_mode") == "host"
        or len(ports) != 1
        or ports[0].get("host_ip") != "127.0.0.1"
        or ports[0].get("target") != 4201
        or str(ports[0].get("published")) != "4202"
    ):
        raise RuntimeError("The native API must be published on loopback only; Tailscale Serve owns external access")
    mounts = service["volumes"]
    sources = [v["source"] for v in mounts if v.get("target") == "/app/data" and v.get("type") == "bind"]
    if len(sources) != 1:
        raise RuntimeError("exactly one SQLite data directory must be mounted")
    directory = Path(sources[0]).resolve()
    database = directory / "control-center.sqlite"
    if not database.is_file():
        raise RuntimeError("restore the production SQLite database before deploying")
    with read_database(database) as connection:
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
