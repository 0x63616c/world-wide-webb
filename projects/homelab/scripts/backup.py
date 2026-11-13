#!/usr/bin/env python3
"""Scheduled snapshot + verified NAS copy; invoked beneath homelab-operation."""

import argparse
import datetime
import importlib.util
import json
import os
import re
import shutil
import stat
import sys
import tempfile
import time
import uuid
from pathlib import Path

import backup_publish
import snapshot

spec = importlib.util.spec_from_file_location("nas_upload", Path(__file__).with_name("nas-upload.py"))
upload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upload)
history_spec = importlib.util.spec_from_file_location("backup_history", Path(__file__).with_name("backup-history.py"))
history = importlib.util.module_from_spec(history_spec)
history_spec.loader.exec_module(history)
verify_spec = importlib.util.spec_from_file_location("verify_backup", Path(__file__).with_name("verify-backup.py"))
verifier = importlib.util.module_from_spec(verify_spec)
verify_spec.loader.exec_module(verifier)


def verified_copy(destination, remote, nas, health_command=None):
    records = []
    # COMPLETE is created only after every payload passes read-back verification.
    for path in sorted(destination.iterdir()):
        if not path.is_file() or path.is_symlink():
            raise RuntimeError("Unexpected snapshot payload")
        records.append(nas.upload(path, remote))
    complete = destination / "COMPLETE.json"
    complete.write_text(json.dumps({"format": 1, "files": records}, indent=2))
    # A valid upload is not enough: the set must contain all assigned service
    # state and valid recovery metadata before publishing its completion marker.
    verifier.verify(destination)
    # Publishing completion must not hide a service that failed to recover
    # after its snapshot, including a running but disconnected tunnel/sidecar.
    snapshot.run(health_command or ["/run/current-system/sw/bin/homelab-health"], timeout=150)
    nas.upload(complete, remote)
    (destination / "NAS_VERIFIED").touch(mode=0o600)


def prune_verified(root, keep):
    if keep < 1:
        raise ValueError("Must retain at least one verified local set")
    completed = sorted(
        path
        for path in root.iterdir()
        if re.fullmatch(r"\d{8}T\d{6}Z-[a-f0-9]{8}", path.name)
        and path.is_dir()
        and not path.is_symlink()
        and (path / "NAS_VERIFIED").is_file()
        and not (path / "NAS_VERIFIED").is_symlink()
        and not (path / "PINNED").exists()
    )
    for old in completed[:-keep]:
        shutil.rmtree(old)


def private_recovery_tree(root):
    # copytree preserves immutable Nix-store modes, including unwritable dirs.
    # Only normalize this newly created private staging tree, never its sources.
    for directory, _, files in os.walk(root, topdown=True, followlinks=False):
        Path(directory).chmod(0o700)
        for name in files:
            path = Path(directory) / name
            path.chmod(0o600 | (path.stat().st_mode & 0o100))


def recovery_bundle(destination, services, configuration):
    # Includes plaintext service credentials: destination and archives are private.
    staging = destination / "recovery"
    staging.mkdir(mode=0o700)
    try:
        (staging / "host.json").write_text(
            json.dumps(
                {
                    "host": configuration["host"],
                    "services": services,
                    "system_path": os.path.realpath("/run/current-system"),
                    "weeklyHindsightExport": configuration.get("weeklyHindsightExport", False),
                    "scope": configuration.get("scope", "full"),
                },
                indent=2,
            )
        )
        for service in services:
            source = Path("/etc/homelab/services") / service
            if service == "home-assistant":
                source = Path("/etc/homelab/home-assistant")
            shutil.copytree(source, staging / "compose" / service)
            if service != "home-assistant":
                shutil.copytree(
                    Path("/var/lib/_containers/runtime-secrets") / service, staging / "credentials" / service
                )
        if any(service != "home-assistant" for service in services):
            shutil.copyfile("/run/secrets/containers-env", staging / "containers.env")
        private_recovery_tree(staging)
        snapshot.run(["tar", "-czf", str(destination / "recovery.tar.gz"), "-C", str(staging), "."])
    finally:
        # A partially failed copy can also have installed readonly directories.
        private_recovery_tree(staging)
        shutil.rmtree(staging)


def scoped_configuration(config, scope, selected=None):
    if scope not in ("full", "control-center-hourly", "penpot", "deployment"):
        raise ValueError("Unknown backup scope")
    services = config["services"]
    if not services or len(set(services)) != len(services) or set(services) - snapshot.NAMES.keys():
        raise ValueError("Invalid backup service assignment")
    deployment_services = selected
    selected = (
        list(services) if scope == "full" else ["control-center" if scope == "control-center-hourly" else "penpot"]
    )
    if scope == "deployment":
        selected = deployment_services
    if not selected or len(set(selected)) != len(selected) or not set(selected) <= set(services):
        raise ValueError("Requested backup scope is not assigned to this host")
    root = Path(config["root"])
    if scope != "full":
        root = (
            root
            / {"control-center-hourly": "control-center-history", "penpot": "penpot", "deployment": "deployment"}[scope]
        )
    return {**config, "scope": scope, "services": selected, "root": str(root)}


