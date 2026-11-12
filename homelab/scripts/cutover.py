#!/usr/bin/env python3
"""Cold cutover archives; caller must hold the host lock and pause deployers.

Unlike nightly backups this operation NEVER restarts the source, even on error.
It removes Docker automatic restart policies before stopping, journals progress
before mutation and copies complete mounted directories only after all writers
in the declared group are stopped. A failure requires explicit operator recovery.
"""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

import durable

# Order stops clients before their databases or identity sidecars.
SERVICES = {
    "control-center": {
        "www-control-center-www-1": {"/app/data": "sqlite.tar", "/app/media": "media.tar"},
    },
    "penpot": {
        "penpot-penpot-frontend-1": {},
        "penpot-penpot-mcp-1": {},
        "penpot-penpot-exporter-1": {},
        "penpot-penpot-admin-console-1": {},
        "penpot-penpot-backend-1": {"/opt/data/assets": "assets.tar"},
        "penpot-penpot-postgres-1": {"/var/lib/postgresql/data": "postgres.tar"},
        "penpot-penpot-valkey-1": {"/data": "valkey.tar"},
    },
    "bambuddy": {
        "bambuddy": {"/app/data": "app.tar", "/app/logs": "logs.tar"},
        "bambu-studio-api": {"/app/data": "studio.tar"},
        "bambuddy-tailscale": {"/var/lib/tailscale": "identity.tar"},
    },
    "hindsight": {
        "hindsight": {"/home/hindsight/.pg0": "postgres.tar", "/home/hindsight/.codex-hindsight": "codex-home.tar"},
    },
    "home-assistant": {
        "www-home-assistant-home-assistant-1": {"/config": "config.tar"},
    },
    "cloudflared": {"www-tunnel-cloudflared-1": {}},
}


def run(command, **kwargs):
    # Docker diagnostics may contain private configuration; never relay them.
    result = subprocess.run(command, stderr=subprocess.PIPE, timeout=180, **kwargs)
    if result.returncode:
        raise RuntimeError("Cutover command failed; inspect private source state")
    return result


def facts(docker, name):
    projection = (
        '{"running":{{json .State.Running}},"image":{{json .Image}},'
        '"restart":{{json .HostConfig.RestartPolicy}},'
        '"mounts":{{json .Mounts}}}'
    )
    return json.loads(run([*docker, "inspect", "--format", projection, name], stdout=subprocess.PIPE).stdout)


def cutover(service, destination, docker):
    if service not in SERVICES or not docker:
        raise ValueError("Unknown service or missing Docker command")
    if destination.exists() or destination.is_symlink():
        raise ValueError("Use a new cutover destination; partial attempts require inspection")
    os.umask(0o077)
    destination.mkdir(mode=0o700)
    containers = SERVICES[service]
    # Read-only preflight of every container before changing any restart policy.
    initial = {name: facts(docker, name) for name in containers}
    for name, paths in containers.items():
        state = initial[name]
        if not state["running"]:
            raise RuntimeError("Cutover requires an initially running source group")
        for path in paths:
            if not any(m["Destination"] == path for m in state["mounts"]):
                raise RuntimeError("Expected persistent mount is absent")
    receipt = {
        "format": 1,
        "service": service,
        "phase": "prepared",
        "containers": initial,
        "stopped": [],
        "archives": {},
    }
    journal = destination / "cutover.json"
    durable.write_json(journal, receipt)
    for name in containers:
        receipt.update(phase="stopping", current=name)
        durable.write_json(journal, receipt)
        run([*docker, "update", "--restart=no", name], stdout=subprocess.DEVNULL)
        run([*docker, "stop", "--time", "120", name], stdout=subprocess.DEVNULL)
        if facts(docker, name)["running"]:
            raise RuntimeError("Source still running after stop")
        receipt["stopped"].append(name)
        durable.write_json(journal, receipt)
    receipt["phase"] = "copying"
    durable.write_json(journal, receipt)
    import hashlib

    for name, paths in containers.items():
        for path, filename in paths.items():
            target = destination / filename
            with target.open("xb") as output:
                run([*docker, "cp", name + ":" + path + "/.", "-"], stdout=output)
                output.flush()
                os.fsync(output.fileno())
            if not target.stat().st_size:
                raise RuntimeError("Empty cutover archive")
            digest = hashlib.sha256()
            with target.open("rb") as source:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(block)
            receipt["archives"][filename] = {
                "container": name,
                "path": path,
                "bytes": target.stat().st_size,
                "sha256": digest.hexdigest(),
            }
            durable.write_json(journal, receipt)
    for name in containers:
        latest = facts(docker, name)
        if latest["running"] or latest["restart"]["Name"] != "no":
            raise RuntimeError("Source restarted or its restart policy changed during cutover")
    receipt.pop("current", None)
    receipt["phase"] = "source-stopped"
    durable.write_json(journal, receipt)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("service", choices=SERVICES)
    parser.add_argument("--destination", type=Path, required=True)
    parser.add_argument("--docker", type=Path, required=True)
    parser.add_argument("--socket", required=True)
    parser.add_argument("--deployers-paused", action="store_true")
    args = parser.parse_args()
    if not args.deployers_paused or not os.environ.get("HOMELAB_OPERATION_FD"):
        parser.error("Run beneath homelab-operation only after pausing competing deployers")
    if not args.docker.is_absolute() or not args.socket.startswith("unix:///"):
        parser.error("Use an absolute Docker executable and local Unix socket")
    # Verify the inherited descriptor against the real lock, not just its presence.
    import importlib.util

    spec = importlib.util.spec_from_file_location("operation_lock", Path(__file__).with_name("operation-lock.py"))
    lock = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(lock)
    value = os.environ["HOMELAB_OPERATION_FD"]
    if not re.fullmatch(r"[0-9]+", value) or int(value) < 3:
        parser.error("Invalid inherited operation lock")
    with lock.operation_lock(inherited_fd=int(value)):
        cutover(args.service, args.destination, [str(args.docker), "--host", args.socket])
    print("Cutover snapshot complete; source remains stopped. Restore and validate before switching routes.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, subprocess.SubprocessError, ValueError):
        print(
            "Cutover incomplete. Source was not automatically restarted; inspect its private journal.", file=sys.stderr
        )
        raise SystemExit(1)
