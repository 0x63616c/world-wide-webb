#!/usr/bin/env python3
"""Exercise the packaged Mac server without launchd, a GUI or host activation."""

import json
import os
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def check(binary):
    # A short home also keeps Darwin's Unix socket path below its 103-byte limit.
    with tempfile.TemporaryDirectory(prefix="rex-check-", dir="/tmp") as directory:
        root = Path(directory)
        env = {k: v for k, v in os.environ.items() if not k.startswith(("REX_", "XDG_"))}
        env.update(HOME=directory, SHELL="/bin/zsh", USER="rex-check", LOGNAME="rex-check")
        env["PATH"] = f"{Path(binary).parent}:/usr/bin:/bin:/usr/sbin:/sbin"
        socket = root / "Library/Application Support/rex/server.sock"
        marker = root / "survived"
        child_pid = root / "child.pid"

        def cli(*arguments):
            result = subprocess.run(
                [binary, "--autostart=false", "--timeout", "10s", *arguments],
                env=env,
                text=True,
                capture_output=True,
                timeout=15,
                check=False,
            )
            if result.returncode:
                raise RuntimeError(f"Rex {arguments}: {result.stdout}{result.stderr}")
            return result.stdout

        with (root / "server.log").open("w+") as log:
            server = subprocess.Popen(
                [binary, "server", "run", "--state-dir", str(root / "state")],
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            try:
                deadline = time.monotonic() + 15
                while not socket.exists():
                    if server.poll() is not None or time.monotonic() >= deadline:
                        log.seek(0)
                        raise RuntimeError(f"Rex did not become ready: {log.read()}")
                    time.sleep(0.05)
                assert stat.S_IMODE(socket.stat().st_mode) == 0o600
                # The creating CLI exits. A later, separate client must reach the
                # same terminal and deliver input to its still-running process.
                session = json.loads(
                    cli(
                        "new",
                        "disconnect-check",
                        "--json",
                        "--shell",
                        "none",
                        "--cwd",
                        directory,
                        "--",
                        "/bin/sh",
                        "-c",
                        'echo $$ > "$1"; read -r line; printf "%s" "$line" > "$2"; exec /bin/sleep 60',
                        "check",
                        str(child_pid),
                        str(marker),
                    )
                )
                assert session
                cli("send", "-s", "disconnect-check", "survived\n")
                deadline = time.monotonic() + 10
                while not marker.exists():
                    if server.poll() is not None or time.monotonic() >= deadline:
                        raise RuntimeError("Terminal did not survive client disconnect/reconnect")
                    time.sleep(0.05)
                assert marker.read_text() == "survived"
                assert "disconnect-check" in cli("ls")
                server.terminate()
                server.wait(timeout=10)
                assert server.returncode == 0
            finally:
                if server.poll() is None:
                    server.terminate()
                    try:
                        server.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        server.kill()
                        server.wait(timeout=10)
                if child_pid.exists():
                    try:
                        os.kill(int(child_pid.read_text()), 0)
                    except ProcessLookupError:
                        pass
                    else:
                        os.kill(int(child_pid.read_text()), 9)
                        raise RuntimeError("Rex left its terminal child running after shutdown")
    print("Rex: private socket, headless startup, disconnect/reconnect and shutdown passed")


if __name__ == "__main__":
    check(sys.argv[1])
