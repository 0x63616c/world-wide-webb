#!/usr/bin/env python3
"""Read-only verification of a downloaded snapshot set; never restores data."""

import argparse
import hashlib
import json
import re
import tarfile
from pathlib import Path, PurePosixPath

PAYLOADS = {
    "golink": {"golink-data.tar.gz"},
    "control-center": {"control-center.sqlite", "control-center-media.tar.gz"},
    "home-assistant": {"home-assistant-config.tar.gz"},
    "bambuddy": {"bambuddy-data.tar.gz", "bambuddy-studio.tar.gz", "bambuddy-tailscale.tar.gz"},
    "hindsight": {"hindsight.dump", "hindsight-codex-home.tar.gz"},
    "beszel": {"beszel-data.tar.gz"},
    "cloudflared": set(),
    "penpot": {"penpot.dump", "penpot-assets.tar.gz", "penpot-valkey.tar.gz"},
}


CONTAINERS = {
    "golink": {"golink"},
    "control-center": {"www-control-center-www-1"},
    "home-assistant": {"www-home-assistant-home-assistant-1"},
    "bambuddy": {"bambuddy", "bambu-studio-api", "bambuddy-tailscale"},
    "hindsight": {"hindsight"},
    "beszel": {"beszel-beszel-1"},
    "cloudflared": {"www-tunnel-cloudflared-1"},
    "penpot": {
        "penpot-penpot-frontend-1",
        "penpot-penpot-mcp-1",
        "penpot-penpot-exporter-1",
        "penpot-penpot-admin-console-1",
        "penpot-penpot-backend-1",
        "penpot-penpot-postgres-1",
        "penpot-penpot-valkey-1",
    },
}
CREDENTIALS = {
    "golink": {"environment"},
    "control-center": {"HA_TOKEN", "ALARM_API_TOKEN", "HOME_LAT", "HOME_LON", "WIFI_GUEST_SSID", "WIFI_GUEST_PASSWORD"},
    "bambuddy": {"environment", "serve.json"},
    "hindsight": {"environment"},
    "beszel": {"environment", "config.yml"},
    "cloudflared": {"TUNNEL_TOKEN"},
    "home-assistant": set(),
    "penpot": {"environment"},
}


def regular(path):
    if path.is_symlink() or not path.is_file():
        raise ValueError("Expected a regular snapshot file: " + path.name)


def host_metadata(archive):
    metadata = None
    members = {}
    # Stream headers; do not extract anything or follow archive links.
    with tarfile.open(archive, "r|gz") as source:
        for count, member in enumerate(source):
            if count > 10000:
                raise ValueError("Recovery archive has too many entries")
            path = PurePosixPath(member.name)
            if path.is_absolute() or ".." in path.parts or member.issym() or member.islnk():
                raise ValueError("Unsafe recovery archive entry")
            if not (member.isfile() or member.isdir()):
                raise ValueError("Unsupported recovery archive entry")
            name = str(path)
            if name in members:
                raise ValueError("Duplicate recovery archive entry")
            members[name] = (member.isfile(), member.size)
            if name == "host.json":
                if metadata is not None or not member.isfile() or member.size > 65536:
                    raise ValueError("Invalid or duplicate recovery metadata")
                metadata = json.load(source.extractfile(member))
    if not isinstance(metadata, dict):
        raise ValueError("Recovery host metadata is missing")
    if metadata.get("host") not in ("homelab-macbook", "homelab-mac-mini"):
        raise ValueError("Unknown backup host")
    services = metadata.get("services")
    if not isinstance(services, list) or not services or any(not isinstance(s, str) for s in services):
        raise ValueError("Invalid service inventory")
    if len(set(services)) != len(services) or set(services) - PAYLOADS.keys():
        raise ValueError("Invalid service assignment")
    required = {"host.json"}
    for service in services:
        required.add("compose/" + service + "/compose.yaml")
        required.update("credentials/" + service + "/" + name for name in CREDENTIALS[service])
    if any(service != "home-assistant" for service in services):
        required.add("containers.env")
    if "control-center" in services:
        required.add("compose/control-center/release.json")
    if "beszel" in services:
        required.add("compose/beszel/config.yml")
    if "penpot" in services:
        required.add("compose/penpot/mcp-locations.conf.template")
    if "bambuddy" in services:
        required.add("compose/bambuddy/tailscale/serve.json")
    # Inspect archive headers only: credential contents never need to be read.
    if any(name not in members or not members[name][0] for name in required):
        raise ValueError("Recovery archive lacks required service files")
    if any(members[name][1] == 0 for name in required if not name.startswith("credentials/")):
        raise ValueError("Recovery configuration is empty")
    return metadata


