#!/usr/bin/env python3
"""One bounded, launchd-scheduled check of the mini's Cloudflare connection."""

import fcntl
import http.client
import json
import logging
import re
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path

CONTAINER = "www-tunnel-cloudflared-1"
DOCKER = ["/opt/homebrew/bin/docker", "--context", "orbstack"]
STATE_DIR = Path.home() / "www-tunnel" / "recovery"
STARTUP_GRACE = 120
FAILURE_THRESHOLD = 3
RESTART_COOLDOWN = 300
LOG = logging.getLogger("tunnel-recovery")


@dataclass(frozen=True)
class Container:
    id: str
    status: str
    paused: bool
    started_at: float

    @property
    def generation(self):
        return f"{self.id}:{self.started_at}"

    def eligible(self, now):
        return self.status == "running" and not self.paused and now - self.started_at >= STARTUP_GRACE


def event(name, **fields):
    LOG.info(json.dumps({"time": datetime.now(timezone.utc).isoformat(), "event": name, **fields}, sort_keys=True))


def inspect_container():
    # Never inspect environment variables, mounts, credentials, or health logs.
    result = subprocess.run(
        DOCKER + ["inspect", "--format", "{{.Id}} {{.State.Status}} {{.State.Paused}} {{.State.StartedAt}}", CONTAINER],
        capture_output=True,
        text=True,
        timeout=10,
        check=True,
    )
    identity, status, paused, started = result.stdout.strip().split()
    # Docker emits nanoseconds; the mini's Python 3.9 accepts only microseconds.
    started = re.sub(r"(\.\d{6})\d+(?=Z$)", r"\1", started)
    started_at = datetime.fromisoformat(started.replace("Z", "+00:00")).timestamp()
    return Container(identity, status, paused == "true", started_at)


def tunnel_ready():
    # Direct loopback request: no proxy, Access login, redirects, or public DNS.
    connection = http.client.HTTPConnection("127.0.0.1", 20241, timeout=5)
    try:
        connection.request("GET", "/ready")
        response = connection.getresponse()
        return response.status == 200
    except (OSError, http.client.HTTPException):
        return False
    finally:
        connection.close()


def restart_container(identity):
    # Use the observed ID, so a concurrent replacement cannot become our target.
    subprocess.run(DOCKER + ["restart", "--time", "10", identity], capture_output=True, timeout=30, check=True)


def empty_state():
    return {"version": 1, "container": "", "failures": 0, "last_restart": 0}


def read_state(path):
    try:
        state = json.loads(path.read_text())
        if (
            state["version"] != 1
            or not isinstance(state["container"], str)
            or type(state["failures"]) is not int
            or state["failures"] < 0
            or type(state["last_restart"]) not in (int, float)
            or not 0 <= state["last_restart"] < float("inf")
        ):
            raise ValueError("Invalid recovery state")
        return state
    except FileNotFoundError:
        return empty_state()
    except (ValueError, TypeError, KeyError):
        event("invalid_state")
        return empty_state()


def write_state(path, state):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(state) + "\n")
    temporary.replace(path)


def tick(path, now):
    state = read_state(path)
    # A corrected wall clock must not leave recovery in an indefinite cooldown.
    state["last_restart"] = min(state["last_restart"], now)
    try:
        container = inspect_container()
    except (OSError, ValueError, subprocess.SubprocessError):
        state["failures"] = 0
        write_state(path, state)
        return "docker-unavailable"

    if state["container"] != container.generation:
        state["container"] = container.generation
        state["failures"] = 0
    if not container.eligible(now):
        state["failures"] = 0
        write_state(path, state)
        return "inactive-or-starting"

    if tunnel_ready():
        if state["failures"]:
            event("connection_recovered")
        state["failures"] = 0
        write_state(path, state)
        return "healthy"

    state["failures"] = min(state["failures"] + 1, FAILURE_THRESHOLD)
    if state["failures"] == 1:
        event("connection_unready")
    if state["failures"] < FAILURE_THRESHOLD:
        action = "watch"
    elif now - state["last_restart"] < RESTART_COOLDOWN:
        action = "cooldown"
    else:
        # Recheck after the HTTP probe; do not undo a stop/pause/replacement.
        try:
            current = inspect_container()
        except (OSError, ValueError, subprocess.SubprocessError):
            current = None
        if current != container or not current.eligible(now):
            state["failures"] = 0
            write_state(path, state)
            return "container-changed"
        # Persist BEFORE acting, even if Docker hangs or this process is killed.
        state["last_restart"] = now
        state["failures"] = 0
        write_state(path, state)
        event("restart_attempt", container=CONTAINER)
        try:
            restart_container(container.id)
        except (OSError, subprocess.SubprocessError):
            event("restart_failed")
            return "restart-failed"
        event("restart_completed", container=CONTAINER)
        return "restarted"
    write_state(path, state)
    return action


def run_once(state_dir=STATE_DIR, now=None):
    state_dir.mkdir(parents=True, exist_ok=True)
    # launchd serializes its own invocations; flock also covers manual runs.
    with (state_dir / "lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return "already-running"
        return tick(state_dir / "state.json", time.time() if now is None else now)


if __name__ == "__main__":
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(STATE_DIR / "recovery.log", maxBytes=1024 * 1024, backupCount=2)
    LOG.addHandler(handler)
    LOG.setLevel(logging.INFO)
    try:
        run_once()
    except Exception as error:
        # Do not print subprocess output, which could contain runtime secrets.
        event("probe_failed", error_type=type(error).__name__)
        raise SystemExit(1)
