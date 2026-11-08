#!/usr/bin/env python3
"""Nightly homelab snapshots, followed by verified append-only NAS copies.

Briefly stops Control Center, HA and Bambuddy individually for consistent file
and database snapshots. Hindsight uses its existing online PostgreSQL backup.
Failed snapshots remain local. Seven completed local sets are retained; NAS
copies are never purged. No alerts are sent.
"""

import argparse
import contextlib
import datetime
import fcntl
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from sqlite_snapshot import snapshot_container

HOME = Path("/Users/calum")
ROOT = HOME / "homelab-backups"
DOCKER = "/opt/homebrew/bin/docker"
APP_CONTAINER = "www-control-center-www-1"
os.environ["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"


def run(args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, **kwargs)


def docker(context, *args):
    return [DOCKER, "--context", context, *args]


@contextlib.contextmanager
def stopped(context, name):
    state = subprocess.check_output(
        docker(context, "inspect", "--format", "{{.State.Running}}", name), text=True
    ).strip()
    if state != "true":
        raise RuntimeError(f"{name} was already stopped; refusing to change its intended state")
    run(docker(context, "stop", "--time", "60", name), stdout=subprocess.DEVNULL)
    try:
        yield
    finally:
        run(docker(context, "start", name), stdout=subprocess.DEVNULL)


def archive(output, parent, *names):
    run(["tar", "-czf", output, "-C", parent, *names])


def container_files(output, context, name, path):
    # docker cp works on stopped containers and includes hidden config files.
    with gzip.open(output, "wb") as target:
        process = subprocess.Popen(docker(context, "cp", f"{name}:{path}/.", "-"), stdout=subprocess.PIPE)
        try:
            shutil.copyfileobj(process.stdout, target, 1024 * 1024)
        finally:
            process.stdout.close()
        if process.wait() != 0:
            raise RuntimeError(f"Failed copying {name} configuration")


def snapshot(destination, database_engine="sqlite"):
    app = HOME / "www-control-center"
    # Serialize against release.sh/recover.sh; never remove someone else's lock.
    lock = app / "deploy.lock"
    lock.mkdir()
    try:
        images = {}
        for context, name in [
            ("orbstack", n)
            for n in (["www-control-center-postgres-1"] if database_engine == "postgres" else [])
            + [
                APP_CONTAINER,
                "hindsight",
                "bambuddy",
                "bambu-studio-api",
                "bambuddy-tailscale",
                "www-tunnel-cloudflared-1",
            ]
        ] + [("colima-ha", "www-home-assistant-home-assistant-1")]:
            image_id = subprocess.check_output(
                docker(context, "inspect", "--format", "{{.Image}}", name), text=True
            ).strip()
            digests = json.loads(
                subprocess.check_output(
                    docker(context, "image", "inspect", "--format", "{{json .RepoDigests}}", image_id), text=True
                )
            )
            images[name] = {"id": image_id, "repo_digests": digests}
        (destination / "images.json").write_text(json.dumps(images, indent=2))
        infra = HOME / "homelab-infra/cloudflare"
        if (infra / "cloudflare.tfstate").is_file():
            archive(destination / "cloudflare-infra.tar.gz", infra, "cloudflare.tfstate", "production.tfvars.json")
        with stopped("orbstack", APP_CONTAINER):
            if database_engine == "postgres":
                with (destination / "control-center.dump").open("xb") as output:
                    run(
                        docker(
                            "orbstack",
                            "exec",
                            "www-control-center-postgres-1",
                            "pg_dump",
                            "-U",
                            "postgres",
                            "-d",
                            "control_center",
                            "-Fc",
                        ),
                        stdout=output,
                    )
            elif database_engine == "sqlite":
                snapshot_container(APP_CONTAINER, destination / "control-center.sqlite")
            else:
                raise ValueError("Unsupported database engine")
            archive(
                destination / "control-center-files.tar.gz",
                app,
                "data/media",
                "secrets",
                "runtime.env",
                "current.env",
                *OPERATIONS_FILES,
            )
    finally:
        lock.rmdir()
    print("Control Center snapshot complete; service restarted", flush=True)

    with stopped("colima-ha", "www-home-assistant-home-assistant-1"):
        container_files(
            destination / "home-assistant-config.tar.gz", "colima-ha", "www-home-assistant-home-assistant-1", "/config"
        )
    archive(
        destination / "home-assistant-host.tar.gz",
        HOME / "home-assistant",
        "compose.yaml",
        "start-ha.sh",
        "install-network-startup.sh",
        "socket_vmnet-startup.plist",
    )
    print("Home Assistant snapshot complete; service restarted", flush=True)

    with stopped("orbstack", "bambuddy"):
        container_files(destination / "bambuddy-data.tar.gz", "orbstack", "bambuddy", "/app/data")
        with stopped("orbstack", "bambu-studio-api"):
            container_files(destination / "bambuddy-studio.tar.gz", "orbstack", "bambu-studio-api", "/app/data")
        with stopped("orbstack", "bambuddy-tailscale"):
            container_files(
                destination / "bambuddy-tailscale.tar.gz", "orbstack", "bambuddy-tailscale", "/var/lib/tailscale"
            )
    archive(destination / "bambuddy-host.tar.gz", HOME / "bambuddy", "docker-compose.yml", "tailscale", "scripts")
    print("Bambuddy snapshot complete; service restarted", flush=True)

    run(["bash", HOME / "hindsight/backup.sh"], stdout=subprocess.DEVNULL)
    latest = max((HOME / "hindsight/backups").glob("hindsight-*.dump"), key=lambda p: p.stat().st_mtime_ns)
    shutil.copyfile(latest, destination / "hindsight.dump")
    archive(destination / "hindsight-codex-home.tar.gz", HOME / "hindsight", "codex-home")
    archive(
        destination / "hindsight-host.tar.gz",
        HOME / "hindsight",
        "run.sh",
        "backup.sh",
        "healthcheck.sh",
        "hindsight.env",
        "api-key",
        "cp-access-key",
        "ha-token",
        "alert-webhook.env",
    )
    archive(destination / "tunnel-host.tar.gz", HOME / "www-tunnel", "compose.yaml", "runtime.env", "secrets")
    archive(
        destination / "startup.tar.gz",
        "/",
        "Library/LaunchDaemons/homebrew.mxcl.socket_vmnet.plist",
        "Users/calum/.colima/ha/colima.yaml",
        "Users/calum/.colima/_lima/_config/override.yaml",
        "Users/calum/Library/LaunchAgents/com.calum.home-assistant-start.plist",
        "Users/calum/Library/LaunchAgents/com.calum.hindsight-backup.plist",
        "Users/calum/Library/LaunchAgents/com.calum.hindsight-healthcheck.plist",
    )
    print("Hindsight and tunnel snapshots complete", flush=True)


def verify_restarted_services():
    services = [
        ("orbstack", name)
        for name in [APP_CONTAINER, "bambuddy", "bambu-studio-api", "bambuddy-tailscale", "hindsight"]
    ]
    services.append(("colima-ha", "www-home-assistant-home-assistant-1"))
    deadline = time.monotonic() + 180
    for context, name in services:
        while True:
            state = json.loads(
                subprocess.check_output(docker(context, "inspect", "--format", "{{json .State}}", name), text=True)
            )
            if state.get("Running") and state.get("Health", {}).get("Status", "healthy") == "healthy":
                break
            if time.monotonic() >= deadline:
                raise RuntimeError(f"{name} did not recover after snapshot")
            time.sleep(2)


HISTORY_REMOTE = "/Homelab/backups/mac-mini/control-center-history"
STAMP = re.compile(r"\d{8}T\d{6}Z")


def retained(stamps, weekly=False):
    """Latest available snapshot per UTC hour, Pacific day and optionally ISO week."""
    from zoneinfo import ZoneInfo

    hourly, daily, weeks = {}, {}, {}
    for stamp in sorted(stamps):
        if not STAMP.fullmatch(stamp):
            raise ValueError("Unexpected backup directory")
        when = datetime.datetime.strptime(stamp, "%Y%m%dT%H%M%SZ").replace(tzinfo=datetime.timezone.utc)
        local = when.astimezone(ZoneInfo("America/Los_Angeles"))
        hourly[when.strftime("%Y%m%dT%H")] = stamp
        daily[local.date()] = stamp
        weeks[local.isocalendar()[:2]] = stamp
    return set(list(hourly.values())[-24:] + list(daily.values())[-7:] + (list(weeks.values()) if weekly else []))


OPERATIONS_FILES = (
    "compose.yaml",
    "release.sh",
    "recover.sh",
    "sqlite_preflight.py",
    "sqlite_snapshot.py",
    "tailscale_serve.py",
    "publish-apple-release.py",
)


def prune_full_sets(root):
    sets = sorted(p for p in root.iterdir() if STAMP.fullmatch(p.name) and p.is_dir() and not p.is_symlink())
    verified = [p for p in sets if (p / "LOCAL_VERIFIED").is_file() or (p / "NAS_VERIFIED").is_file()]
    failed = [p for p in sets if p not in verified]
    for old in verified[:-7] + failed[:-2]:
        shutil.rmtree(old)


def file_digest(path):
    checksum = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            checksum.update(chunk)
    return checksum.hexdigest()


def history_sets(root):
    return sorted(
        p
        for p in root.iterdir()
        if STAMP.fullmatch(p.name) and p.is_dir() and not p.is_symlink() and (p / "COMPLETE.json").is_file()
    )


def prune_history(root):
    sets = history_sets(root)
    keep = retained([p.name for p in sets])
    weekly = retained([p.name for p in sets], weekly=True)
    # Do not lose a week's only recovery point while the NAS is unavailable.
    keep |= {p.name for p in sets if p.name in weekly and not (p / "NAS_VERIFIED").is_file()}
    for p in sets:
        if p.name not in keep:
            shutil.rmtree(p)
    # Incomplete attempts are never accepted; keep only the latest two for diagnosis.
    partials = sorted(
        p
        for p in root.glob(".*.partial")
        if re.fullmatch(r"\.\d{8}T\d{6}Z\.partial", p.name) and p.is_dir() and not p.is_symlink()
    )
    for p in partials[:-2]:
        shutil.rmtree(p)


def validate_history(directory):
    """Read back compressed payloads, validate SQLite and every indexed photo."""
    import sqlite3
    import tarfile

    manifest = directory / "COMPLETE.json"
    if manifest.is_file():
        for entry in json.loads(manifest.read_text())["files"]:
            if entry["file"] not in ["control-center.sqlite.gz", "media.tar.gz"]:
                raise RuntimeError("Unexpected restore payload")
            path = directory / entry["file"]
            if path.stat().st_size != entry["bytes"] or file_digest(path) != entry["sha256"]:
                raise RuntimeError("Restore payload checksum mismatch")
    with tempfile.TemporaryDirectory(prefix="www-restore-check-") as temp:
        database = Path(temp) / "control-center.sqlite"
        with gzip.open(directory / "control-center.sqlite.gz", "rb") as source, database.open("xb") as target:
            shutil.copyfileobj(source, target)
        with sqlite3.connect(database) as db:
            if db.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
                raise RuntimeError("Backup database integrity failed")
            if db.execute("PRAGMA foreign_key_check").fetchone():
                raise RuntimeError("Backup database foreign keys failed")
            photos = db.execute("SELECT path,bytes FROM booth_photo").fetchall()
        with tarfile.open(directory / "media.tar.gz", "r:gz") as archive:
            members = {m.name.removeprefix("./"): m for m in archive.getmembers()}
            for path, size in photos:
                member = members.get("booth-photos/" + path)
                if member is None or not member.isfile() or member.size != size:
                    raise RuntimeError("Backup is missing indexed Photo Booth bytes")
            # Read every file through gzip/tar checks, not just its directory listing.
            for member in members.values():
                if member.isfile():
                    with archive.extractfile(member) as source:
                        while source.read(1024 * 1024):
                            pass
        with gzip.open(directory / "media.tar.gz", "rb") as source:
            while source.read(1024 * 1024):
                pass
        return len(photos)


def acquire_hourly_deploy_lock(lock):
    """Recover only this job's dead/previous-boot owner; never steal peer locks."""
    boot = subprocess.check_output(["/usr/sbin/sysctl", "-n", "kern.bootsessionuuid"], text=True).strip()
    owner = {"pid": os.getpid(), "boot": boot}
    marker = lock / "hourly-owner.json"
    for attempt in range(120):
        try:
            lock.mkdir()
            marker.write_text(json.dumps(owner))
            return owner
        except FileExistsError:
            if marker.is_file():
                old = json.loads(marker.read_text())
                alive = True
                try:
                    os.kill(old["pid"], 0)
                except ProcessLookupError:
                    alive = False
                if old["boot"] != boot or not alive:
                    # Unexpected files prevent removal. No recursive lock deletion.
                    marker.unlink()
                    lock.rmdir()
                    continue
            if attempt == 119:
                raise
            time.sleep(1)
    raise RuntimeError("Could not acquire deployment ownership")


def create_history(root, stamp):
    """Online Linux snapshot; hold deployment ownership only while collecting local files."""
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    stage, destination = root / ("." + stamp + ".partial"), root / stamp
    stage.mkdir(mode=0o700)
    app = HOME / "www-control-center"
    lock = app / "deploy.lock"
    owner = acquire_hourly_deploy_lock(lock)
    remote_copy = "/app/data/.hourly-" + stamp + ".sqlite"
    try:
        state = json.loads(subprocess.check_output(docker("orbstack", "inspect", APP_CONTAINER), text=True))[0]
        mounts = [m for m in state["Mounts"] if m["Destination"] == "/app/data"]
        if not state["State"]["Running"] or len(mounts) != 1 or mounts[0]["Type"] != "volume":
            raise RuntimeError("Hourly backup requires the running Linux-volume writer")
        from sqlite_snapshot import inspect_volume

        inspect_volume(mounts[0]["Name"])
        run(docker("orbstack", "exec", APP_CONTAINER, "www-server", "database-clean-snapshots"))
        database_size = int(
            subprocess.check_output(
                docker(
                    "orbstack",
                    "exec",
                    APP_CONTAINER,
                    "stat",
                    "-c",
                    "%s",
                    "/app/data/control-center.sqlite",
                ),
                text=True,
            )
        )
        media_size = sum(p.stat().st_size for p in (app / "data/media").rglob("*") if p.is_file())
        if shutil.disk_usage(root).free < 5 * 1024**3 + 2 * (database_size + media_size):
            raise RuntimeError("Insufficient snapshot headroom above the production reserve")
        raw = stage / "control-center.sqlite"
        try:
            run(docker("orbstack", "exec", APP_CONTAINER, "www-server", "database-snapshot", remote_copy))
            run(docker("orbstack", "cp", APP_CONTAINER + ":" + remote_copy, raw), capture_output=True)
        finally:
            run(docker("orbstack", "exec", APP_CONTAINER, "rm", "--", remote_copy))
        # Photos are immutable and synced before indexing. Copy after the DB snapshot;
        # newer unindexed photos are harmless extras, soft deletion never removes bytes.
        archive(stage / "media.tar.gz", app / "data/media", ".")
    finally:
        if json.loads((lock / "hourly-owner.json").read_text()) != owner:
            raise RuntimeError("Hourly deployment lock ownership changed")
        (lock / "hourly-owner.json").unlink()
        lock.rmdir()
    with raw.open("rb") as source, gzip.open(stage / "control-center.sqlite.gz", "xb", compresslevel=6) as target:
        shutil.copyfileobj(source, target)
    raw.unlink()
    count = validate_history(stage)
    files = [
        {"file": p.name, "bytes": p.stat().st_size, "sha256": file_digest(p)}
        for p in [stage / "control-center.sqlite.gz", stage / "media.tar.gz"]
    ]
    (stage / "COMPLETE.json").write_text(
        json.dumps(
            {"snapshot": stamp, "photo_rows": count, "image": state["Config"]["Image"], "files": files}, indent=2
        )
    )
    os.rename(stage, destination)
    return destination


def nas_exists(nas, path):
    try:
        info = nas.call("SYNO.FileStation.List", "getinfo", path=json.dumps([path]))
        files = info.get("files", [])
        if len(files) != 1:
            raise RuntimeError("Unexpected NAS file metadata")
        error = files[0].get("additional", {}).get("error", files[0].get("error"))
        if error:
            if isinstance(error, dict) and error.get("code") == 408:
                return False
            raise RuntimeError("NAS metadata error")
        return True
    except Exception as error:
        if getattr(error, "code", None) == 408:
            return False
        raise


def upload_once(nas, path, destination):
    remote = destination + "/" + path.name
    if nas_exists(nas, remote):
        checksum, size = nas.download_hash(remote)
        if checksum != file_digest(path) or size != path.stat().st_size:
            raise RuntimeError("Existing NAS backup differs; refusing overwrite")
    else:
        nas.upload(path, destination)


def publish_history(root):
    """Only the dedicated history namespace can expire; weekly representatives never expire."""
    import importlib.util

    credential = ROOT / "nas-credentials.json"
    if credential.stat().st_mode & 0o077:
        raise RuntimeError("NAS credential file permissions are too broad")
    spec = importlib.util.spec_from_file_location("nas_upload", Path(__file__).with_name("nas-upload.py"))
    uploader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(uploader)
    nas = uploader.Nas(json.loads(credential.read_text()))
    try:
        nas.login()
        failures, uploaded = 0, 0
        for directory in history_sets(root):
            if (directory / "NAS_VERIFIED").is_file():
                continue
            try:
                validate_history(directory)
                remote = HISTORY_REMOTE + "/" + directory.name
                for name in ["control-center.sqlite.gz", "media.tar.gz", "COMPLETE.json"]:
                    upload_once(nas, directory / name, remote)
                (directory / "NAS_VERIFIED").touch()
                uploaded += 1
                (directory / "UPLOAD_FAILED").unlink(missing_ok=True)
            except Exception as error:
                # An older damaged set must not block newer good backups. Keep
                # its bytes as evidence and report only a safe error class.
                (directory / "UPLOAD_FAILED").write_text(type(error).__name__)
                failures += 1
        if failures and not uploaded:
            raise RuntimeError("NAS history has pending failures; no new verified upload; expiration skipped")
        names, offset = [], 0
        while True:
            result = nas.call("SYNO.FileStation.List", "list", folder_path=HISTORY_REMOTE, offset=offset, limit=1000)
            rows = result.get("files", [])
            for row in rows:
                name = row.get("name", "")
                if (
                    STAMP.fullmatch(name)
                    and row.get("isdir")
                    and row.get("path") == HISTORY_REMOTE + "/" + name
                    and nas_exists(nas, HISTORY_REMOTE + "/" + name + "/COMPLETE.json")
                ):
                    names.append(name)
            offset += len(rows)
            if offset >= result["total"]:
                break
            if not rows:
                raise RuntimeError("NAS listing made no progress")
        keep = retained(names, weekly=True)
        for name in sorted(set(names) - keep) if len(keep) >= 2 else []:
            # Regex + exact parent checks scope expiration to this job's snapshots.
            if not STAMP.fullmatch(name):
                raise RuntimeError("Unsafe retention path")
            nas.call(
                "SYNO.FileStation.Delete", "delete", path=json.dumps([HISTORY_REMOTE + "/" + name]), recursive="true"
            )
        if failures:
            raise RuntimeError("NAS history has older pending failures; newer snapshots verified")
    finally:
        nas.logout()


def publish_history_bounded(root):
    """A stalled NAS may use at most 15 minutes of an hourly job, never hours."""
    if root.resolve() != (ROOT / "control-center-history").resolve():
        raise RuntimeError("Unexpected history root")
    run([sys.executable, Path(__file__), "--publish-history-only"], timeout=15 * 60)


def hourly_backup(local_only=False):
    os.umask(0o077)
    root = ROOT / "control-center-history"
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    # Kernel ownership disappears on process death/reboot; the lock file may persist.
    lock = (root / ".hourly.lock").open("a")
    fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    try:
        prune_history(root)
        now = datetime.datetime.now(datetime.timezone.utc)
        sets = history_sets(root)
        if not sets or sets[-1].name[:11] != now.strftime("%Y%m%dT%H"):
            snapshot = create_history(root, now.strftime("%Y%m%dT%H%M%SZ"))
            print("Hourly database and photo snapshot verified: " + snapshot.name, flush=True)
        prune_history(root)
        if not local_only:
            publish_history_bounded(root)
    finally:
        lock.close()


def install_hourly():
    import plistlib

    label = "com.calum.control-center-hourly-backup"
    destination = HOME / "Library/LaunchAgents" / (label + ".plist")
    config = {
        "Label": label,
        "RunAtLoad": True,
        "ProgramArguments": ["/usr/bin/python3", str(ROOT / "backup.py"), "--control-center-hourly"],
        "StartCalendarInterval": {"Minute": 0},
        "StandardOutPath": str(ROOT / "control-center-hourly.log"),
        "StandardErrorPath": str(ROOT / "control-center-hourly-error.log"),
    }
    payload = plistlib.dumps(config)
    if destination.exists() and destination.read_bytes() == payload:
        loaded = subprocess.run(["launchctl", "print", "gui/" + str(os.getuid()) + "/" + label], capture_output=True)
        if loaded.returncode != 0:
            run(["launchctl", "bootstrap", "gui/" + str(os.getuid()), destination])
        return
    if destination.exists():
        raise RuntimeError("Hourly schedule differs; review before replacing it")
    destination.write_bytes(payload)
    destination.chmod(0o600)
    run(["launchctl", "bootstrap", "gui/" + str(os.getuid()), destination])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-engine", choices=["postgres", "sqlite"], default="sqlite")
    parser.add_argument("--local-only", action="store_true", help="Verify local snapshots without contacting the NAS")
    parser.add_argument("--control-center-hourly", action="store_true")
    parser.add_argument("--install-hourly", action="store_true")
    parser.add_argument("--publish-history-only", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--verify-history", type=Path)
    args = parser.parse_args(argv)
    if args.publish_history_only:
        publish_history(ROOT / "control-center-history")
        return
    if args.verify_history:
        print("Verified restored database and indexed photos:", validate_history(args.verify_history))
        return
    if args.install_hourly:
        install_hourly()
        return
    if args.control_center_hourly:
        hourly_backup(args.local_only)
        return
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, exist_ok=True)
    lock = ROOT / "backup.lock"
    lock.mkdir()
    try:
        prune_full_sets(ROOT)
        if shutil.disk_usage(ROOT).free < 5 * 1024**3:
            raise RuntimeError("Less than 5 GiB free; refusing to fill the production disk")
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        destination = ROOT / stamp
        destination.mkdir()
        snapshot(destination, args.database_engine)
        verify_restarted_services()
        (destination / "LOCAL_VERIFIED").touch()
        prune_full_sets(ROOT)
        print(f"Local snapshots verified; services healthy: {stamp}", flush=True)
        if args.local_only:
            return
        uploader = Path(__file__).with_name("nas-upload.py")
        payloads = sorted(destination.iterdir())
        manifest = destination / "verified-files.jsonl"
        with manifest.open("w") as result:
            run(
                [
                    sys.executable,
                    uploader,
                    "--config",
                    ROOT / "nas-credentials.json",
                    "--destination",
                    f"/Homelab/backups/mac-mini/{stamp}",
                    *payloads,
                ],
                stdout=result,
            )
        # A completion marker is uploaded only after every payload has passed
        # read-back verification. Incomplete NAS directories are never complete sets.
        complete = destination / "COMPLETE.json"
        complete.write_text(
            json.dumps(
                {"created_at": stamp, "files": [json.loads(line) for line in manifest.read_text().splitlines()]},
                indent=2,
            )
        )
        run(
            [
                sys.executable,
                uploader,
                "--config",
                ROOT / "nas-credentials.json",
                "--destination",
                f"/Homelab/backups/mac-mini/{stamp}",
                complete,
            ]
        )
        (destination / "NAS_VERIFIED").touch()
        print(f"Backup complete and verified: {stamp}", flush=True)
        completed = sorted(
            p
            for p in ROOT.iterdir()
            if re.fullmatch(r"\d{8}T\d{6}Z", p.name) and not p.is_symlink() and (p / "NAS_VERIFIED").is_file()
        )
        for old in completed[:-7]:
            shutil.rmtree(old)
    finally:
        lock.rmdir()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Backup failed: {type(error).__name__}; local snapshots retained", file=sys.stderr)
        sys.exit(1)