def verify_images(path, services):
    if path.stat().st_size > 1024 * 1024:
        raise ValueError("Image inventory is too large")
    images = json.loads(path.read_text())
    expected = set().union(*(CONTAINERS[service] for service in services))
    if not isinstance(images, dict) or set(images) != expected:
        raise ValueError("Image inventory does not match assigned containers")
    for image in images.values():
        if not isinstance(image, dict) or set(image) != {"id", "repo_digests"}:
            raise ValueError("Invalid image identity")
        if not isinstance(image["id"], str) or not re.fullmatch(r"sha256:[a-f0-9]{64}", image["id"]):
            raise ValueError("Invalid image ID")
        digests = image["repo_digests"]
        if not isinstance(digests, list) or any(
            not isinstance(digest, str) or not re.fullmatch(r"[A-Za-z0-9._:/-]+@sha256:[a-f0-9]{64}", digest)
            for digest in digests
        ):
            raise ValueError("Invalid image repository digest")


def verify_beszel_data(path):
    # A healthy restored hub must keep its account/history database and SSH key.
    # Inspect headers only; never read or display the private identity.
    required = {"data.db", "id_ed25519"}
    seen = set()
    total = 0
    with tarfile.open(path, "r|gz") as archive:
        for member in archive:
            name = PurePosixPath(member.name)
            normalized = str(name)
            if (
                name.is_absolute()
                or ".." in name.parts
                or not (member.isfile() or member.isdir())
                or normalized in seen
            ):
                raise ValueError("Unsafe or duplicate Beszel data archive entry")
            seen.add(normalized)
            total += member.size
            if len(seen) > 100000 or member.size < 0 or total > 16 * 1024**3:
                raise ValueError("Beszel data archive exceeds recovery limits")
            if member.isfile() and member.size > 0:
                required.discard(normalized)
    if required:
        raise ValueError("Beszel data archive lacks its database or SSH identity")


def verify(root, require_full=False):
    if root.is_symlink() or not root.is_dir():
        raise ValueError("Snapshot root must be a directory, not a symlink")
    complete = root / "COMPLETE.json"
    regular(complete)
    if complete.stat().st_size > 1024 * 1024:
        raise ValueError("Completion manifest is too large")
    manifest = json.loads(complete.read_text())
    if not isinstance(manifest, dict) or manifest.get("format") != 1:
        raise ValueError("Unsupported completion manifest")
    records = manifest.get("files")
    if not isinstance(records, list) or not records:
        raise ValueError("Empty or invalid payload manifest")
    names = set()
    for record in records:
        if not isinstance(record, dict):
            raise ValueError("Invalid payload record")
        name = record.get("file")
        if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_-][A-Za-z0-9_.-]*", name):
            raise ValueError("Invalid payload filename")
        if name in names or name in ("COMPLETE.json", "NAS_VERIFIED"):
            raise ValueError("Duplicate or reserved payload filename")
        names.add(name)
        digest, size = record.get("sha256"), record.get("bytes")
        if not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise ValueError("Invalid payload checksum")
        if type(size) is not int or size <= 0:
            raise ValueError("Invalid payload byte count")
        path = root / name
        regular(path)
        if path.stat().st_size != size:
            raise ValueError("Payload size mismatch: " + name)
        checksum = hashlib.sha256()
        with path.open("rb") as payload:
            for chunk in iter(lambda: payload.read(1024 * 1024), b""):
                checksum.update(chunk)
        if checksum.hexdigest() != digest:
            raise ValueError("Payload checksum mismatch: " + name)
    sidecars = {"COMPLETE.json", "NAS_VERIFIED", "LOCAL_VERIFIED.json", "PINNED"}
    for name in sidecars:
        path = root / name
        if path.exists():
            regular(path)
    actual = {path.name for path in root.iterdir()} - sidecars
    if actual != names:
        raise ValueError("Snapshot contains unlisted or missing payloads")
    if not {"images.json", "recovery.tar.gz"} <= names:
        raise ValueError("Snapshot recovery metadata is incomplete")
    metadata = host_metadata(root / "recovery.tar.gz")
    if require_full and metadata.get("scope", "full") != "full":
        raise ValueError("Scoped recovery set cannot restore a full host")
    verify_images(root / "images.json", metadata["services"])
    expected = {"images.json", "recovery.tar.gz"}
    for service in metadata["services"]:
        expected.update(PAYLOADS[service])
    if metadata.get("weeklyHindsightExport", False):
        if "hindsight" not in metadata["services"]:
            raise ValueError("Weekly exports require Hindsight assignment")
        expected.add("hindsight-bank-exports.tar.gz")
    if names != expected:
        raise ValueError("Payloads do not match the recorded service assignment")
    if "beszel" in metadata["services"]:
        verify_beszel_data(root / "beszel-data.tar.gz")
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--require-full", action="store_true")
    args = parser.parse_args()
    result = verify(args.directory, require_full=args.require_full)
    print("Verified snapshot for " + result["host"] + ": " + ", ".join(result["services"]))


if __name__ == "__main__":
    main()
