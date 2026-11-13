#!/usr/bin/env python3
"""Verify only selected standard-app Cloudflare backends; never publish."""

import argparse
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def selected(apps):
    if not isinstance(apps, list) or any(
        not isinstance(app, str) or not re.fullmatch(r"[a-z][a-z0-9-]*", app) for app in apps
    ):
        raise ValueError("Expected an array of app folder names")
    return sorted(set(app for app in apps if (ROOT / "projects" / app / "backend/wrangler.jsonc").is_file()))


def smoke(backend):
    # Let the OS choose an unused port; a competing bind fails startup, never talks to production.
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    with tempfile.TemporaryFile(mode="w+") as log:
        process = subprocess.Popen(
            ["bun", "run", "dev", "--local", "--ip", "127.0.0.1", "--port", str(port)],
            cwd=backend,
            stdout=log,
            stderr=log,
            start_new_session=True,
            env=dict(os.environ, WRANGLER_SEND_METRICS="false"),
        )
        try:
            deadline = time.monotonic() + 60
            while True:
                if process.poll() is not None:
                    raise RuntimeError("Local Worker exited before becoming healthy")
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/healthz", timeout=2) as response:
                        health = json.load(response)
                    assert health["status"] == "ok" and health["environment"] == "staging"
                    assert isinstance(health["revision"], str) and health["revision"]
                    return
                except (urllib.error.URLError, TimeoutError, ConnectionResetError):
                    if time.monotonic() >= deadline:
                        raise RuntimeError("Local Worker did not become healthy") from None
                    time.sleep(0.1)
        except BaseException:
            log.seek(0)
            print(log.read())
            raise
        finally:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)


def check(backend):
    subprocess.run(["bun", "install", "--frozen-lockfile"], cwd=backend, check=True)
    subprocess.run(["bun", "run", "check"], cwd=backend, check=True)
    smoke(backend)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apps", default="[]")
    parser.add_argument("--list", action="store_true")
    args = parser.parse_args()
    apps = selected(json.loads(args.apps))
    if args.list:
        print(json.dumps(apps))
        return
    for app in apps:
        check(ROOT / "projects" / app / "backend")


if __name__ == "__main__":
    main()
