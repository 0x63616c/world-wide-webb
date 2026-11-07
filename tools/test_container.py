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
        token = "fixture-private-container-token-32-bytes"
        secret = data / "api-token"
        secret.write_text(token)
        secret.chmod(0o600)
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
            "--mount",
            f"type=bind,src={secret},dst=/run/test-api-token,readonly",
            "-e",
            "WWW_API_TOKEN_FILE=/run/test-api-token",
            "-e",
            "WORKER_CYCLES=off",
            "-e",
            "MEDIA_STORAGE_DIR=/app/data/media",
            image,
        )
        try:
            port = docker("port", container, "4201/tcp").split(":")[-1]
            origin = f"http://127.0.0.1:{port}"

            def request(path, body=None, headers=None, authenticated=True):
                auth = {"Authorization": "Bearer " + token} if authenticated else {}
                req = urllib.request.Request(origin + path, data=body, headers=dict(auth, **(headers or {})))
                with urllib.request.urlopen(req, timeout=5) as response:
                    return response.read()

            def ready():
                deadline = time.monotonic() + 30
                while True:
                    try:
                        health = json.loads(request("/healthz", authenticated=False))
                        assert health["build"] == revision
                        assert health["cycles"]["enabled"] is False
                        return
                    except (urllib.error.URLError, TimeoutError):
                        if time.monotonic() > deadline:
                            raise RuntimeError("image did not become ready") from None
                        time.sleep(0.1)

            ready()
            assert json.loads(request("/api/v1/walks/state"))["active"] is None
            walk = json.loads(
                request("/api/v1/walks/start", b'{"source":"ipad"}', {"Content-Type": "application/json"})
            )["active"]
            try:
                request("/api/v1/walks/state", authenticated=False)
                raise AssertionError("unauthenticated state was accepted")
            except urllib.error.HTTPError as error:
                assert error.code == 401
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
            ready()
            assert json.loads(request("/api/v1/walks/state"))["active"]["id"] == walk["id"]
            assert request(path) == photo
            docker("exec", "-e", "EXPECTED_REVISION=" + revision, container, "www-server", "healthcheck")
            print("PASS: image revision, authorization, SQLite restart and Photo Booth bytes")
        finally:
            subprocess.run(["docker", "rm", "-f", container], stdout=subprocess.DEVNULL, check=True)


if __name__ == "__main__":
    main(*sys.argv[1:])
