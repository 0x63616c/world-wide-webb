"""Publish immutable locally accepted recovery sets without touching live services."""

import fcntl
import hashlib
import json
import os
import re
import stat
import time
from contextlib import contextmanager

import durable
from bounded import run_independent

STAMP = re.compile(r"\d{8}T\d{6}Z-[a-f0-9]{8}")
SIDECARS = {"LOCAL_VERIFIED.json", "NAS_VERIFIED", "PINNED"}


def digest(path):
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


@contextmanager
def publication_lock(root, blocking=False):
    path = root / ".publisher.lock"
    fd = os.open(path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if info.st_uid != os.geteuid() or not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
            raise ValueError("Unsafe publisher lock")
        fcntl.flock(fd, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        yield
    finally:
        os.close(fd)


def accept_local(destination, remote, scope, services, transaction, verify, health, timings=None):
    records = [
        {"file": p.name, "bytes": p.stat().st_size, "sha256": digest(p)}
        for p in sorted(destination.iterdir())
        if p.name not in SIDECARS | {"COMPLETE.json"}
    ]
    durable.write_json(destination / "COMPLETE.json", {"format": 1, "files": records})
    verify(destination)
    health()
    for path in destination.iterdir():
        with path.open("rb") as stream:
            os.fsync(stream.fileno())
    if transaction:
        durable.write_json(destination / "PINNED", {"transaction": transaction})
    durable.write_json(
        destination / "LOCAL_VERIFIED.json",
        {
            "format": 1,
            "remote": remote,
            "scope": scope,
            "services": services,
            "transaction": transaction,
            "manifestSha256": digest(destination / "COMPLETE.json"),
            "timings": timings or {},
            "payloadBytes": sum(r["bytes"] for r in records),
        },
    )


def publish_set(destination, client, verify):
    """No current-generation paths or health commands enter this interface."""
    started = time.monotonic()
    info = destination.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise ValueError("Unsafe pending set")
    receipt_path = destination / "LOCAL_VERIFIED.json"
    if receipt_path.is_symlink() or not receipt_path.is_file():
        raise ValueError("Missing local acceptance")
    receipt = json.loads(receipt_path.read_text())
    if receipt.get("format") != 1 or receipt.get("manifestSha256") != digest(destination / "COMPLETE.json"):
        raise ValueError("Unsupported or altered pending set")
    metadata = verify(destination)
    if metadata["services"] != receipt.get("services") or metadata.get("scope", "full") != receipt.get("scope"):
        raise ValueError("Pending set scope differs")
    remote = receipt["remote"]
    namespace = (
        ""
        if receipt["scope"] == "full"
        else {"deployment": "deployment/", "control-center-hourly": "control-center-history/", "penpot": "penpot/"}[
            receipt["scope"]
        ]
    )
    expected = "/Homelab/backups/" + metadata["host"] + "/" + namespace + destination.name
    if remote != expected or not STAMP.fullmatch(destination.name):
        raise ValueError("Pending destination differs from capture")
    manifest = json.loads((destination / "COMPLETE.json").read_text())

    def transfer(record):
        nas = client()
        try:
            nas.login()
            nas.ensure_file(destination / record["file"], remote, record["sha256"], record["bytes"])
        finally:
            nas.logout()

    run_independent(manifest["files"], transfer)
    nas = client()
    try:
        nas.login()
        complete = destination / "COMPLETE.json"
        nas.ensure_file(complete, remote, digest(complete), complete.stat().st_size)
    finally:
        nas.logout()
    durable.write_json(
        destination / "NAS_VERIFIED",
        {"manifestSha256": receipt["manifestSha256"], "publicationSeconds": round(time.monotonic() - started, 6)},
    )
    return receipt


def pending_sets(root, include_verified=False):
    # Fixed namespaces; never follow arbitrary paths from manifests.
    for parent in [root, *(root / n for n in ("deployment", "control-center-history", "penpot"))]:
        if not parent.is_dir() or parent.is_symlink():
            continue
        for path in sorted(parent.iterdir()):
            if STAMP.fullmatch(path.name) and path.is_dir() and not path.is_symlink():
                if (path / "LOCAL_VERIFIED.json").is_file() and (
                    include_verified or not (path / "NAS_VERIFIED").exists()
                ):
                    yield path
