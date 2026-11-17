#!/usr/bin/env python3
"""Export the Mini's NAS/deploy summary and redacted log tails for Control Center.

Runs as root every minute. Control Center mounts the output folder read-only, so the
container never needs the Docker socket, the operations journal or any host access.
"""

import argparse
import datetime
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

TAIL_LINES = 500
MAX_LINE = 2000
EXCLUDED = ("hindsight",)  # Personal memory content stays out of the panel.
PHASES = {
    "backup": "The backup step failed",
    "retire": "Removing a retired service failed",
    "activation": "Switching to the new version failed",
    "reconcile": "Services didn’t come back healthy after the update",
}
SECRETS = re.compile(
    r"(?i)\b(token|access_token|refresh_token|api_key|apikey|password|passwd|secret|sid|_sid|key)"
    r"(\"?\s*[=:]\s*\"?)[^\s&\"',;]+"
)
BEARER = re.compile(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+")
QUERY = re.compile(r"\?[^\s\"'<>]*=[^\s\"'<>]*")


def redact(line):
    line = QUERY.sub("?[redacted]", line)
    line = BEARER.sub(lambda m: m.group(1) + " [redacted]", line)
    line = SECRETS.sub(lambda m: m.group(1) + m.group(2) + "[redacted]", line)
    return line[:MAX_LINE]


def source_name(name):
    name = re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-")
    return name[:64] or None


def read_json(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def nas_check(backups):
    status = read_json(Path(backups) / "publication-status.json")
    nas = status.get("nas") if isinstance(status, dict) else None
    return nas if isinstance(nas, dict) and nas.get("state") in ("ok", "failing") else {"state": "unknown"}


def deploy_check(operations):
    operations = Path(operations)
    journal = read_json(operations / "transaction")
    if isinstance(journal, dict) and journal.get("failedAt"):
        reason = PHASES.get(journal.get("phase"), "The last update stopped part-way")
        return {"state": "blocked", "since": journal["failedAt"], "reason": reason}
    preflight = read_json(operations / "last-preflight.json")
    if journal is None and isinstance(preflight, dict) and preflight.get("accepted") is False:
        return {
            "state": "blocked",
            "since": preflight.get("startedAt"),
            "reason": "Downloading the new version failed",
        }
    return {"state": "ok"}


def tail(path, lines=TAIL_LINES):
    try:
        with open(path, "rb") as stream:
            stream.seek(0, os.SEEK_END)
            stream.seek(max(0, stream.tell() - 512 * 1024))
            return stream.read().decode(errors="replace").splitlines()[-lines:]
    except OSError:
        return None


def container_logs(docker, socket, run=subprocess.run):
    env = {"DOCKER_HOST": "unix://" + socket, "PATH": "/usr/bin:/bin"}
    try:
        names = run(
            [docker, "ps", "-a", "--format", "{{.Names}}"],
            env=env,
            capture_output=True,
            text=True,
            timeout=20,
            check=True,
        ).stdout.split()
    except (OSError, subprocess.SubprocessError):
        return {}
    logs = {}
    for name in names:
        if any(word in name.lower() for word in EXCLUDED) or not source_name(name):
            continue
        try:
            result = run(
                [docker, "logs", "--tail", str(TAIL_LINES), "--timestamps", name],
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                errors="replace",
                timeout=20,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        logs[source_name(name)] = result.stdout.splitlines()[-TAIL_LINES:]
    return logs


def write(path, text, owner):
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            os.fchmod(stream.fileno(), 0o600)
            if owner:
                os.fchown(stream.fileno(), *owner)
            stream.write(text)
            stream.flush()
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def export(output, status, sources, owner=None):
    output = Path(output)
    logs = output / "logs"
    logs.mkdir(mode=0o700, exist_ok=True)
    if owner:
        os.chown(logs, *owner)
    for name, lines in sources.items():
        write(logs / f"{name}.log", "".join(redact(line) + "\n" for line in lines), owner)
    for stale in logs.glob("*.log"):
        if stale.stem not in sources:
            stale.unlink()
    write(output / "status.json", json.dumps(status) + "\n", owner)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--backups", type=Path, required=True)
    parser.add_argument("--operations", type=Path, required=True)
    parser.add_argument("--docker", required=True)
    parser.add_argument("--socket", action="append", default=[])
    parser.add_argument("--file", action="append", default=[], help="name=path of a host log to include")
    parser.add_argument("--owner", help="uid:gid that owns the exported files")
    args = parser.parse_args()
    owner = tuple(int(part) for part in args.owner.split(":")) if args.owner else None
    if not args.output.is_dir() or args.output.is_symlink():
        raise SystemExit("Host status folder is missing; activation creates it.")
    sources = {}
    for socket in args.socket:
        if Path(socket).exists():
            sources.update(container_logs(args.docker, socket))
    for entry in args.file:
        name, _, path = entry.partition("=")
        lines = tail(path)
        if lines is not None and source_name(name):
            sources[source_name(name)] = lines
    status = {
        "format": 1,
        "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "nas": nas_check(args.backups),
        "deploy": deploy_check(args.operations),
    }
    export(args.output, status, sources, owner)


if __name__ == "__main__":
    main()
