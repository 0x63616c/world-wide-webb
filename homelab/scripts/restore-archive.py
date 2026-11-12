#!/usr/bin/env python3
"""Materialize an authenticated service archive into fresh, private user storage.

Never extract as host root. Original UID/GID/modes are returned for a separately
reviewed import into fresh container storage, not applied to host paths here.
"""

import argparse
import os
from pathlib import Path, PurePosixPath
import shutil
import tarfile


def members(archive, max_bytes, max_members):
    records = []
    seen = set()
    total = 0
    with tarfile.open(archive, "r:*") as source:
        for member in source:
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or not (member.isfile() or member.isdir()):
                raise ValueError("Unsafe archive entry type or path")
            normalized = str(path)
            if normalized == "." and not member.isdir():
                raise ValueError("Invalid root file entry")
            if normalized in seen:
                raise ValueError("Duplicate archive path")
            seen.add(normalized)
            if len(seen) > max_members:
                raise ValueError("Archive contains too many entries")
            if member.size < 0:
                raise ValueError("Invalid archive size")
            total += member.size
            if total > max_bytes:
                raise ValueError("Archive exceeds the extraction budget")
            records.append(
                {
                    "path": normalized,
                    "directory": member.isdir(),
                    "bytes": member.size,
                    "uid": member.uid,
                    "gid": member.gid,
                    "mode": member.mode & 0o777,
                }
            )
    return records, total


def extract(archive, destination, max_bytes=16 * 1024**3, max_members=100000, reserve_bytes=1024**3):
    if os.geteuid() == 0:
        raise RuntimeError("Extract into operator/service-owned storage, never host root")
    if archive.is_symlink() or not archive.is_file():
        raise ValueError("Expected a regular archive")
    if destination.exists() or destination.is_symlink():
        raise ValueError("Use a fresh extraction directory")
    records, total = members(archive, max_bytes, max_members)
    if shutil.disk_usage(destination.parent).free < total + reserve_bytes:
        raise RuntimeError("Insufficient extraction headroom")
    destination.mkdir(mode=0o700)
    oldmask = os.umask(0o077)
    try:
        with tarfile.open(archive, "r:*") as source:
            count = 0
            for index, member in enumerate(source):
                if index >= len(records):
                    raise ValueError("Archive changed after validation")
                record = records[index]
                count = index + 1
                actual = {
                    "path": str(PurePosixPath(member.name)),
                    "directory": member.isdir(),
                    "bytes": member.size,
                    "uid": member.uid,
                    "gid": member.gid,
                    "mode": member.mode & 0o777,
                }
                if actual != record or not (member.isfile() or member.isdir()):
                    raise ValueError("Archive changed after validation")
                target = destination / record["path"]
                if member.isdir():
                    target.mkdir(mode=0o700, parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                # Never overwrite a file or follow a link in fresh storage.
                fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, "wb") as output, source.extractfile(member) as content:
                    shutil.copyfileobj(content, output, length=1024 * 1024)
                    if output.tell() != record["bytes"]:
                        raise ValueError("Truncated archive payload")
                    output.flush()
                    os.fsync(output.fileno())
            if count != len(records):
                raise ValueError("Archive changed after validation")
        return records
    finally:
        os.umask(oldmask)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    records = extract(args.archive, args.destination)
    print(
        "Extracted",
        len(records),
        "validated entries into fresh private storage; container ownership still needs reviewed import.",
    )


if __name__ == "__main__":
    main()