def nas_client():
    # SOPS paths intentionally are symlinks; inspect the opened target once.
    with Path("/run/secrets/nas-backup-credentials").open() as source:
        info = os.fstat(source.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise RuntimeError("NAS credentials must be private and service-owned")
        return upload.Nas(json.load(source))


def backup(config, scope="full", selected=None, local_only=False, transaction=None):
    os.umask(0o077)
    config = scoped_configuration(config, scope, selected)
    root = Path(config["root"])
    # The trusted parent is created first so a scope cannot change other roots.
    base = root if scope == "full" else root.parent
    base.mkdir(mode=0o700, exist_ok=True)
    if base.is_symlink() or base.stat().st_uid != os.geteuid() or base.stat().st_mode & 0o077:
        raise RuntimeError("Backup base must be private and service-owned")
    root.mkdir(mode=0o700, exist_ok=True)
    if root.is_symlink() or root.stat().st_uid != os.geteuid() or root.stat().st_mode & 0o077:
        raise RuntimeError("Backup root must be private and service-owned")
    snapshot.durable.sync_directory(root.parent)
    # Holds from any scope block subsequent snapshots until recovery is checked.
    base = Path(config["root"]) if scope == "full" else Path(config["root"]).parent
    if list(base.glob("**/*.restart-required")) or list(base.glob("**/*.online-snapshot-pending")):
        raise RuntimeError("An earlier snapshot needs service recovery inspection")
    if shutil.disk_usage(root).free < config["minFreeGiB"] * 1024**3:
        raise RuntimeError("Insufficient free space for backup admission")
    services = config["services"]
    nas = None if local_only else nas_client()
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    stamp += "-" + uuid.uuid4().hex[:8]
    destination = root / stamp
    destination.mkdir(mode=0o700)
    snapshot.durable.sync_directory(root)
    remote = "/Homelab/backups/" + config["host"] + "/"
    if scope != "full":
        remote += {"control-center-hourly": "control-center-history", "penpot": "penpot", "deployment": "deployment"}[
            scope
        ] + "/"
    remote += stamp
    if not upload.valid_destination(remote):
        raise ValueError("Invalid host backup namespace")
    weekly = scope == "full" and "hindsight" in services and datetime.datetime.now().weekday() == 6
    config = {**config, "weeklyHindsightExport": weekly}
    started = time.monotonic()
    cold_timings = snapshot.snapshot(
        destination, services, weekly_exports=weekly, control_center_online=scope == "control-center-hourly"
    )
    recovery_bundle(destination, services, config)
    capture_seconds = round(time.monotonic() - started, 6)
    if local_only:
        command = config.get("healthCommands", {}).get(scope)
        if scope == "deployment":
            command = [config["reconcileCommand"], "--services", "--health", *services]
        backup_publish.accept_local(
            destination,
            remote,
            scope,
            services,
            transaction,
            verifier.verify,
            lambda: snapshot.run(
                command or ["/run/current-system/sw/bin/homelab-health"],
                timeout=180,
                pass_fds=(int(os.environ["HOMELAB_OPERATION_FD"]),)
                if os.environ.get("HOMELAB_OPERATION_FD", "").isdecimal()
                else (),
            ),
            timings={"captureSeconds": capture_seconds, "coldContainers": cold_timings},
        )
        print("Local backup accepted (" + scope + "): " + stamp, flush=True)
        return destination
    try:
        nas.login()
        verified_copy(destination, remote, nas, config.get("healthCommands", {}).get(scope))
        if scope == "control-center-hourly":
            history.prune_remote(nas, config["host"], stamp)
    finally:
        nas.logout()
    if weekly:
        retain_weekly(root, destination)
    if scope == "control-center-hourly":
        history.prune_local(root)
    else:
        prune_verified(root, config["keepLocal"])
    print("Backup verified (" + scope + "): " + stamp, flush=True)


def retain_weekly(root, destination):
    """Keep the first verified export from each of eight local calendar weeks."""
    weekly = root / "weekly-exports"
    weekly.mkdir(mode=0o700, exist_ok=True)
    if weekly.is_symlink() or weekly.stat().st_uid != os.geteuid() or weekly.stat().st_mode & 0o077:
        raise ValueError("Weekly export directory must be private")
    if not (destination / "NAS_VERIFIED").is_file():
        raise ValueError("Only verified exports may enter retention")
    if not re.fullmatch(r"\d{8}T\d{6}Z-[a-f0-9]{8}", destination.name):
        raise ValueError("Invalid weekly snapshot name")
    timestamp = datetime.datetime.strptime(destination.name[:16], "%Y%m%dT%H%M%SZ")
    local_time = timestamp.replace(tzinfo=datetime.timezone.utc).astimezone()
    year, week, _ = local_time.isocalendar()
    target = weekly / f"{year}-W{week:02}.tar.gz"
    if target.exists() or target.is_symlink():
        if target.is_symlink() or not target.is_file() or target.stat().st_mode & 0o077:
            raise ValueError("Unsafe existing weekly export")
        # Repeated deployments on Sunday must not displace previous weeks.
        return
    # Publish only a fully copied file; link refuses replacing a previous set.
    with (
        (destination / "hindsight-bank-exports.tar.gz").open("rb") as source,
        tempfile.NamedTemporaryFile(dir=weekly, prefix=".partial-") as output,
    ):
        shutil.copyfileobj(source, output)
        output.flush()
        os.fsync(output.fileno())
        os.link(output.name, target)
    completed = sorted(
        path
        for path in weekly.iterdir()
        if re.fullmatch(r"\d{4}-W\d{2}\.tar\.gz", path.name) and path.is_file() and not path.is_symlink()
    )
    for old in completed[:-8]:
        old.unlink()


def publish_pending(config, transaction=None, wait=False):
    root = Path(config["root"])
    if root.is_symlink() or not root.is_dir() or root.stat().st_uid != os.geteuid() or root.stat().st_mode & 0o077:
        raise ValueError("Unsafe backup root")
    failed = 0
    with backup_publish.publication_lock(root, blocking=transaction is not None or wait):
        destinations = list(backup_publish.pending_sets(root, include_verified=transaction is not None))
        if transaction:
            destinations = [
                p
                for p in destinations
                if json.loads((p / "LOCAL_VERIFIED.json").read_text()).get("transaction") == transaction
            ]
            if not destinations:
                raise ValueError("Transaction has no accepted recovery point")
        for destination in destinations:
            try:
                receipt = backup_publish.publish_set(destination, nas_client, verifier.verify)
                if receipt["scope"] in ("control-center-hourly", "deployment"):
                    nas = nas_client()
                    try:
                        nas.login()
                        scope = "deployment" if receipt["scope"] == "deployment" else "control-center-history"
                        protected = {p.parent.name for p in (root / "deployment").glob("*/PINNED")}
                        history.prune_remote(nas, config["host"], destination.name, scope=scope, protected=protected)
                    finally:
                        nas.logout()
                if receipt["scope"] == "control-center-hourly":
                    history.prune_local(destination.parent)
                else:
                    if receipt["scope"] == "full" and verifier.host_metadata(destination / "recovery.tar.gz").get(
                        "weeklyHindsightExport"
                    ):
                        retain_weekly(root, destination)
                    prune_verified(destination.parent, config["keepLocal"])
            except Exception as error:
                failed += 1
                print("Pending publication failed: " + destination.name + ": " + type(error).__name__, file=sys.stderr)
        remaining = list(backup_publish.pending_sets(root))
        snapshot.durable.write_json(
            root / "publication-status.json",
            {
                "format": 1,
                "pending": len(remaining),
                "oldestPending": min((p.name for p in remaining), default=None),
                "failed": failed,
                "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            },
        )
    if failed:
        raise RuntimeError("Pending backup publication incomplete")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--scope", choices=["full", "control-center-hourly", "penpot", "deployment"], default="full")
    parser.add_argument("--services", nargs="+")
    parser.add_argument("--local-only", action="store_true")
    parser.add_argument("--publish-pending", action="store_true")
    parser.add_argument("--publish-transaction")
    parser.add_argument("--transaction")
    parser.add_argument("--unpin")
    args = parser.parse_args()
    if os.geteuid() == 0:
        raise RuntimeError("Backup must run as _containers, never root")
    config = json.loads(args.config.read_text())
    if args.transaction and not re.fullmatch("[a-f0-9]{32}", args.transaction):
        raise ValueError("Invalid transaction identity")
    if args.publish_transaction and not re.fullmatch("[a-f0-9]{32}", args.publish_transaction):
        raise ValueError("Invalid transaction identity")
    if args.publish_pending or args.publish_transaction:
        publish_pending(config, args.publish_transaction)
        return
    value = os.environ.get("HOMELAB_OPERATION_FD", "")
    if not value.isdecimal() or int(value) < 3:
        raise RuntimeError("Run backup through homelab-operation")
    spec = importlib.util.spec_from_file_location(
        "backup_operation_lock", Path(__file__).with_name("operation-lock.py")
    )
    operation = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(operation)
    with operation.operation_lock(inherited_fd=int(value)):
        if args.unpin:
            if not re.fullmatch("[a-f0-9]{32}", args.unpin):
                raise ValueError("Invalid transaction identity")
            for parent in [Path(config["root"]) / "deployment", Path(config["root"])]:
                if parent.is_dir():
                    for path in parent.glob("*/PINNED"):
                        if not path.is_symlink() and json.loads(path.read_text()).get("transaction") == args.unpin:
                            snapshot.durable.remove(path)
            return
        backup(config, scope=args.scope, selected=args.services, local_only=True, transaction=args.transaction)
        # Older generation executors interpret no-argument success as off-host
        # completion. Drain pending accepted points before they can retire this
        # publisher during a rollback; all network work uses the same owner lock.
        if not args.local_only:
            publish_pending(config, wait=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Network and application exceptions can carry sensitive data.
        print("Backup failed: " + type(error).__name__ + "; local set retained", file=sys.stderr)
        sys.exit(1)
