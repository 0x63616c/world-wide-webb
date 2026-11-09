#!/usr/bin/env python3
"""Check the real image, persisted SQLite and Photo Booth bytes in isolation."""

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


def main(image, revision):
    assert docker("run", "--rm", "--read-only", "--network", "none", image, "version") == revision
    root = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory(prefix="www-image-check-") as scratch:
        data = Path(scratch)
        state = data / "state"
        state.mkdir()
        container = docker(
            "run",
            "-d",
            "--user",
            f"{os.getuid()}:{os.getgid()}",
            "-p",
            "127.0.0.1::4201",
            "--mount",
            f"type=bind,src={state},dst=/app/data",
            "-e",
            "WORKER_CYCLES=off",
            "-e",
            "MEDIA_STORAGE_DIR=/app/data/media",
            image,
        )
        try:
            port = docker("port", container, "4201/tcp").split(":")[-1]
            origin = f"http://127.0.0.1:{port}"

            def request(path, body=None, headers=None):
                req = urllib.request.Request(origin + path, data=body, headers=headers or {})
                with urllib.request.urlopen(req, timeout=5) as response:
                    return response.read()

            def ready():
                deadline = time.monotonic() + 30
                while True:
                    try:
                        health = json.loads(request("/healthz"))
                        assert health["build"] == revision
                        assert health["cycles"]["enabled"] is False
                        return
                    except (urllib.error.URLError, TimeoutError, ConnectionResetError):
                        if time.monotonic() > deadline:
                            subprocess.run(["docker", "logs", "--tail", "30", container], check=False)
                            raise RuntimeError("image did not become ready") from None
                        time.sleep(0.1)

            ready()
            assert json.loads(request("/api/v1/walks/state"))["active"] is None
            walk = json.loads(
                request("/api/v1/walks/start", b'{"source":"ipad"}', {"Content-Type": "application/json"})
            )["active"]
            photo = (root / "apple/Resources/PanelAssets.xcassets/CloudPhoto.imageset/photo.jpg").read_bytes()
            receipt = json.loads(
                request(
                    "/media/booth-photo",
                    photo,
                    {"Content-Type": "image/jpeg", "x-mode": "photo", "x-captured-at": str(int(time.time() * 1000))},
                )
            )
            listing = json.loads(request("/api/v1/booth"))
            path = listing["groups"][0]["frames"][0]["path"]
            assert receipt["id"] == listing["groups"][0]["frames"][0]["id"]
            assert request(path) == photo
            docker("restart", "--time", "10", container)
            # Docker may allocate a new ephemeral host port when recreating networking.
            port = docker("port", container, "4201/tcp").split(":")[-1]
            origin = f"http://127.0.0.1:{port}"
            ready()
            assert json.loads(request("/api/v1/walks/state"))["active"]["id"] == walk["id"]
            assert request(path) == photo
            docker("exec", "-e", "EXPECTED_REVISION=" + revision, container, "www-server", "healthcheck")
            print("PASS: image revision, credential-free private API, SQLite restart and Photo Booth bytes")
        finally:
            subprocess.run(["docker", "rm", "-f", container], stdout=subprocess.DEVNULL, check=True)


if __name__ == "__main__":
    main(*sys.argv[1:])
