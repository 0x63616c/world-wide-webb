"""Shared durable state publication for recovery barriers."""

import json
import os
from pathlib import Path
import tempfile


def sync_directory(directory):
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_json(path, value, mode=0o600):
    path = Path(path)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            os.fchmod(stream.fileno(), mode)
            json.dump(value, stream)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        sync_directory(path.parent)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def hold(path, mode=0o600):
    # A hold is an existence barrier; its content carries no credentials.
    write_json(path, {"hold": True}, mode)


def remove(path):
    path = Path(path)
    path.unlink()
    sync_directory(path.parent)
