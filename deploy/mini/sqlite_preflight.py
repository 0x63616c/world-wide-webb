#!/usr/bin/env python3
"""Validate production volume in Linux, without printing Compose secrets."""

import json
import subprocess
import sys

from sqlite_snapshot import VOLUME, docker, inspect_volume


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
    mounts = [v for v in service["volumes"] if v.get("target") == "/app/data"]
    if len(mounts) != 1 or mounts[0].get("type") != "volume":
        raise RuntimeError("SQLite requires Linux-local volume storage, never a macOS or NAS bind mount")
    volume = config["volumes"][mounts[0]["source"]]
    if not volume.get("external") or volume["name"] != VOLUME:
        raise RuntimeError("Production SQLite must use the existing external volume")
    inspect_volume(VOLUME)
    # Rollback targets can predate database-check. Probe a known validator with
    # no data/secrets mounts and a read-only root before giving it live storage.
    image = sys.argv[1] if len(sys.argv) == 2 else service["image"]
    capabilities = subprocess.check_output(
        docker("run", "--rm", "--network", "none", "--read-only", "--entrypoint", "www-server", image, "capabilities"),
        text=True,
        timeout=20,
    )
    if json.loads(capabilities) != {"databaseCheck": True}:
        raise RuntimeError("Validator image does not support safe database checks")
    # SQLite locks and shared memory stay in Linux even while the writer runs.
    subprocess.run(
        docker(
            "run",
            "--rm",
            "--network",
            "none",
            "--user",
            service["user"],
            "--mount",
            f"type=volume,source={VOLUME},target=/app/data,volume-nocopy",
            "-e",
            "WWW_DATABASE_PATH=/app/data/control-center.sqlite",
            "--entrypoint",
            "www-server",
            image,
            "database-check",
        ),
        check=True,
        timeout=30,
    )


if __name__ == "__main__":
    main()
