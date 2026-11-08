#!/usr/bin/env python3
"""Exercise the Swift transport against an isolated Rust process, never production."""

import json
import os
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


@contextmanager
def home_assistant_fixture():
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_GET(self):
            if self.path != "/api/states":
                self.send_error(404)
                return
            payload = json.dumps(
                [
                    {
                        "entity_id": "climate.integration_fixture",
                        "state": "cool",
                        "attributes": {
                            "temperature": 72,
                            "current_temperature": 73,
                            "hvac_action": "cooling",
                            "fan_mode": "auto",
                        },
                    }
                ]
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield "http://127.0.0.1:" + str(server.server_port)
        finally:
            server.shutdown()
            thread.join()


def main():
    root = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory(prefix="www-native-api-") as scratch, home_assistant_fixture() as ha_url:
        data = Path(scratch)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        # The test server must never inherit integration credentials or paths.
        env = dict(os.environ)
        keys = [
            "HA_URL",
            "HA_TOKEN",
            "HOME_LAT",
            "HOME_LON",
            "TESLA_ENTITIES",
            "CLIMATE_ENTITY_ID",
            "WIFI_GUEST_SSID",
            "WIFI_GUEST_PASSWORD",
            "ALARM_LIGHT_TARGET",
            "ALARM_SNOOZE_MINUTES",
            "ALARM_API_TOKEN",
            "BEDROOM_SWITCH_INPUT_ENABLED",
            "BEDROOM_SWITCH_INPUT_VERIFIED",
            "BEDROOM_SWITCH_INPUT_ENTITY_ID",
        ]
        for key in keys:
            env.pop(key, None)
            env.pop(key + "_FILE", None)
        for key in ["WWW_SECRETS_DIR", "WWW_DATABASE_PATH", "MEDIA_STORAGE_DIR"]:
            env.pop(key, None)
        env.update(
            WWW_DATA_DIR=str(data),
            WWW_LISTEN=f"127.0.0.1:{port}",
            HA_URL=ha_url,
            HA_TOKEN="integration-fixture",
            WORKER_CYCLES="on",
        )
        url = f"http://127.0.0.1:{port}"
        with (data / "server.log").open("wb") as log:
            server = subprocess.Popen([str(root / "target/debug/www-server")], env=env, stdout=log, stderr=log)
            try:
                deadline = time.monotonic() + 15
                while True:
                    if server.poll() is not None:
                        raise RuntimeError("isolated server exited during startup")
                    try:
                        with urllib.request.urlopen(url + "/healthz", timeout=1):
                            with urllib.request.urlopen(url + "/api/v1/climate", timeout=1):
                                break
                    except (urllib.error.URLError, TimeoutError):
                        if time.monotonic() > deadline:
                            raise RuntimeError("isolated server did not become ready") from None
                        time.sleep(0.05)
                env.update(
                    WWW_NATIVE_TEST_URL=url,
                    WWW_NATIVE_TEST_PHOTO=str(
                        root / "apple/Resources/PanelAssets.xcassets/CloudPhoto.imageset/photo.jpg"
                    ),
                )
                subprocess.run(
                    [
                        "swift",
                        "test",
                        "--package-path",
                        str(root / "apple/Packages/PanelKit"),
                        "--filter",
                        "NativeServerRoundTrip",
                    ],
                    env=env,
                    check=True,
                )
            finally:
                server.terminate()
                try:
                    server.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    server.kill()
                    server.wait()


if __name__ == "__main__":
    main()
