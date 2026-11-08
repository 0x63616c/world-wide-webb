#!/usr/bin/env python3
"""Opt-in real Docker WAL stress test using synthetic data and disposable storage.

--storage bind reproduces the retired macOS-reader/Linux-writer pattern.
--storage volume exercises Linux-only validation while the HTTP writer commits.
Never mounts production data, secrets or media. Run on the mini with --image
set to the immutable image under investigation. A crash returns nonzero.
"""

import argparse
import json
import os
import sqlite3
import subprocess
import tempfile
import threading
import time
import urllib.request
import uuid
from pathlib import Path


def probe(image, storage, mutations=3000, docker_binary="/opt/homebrew/bin/docker"):
    docker = [docker_binary, "--context", "orbstack"]
    name = "www-storage-probe-" + uuid.uuid4().hex
    done = threading.Event()
    errors = []
    reads = [0]
    volume_created = False

    def command(*args, **kwargs):
        return subprocess.check_output([*docker, *map(str, args)], **kwargs)

    with tempfile.TemporaryDirectory(prefix="www-storage-probe-") as temp:
        if storage == "volume":
            command("volume", "create", name)
            volume_created = True
            mount = f"type=volume,source={name},target=/app/data,volume-nocopy"
        else:
            mount = f"type=bind,source={temp},target=/app/data"
        reader = None
        try:
            # Root is confined to disposable fixture storage; no host secrets or production mounts.
            command(
                "run",
                "-d",
                "--name",
                name,
                "--user",
                "0:0",
                "-e",
                "WORKER_CYCLES=off",
                "--mount",
                mount,
                "-p",
                "127.0.0.1::4201",
                image,
            )
            info = json.loads(command("inspect", name))[0]
            port = info["NetworkSettings"]["Ports"]["4201/tcp"][0]["HostPort"]
            url = "http://127.0.0.1:" + port
            for attempt in range(50):
                try:
                    urllib.request.urlopen(url + "/healthz", timeout=2).close()
                    break
                except OSError:
                    if attempt == 49:
                        raise RuntimeError("Isolated server did not start") from None
                    time.sleep(0.1)

            def read_loop():
                while not done.is_set():
                    connection = None
                    try:
                        if storage == "volume":
                            command("exec", name, "www-server", "database-check", stderr=subprocess.STDOUT)
                        else:
                            path = Path(temp, "control-center.sqlite")
                            connection = sqlite3.connect(path.as_uri() + "?mode=rw", uri=True, timeout=1)
                            connection.execute("PRAGMA query_only=ON")
                            if connection.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                                raise RuntimeError("Fixture integrity failed")
                        reads[0] += 1
                    except Exception as error:
                        errors.append(type(error).__name__)
                        break
                    finally:
                        if connection:
                            connection.close()

            reader = threading.Thread(target=read_loop)
            reader.start()
            successes = 0
            for i in range(mutations):
                request = urllib.request.Request(
                    url + "/api/v1/settings",
                    data=json.dumps({"accent": ["blue", "green"][i % 2]}).encode(),
                    headers={"Content-Type": "application/json"},
                    method="PATCH",
                )
                try:
                    urllib.request.urlopen(request, timeout=5).close()
                    successes += 1
                except OSError as error:
                    errors.append(type(error).__name__)
                    break
            done.set()
            reader.join(timeout=10)
            state = json.loads(command("inspect", name))[0]["State"]
            result = dict(
                storage=storage,
                successful_mutations=successes,
                validation_reads=reads[0],
                errors=errors,
                running=state["Running"],
                exit_code=state["ExitCode"],
                oom=state["OOMKilled"],
            )
            if reader.is_alive():
                result["errors"].append("ReaderDidNotStop")
            if storage == "volume" and state["Running"]:
                command("exec", name, "www-server", "database-check", stderr=subprocess.STDOUT)
                # Graceful restart must preserve committed settings and schema.
                command("restart", "--timeout", "10", name)
                # Docker can reassign an automatically published host port on restart.
                restarted = json.loads(command("inspect", name))[0]
                port = restarted["NetworkSettings"]["Ports"]["4201/tcp"][0]["HostPort"]
                url = "http://127.0.0.1:" + port
                for attempt in range(50):
                    try:
                        with urllib.request.urlopen(url + "/api/v1/settings", timeout=2) as response:
                            actual = json.load(response)
                        assert actual["accent"] == ["blue", "green"][(mutations - 1) % 2]
                        break
                    except OSError:
                        if attempt == 49:
                            raise
                        time.sleep(0.1)
                result["restart_preserved_last_write"] = True
            return result
        finally:
            done.set()
            if reader:
                reader.join(timeout=10)
            subprocess.run([*docker, "rm", "-f", name], check=False, capture_output=True)
            if volume_created:
                subprocess.run([*docker, "volume", "rm", name], check=True, capture_output=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True)
    parser.add_argument("--storage", choices=["bind", "volume"], required=True)
    parser.add_argument("--mutations", type=int, default=3000)
    args = parser.parse_args()
    os.umask(0o077)
    result = probe(args.image, args.storage, args.mutations)
    print(json.dumps(result))
    raise SystemExit(0 if result["running"] and not result["errors"] else 1)
