#!/usr/bin/env python3
"""Exercise the Swift transport against an isolated Rust process, never production."""

import os
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path


def main():
    root = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory(prefix="www-native-api-") as scratch:
        data = Path(scratch)
        token = "fixture-private-native-token-32-bytes"
        credential = data / "token"
        credential.write_text(token)
        credential.chmod(0o600)
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
        env.update(WWW_DATA_DIR=str(data), WWW_API_TOKEN_FILE=str(credential), WWW_LISTEN=f"127.0.0.1:{port}")
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
                            break
                    except (urllib.error.URLError, TimeoutError):
                        if time.monotonic() > deadline:
                            raise RuntimeError("isolated server did not become ready") from None
                        time.sleep(0.05)
                env.update(
                    WWW_NATIVE_TEST_URL=url,
                    WWW_NATIVE_TEST_TOKEN=token,
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
