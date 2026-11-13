#!/usr/bin/env python3
"""Serialize a complete Darwin generation change with backup and health gates.

Failure leaves a durable transaction marker and private diagnostics for explicit
recovery. Never roll back application data or restart a stale generation blindly.
"""

import argparse
import datetime
import importlib.util
import json
import os
import re
import signal
import stat
import subprocess
import sys
import time
import uuid
from pathlib import Path

import durable
from deployment_plan import plan_deployment


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(file))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


locks = load("operation_lock", "operation-lock.py")
children = load("service_child", "service-child.py")
backup_publish = load("backup_publish", "backup_publish.py")
backup_verifier = load("verify_backup", "verify-backup.py")
ROOT = Path("/var/lib/homelab-operations")
CURRENT = Path("/run/current-system")
PROFILE = Path("/nix/var/nix/profiles/system")
BACKUPS = Path("/var/lib/_containers/backups")
SERVICES_DOCKER = "unix:///var/lib/_containers/.colima/services/docker.sock"
PENPOT_CONTAINERS = {
    "penpot-penpot-frontend-1",
    "penpot-penpot-backend-1",
    "penpot-penpot-exporter-1",
    "penpot-penpot-admin-console-1",
    "penpot-penpot-mcp-1",
    "penpot-penpot-postgres-1",
    "penpot-penpot-valkey-1",
}
PENPOT_VOLUMES = ("penpot_assets", "penpot_postgres", "penpot_valkey")


def retire_penpot(log):
    """Remove only the verified Penpot Compose project after the host lock is held."""
    docker = ["/run/current-system/sw/bin/docker", "--host", SERVICES_DOCKER]

    def command(*args):
        return subprocess.run([*docker, *args], check=True, capture_output=True, text=True, timeout=180).stdout.strip()

    names = set(
        command(
            "ps", "-a", "--filter", "label=com.docker.compose.project=penpot", "--format", "{{.Names}}"
        ).splitlines()
    )
    if names - PENPOT_CONTAINERS:
        raise RuntimeError("Penpot project has unexpected containers; retirement needs inspection")
    for name in sorted(names):
        command("rm", "-f", name)
    remaining = set(
        command(
            "ps", "-a", "--filter", "label=com.docker.compose.project=penpot", "--format", "{{.Names}}"
        ).splitlines()
    )
    if remaining:
        raise RuntimeError("Penpot containers remain after retirement")
    volumes = set(command("volume", "ls", "--format", "{{.Name}}").splitlines())
    for name in PENPOT_VOLUMES:
        if name in volumes:
            command("volume", "rm", name)
    networks = set(command("network", "ls", "--format", "{{.Name}}").splitlines())
    if "penpot_default" in networks:
        command("network", "rm", "penpot_default")
    log.write("Penpot containers, data volumes and network retired.\n")


def retire_services(services, log):
    if services != ["penpot"]:
        raise ValueError("Unknown service retirement")
    retire_penpot(log)


def system_path(path):
    resolved = path.resolve(strict=True)
    if resolved.parent != Path("/nix/store") or not resolved.is_dir():
        raise ValueError("Expected a built Nix system")
    for relative in ["activate", "activate-user", "etc/homelab/deployment.json"]:
        if not (resolved / relative).is_file():
            raise ValueError("Incomplete Nix system")
    return resolved


def metadata(system):
    data = json.loads((system / "etc/homelab/deployment.json").read_text())
    if not isinstance(data, dict) or not isinstance(data.get("services"), list):
        raise ValueError("Invalid deployment metadata")
    services = data["services"]
    if any(not isinstance(s, str) for s in services) or len(set(services)) != len(services):
        raise ValueError("Invalid service assignment")
    if services and data.get("backupsEnabled") is not True:
        raise ValueError("Stateful updates require configured backups")
    return data


def run(command, env, log, timeout=1800):
    process = subprocess.Popen(
        command,
        env=env,
        cwd="/",
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=log,
        start_new_session=True,
        pass_fds=(int(env["HOMELAB_OPERATION_FD"]),),
    )
    try:
        result = process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
        raise
    if result:
        raise RuntimeError("Generation command failed; inspect private activation diagnostics")


HA_LABELS = ("org.nixos.homelab-ha-vmnet", "org.nixos.homelab-ha-colima")


def ha_runtime_changed(previous, candidate):
    if "home-assistant" not in metadata(previous)["services"]:
        return False
    return any(
        (previous / "Library/LaunchDaemons" / (label + ".plist")).read_bytes()
        != (candidate / "Library/LaunchDaemons" / (label + ".plist")).read_bytes()
        for label in HA_LABELS
    )


def launcher_loaded(label):
    result = subprocess.run(
        ["/bin/launchctl", "print", "system/" + label], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10
    )
    if result.returncode not in (0, 113):
        raise RuntimeError("Could not inspect HA launcher")
    return result.returncode == 0


def unload_ha_launcher(label=HA_LABELS[1]):
    if not launcher_loaded(label):
        return
    subprocess.run(["/bin/launchctl", "bootout", "system/" + label], check=True, timeout=30)
    deadline = time.monotonic() + 60
    while launcher_loaded(label):
        if time.monotonic() >= deadline:
            raise RuntimeError("HA launcher did not finish unloading")
        time.sleep(1)


def ensure_ha_launchers():
    for label in HA_LABELS:
        if not launcher_loaded(label):
            subprocess.run(
                ["/bin/launchctl", "bootstrap", "system", "/Library/LaunchDaemons/" + label + ".plist"],
                check=True,
                timeout=30,
            )


def activate(candidate, previous, fd, token, log):
    # launchd restart alone leaves an already-running Colima guest connected to
    # the old vmnet backend. Quiesce it under the transaction lock before switch.
    restart_ha = ha_runtime_changed(previous, candidate)
    if restart_ha:
        unload_ha_launcher()
        children.run_service("stop-ha", fd, 180, system=candidate, log=log)
        # Native launchd unload is asynchronous. Finish backend teardown before
        # nix-darwin copies/loads its replacement, avoiding a bootstrap race.
        unload_ha_launcher(HA_LABELS[0])
    env = {
        "PATH": "/nix/var/nix/profiles/default/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        "HOME": "/var/root",
        "USER": "root",
        "LOGNAME": "root",
        "HOMELAB_OPERATION_FD": str(fd),
        "HOMELAB_TRANSACTION": token,
    }
    run(
        ["/nix/var/nix/profiles/default/bin/nix-env", "--profile", str(PROFILE), "--set", str(candidate)],
        env,
        log,
        timeout=180,
    )
    run([str(candidate / "activate-user")], env, log)
    # Generated activate has an `env -i` shebang. Invoke its pinned interpreter
    # directly to preserve only our explicitly constructed transaction context.
    interpreter = (candidate / "activate").read_text().splitlines()[0].split()[-1]
    if not interpreter.startswith("/nix/store/") or not interpreter.endswith("/bin/bash"):
        raise ValueError("Unexpected activation interpreter")
    run([interpreter, str(candidate / "activate")], env, log)
    if restart_ha:
        ensure_ha_launchers()


def transaction(
    candidate, previous, root, fd, backup, switch, reconcile, token=None, initial_timings=None, retire=None
):
    old, new = metadata(previous), metadata(candidate)
    plan = plan_deployment(old, new)
    token = token or uuid.uuid4().hex
    journal = root / "transaction"
    record = {
        "format": 1,
        "id": token,
        "previous": str(previous),
        "candidate": str(candidate),
        "phase": "backup",
        "plan": plan,
        "timings": dict(initial_timings or {}),
    }

    def phase(name, action):
        record["phase"] = name
        started = time.monotonic()
        timing = {"startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
        record["timings"][name] = timing
        durable.write_json(journal, record)
        try:
            action()
        finally:
            timing["durationSeconds"] = round(time.monotonic() - started, 6)
            timing["finishedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            durable.write_json(journal, record)

    # Failure retains the journal; no data rollback or stale restart is inferred.
    if plan["backup"]:
        phase("backup", lambda: backup(previous, fd))
    if plan["retire"]:
        if retire is None:
            raise RuntimeError("Service retirement has no implementation")
        phase("retire", lambda: retire(plan["retire"]))
    phase("activation", lambda: switch(candidate, fd, token))
    if plan["reconcile"] or plan["health"]:
        phase("reconcile", lambda: reconcile(candidate, fd))
    record["phase"] = "verified"
    durable.write_json(root / "last-success.json", record)
    durable.remove(journal)
    return record


def guard(candidate, root=ROOT, current=CURRENT, profile=PROFILE):
    journal = root / "transaction"
    if journal.exists():
        record = json.loads(journal.read_text())
        token = os.environ.get("HOMELAB_TRANSACTION")
        value = os.environ.get("HOMELAB_OPERATION_FD", "")
        if (
            record.get("candidate") != str(candidate)
            or record.get("id") != token
            or not value.isdecimal()
            or int(value) < 3
        ):
            raise RuntimeError("Interrupted or unowned activation transaction requires inspection")
        with locks.operation_lock(root, inherited_fd=int(value)):
            return
    # Boot reapplies the already committed generation. It is not a new update.
    if current.exists():
        raise RuntimeError("Use homelab-activate-generation apply for stateful activation")
    receipt = json.loads((root / "last-success.json").read_text())
    if (
        receipt.get("phase") != "verified"
        or receipt.get("candidate") != str(candidate)
        or profile.resolve(strict=True) != candidate
    ):
        raise RuntimeError("Boot generation has no verified activation receipt")


def recover_backup_stage(
    candidate,
    token,
    root=ROOT,
    current=CURRENT,
    profile=PROFILE,
    backups=BACKUPS,
    verify=None,
    health=None,
    check_only=False,
):
    """Release only a failed pre-activation backup after its off-host point is verified."""
    if not re.fullmatch(r"[a-f0-9]{32}", token):
        raise ValueError("Expected the exact transaction ID")
    verify = verify or backup_verifier.verify
    health = health or (
        lambda: subprocess.run(
            [str(current / "sw/bin/homelab-health")],
            check=True,
            timeout=180,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    )
    descriptor = os.open(root / "operation.lock", os.O_RDWR | os.O_NOFOLLOW)
    try:
        # This is the only recovery entrypoint allowed past the retained marker.
        # The existing inode and exclusive lock still fence all other operations.
        with locks.operation_lock(root, inherited_fd=descriptor):
            journal = root / "transaction"
            info = journal.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
                raise RuntimeError("Unsafe transaction journal")
            record = json.loads(journal.read_text())
            if record.get("id") != token or record.get("phase") != "backup":
                raise RuntimeError("Transaction differs or activation may have started")
            previous = Path(record["previous"])
            if record.get("candidate") != str(candidate):
                raise RuntimeError("Transaction candidate differs")
            if current.resolve(strict=True) != previous or profile.resolve(strict=True) != previous:
                raise RuntimeError("Current system or boot profile differs from the pre-activation generation")
            last = json.loads((root / "last-success.json").read_text())
            if last.get("phase") != "verified" or last.get("candidate") != str(previous):
                raise RuntimeError("Previous generation has no verified receipt")
            plan = plan_deployment(metadata(previous), metadata(candidate))
            if record.get("plan") != plan or plan["recovery"] != "off-host" or not plan["backup"]:
                raise RuntimeError("Transaction plan differs or has no off-host backup requirement")
            if not record.get("timings", {}).get("backup", {}).get("finishedAt"):
                raise RuntimeError("Backup phase has no completed attempt")
            backup_info = backups.lstat()
            backup_owner = backup_info.st_uid
            if not stat.S_ISDIR(backup_info.st_mode) or backup_info.st_mode & 0o077:
                raise RuntimeError("Unsafe backup root")
            matched = []
            for path in backup_publish.pending_sets(backups, include_verified=True):
                info = path.lstat()
                receipt_path = path / "LOCAL_VERIFIED.json"
                receipt_info = receipt_path.lstat()
                if (
                    not stat.S_ISDIR(info.st_mode)
                    or info.st_uid != backup_owner
                    or info.st_mode & 0o077
                    or not stat.S_ISREG(receipt_info.st_mode)
                    or receipt_info.st_uid != backup_owner
                    or receipt_info.st_mode & 0o077
                ):
                    raise RuntimeError("Unsafe local recovery set")
                receipt = json.loads(receipt_path.read_text())
                if receipt.get("transaction") == token:
                    matched.append((path, receipt))
            if len(matched) != 1:
                raise RuntimeError("Expected one local recovery set for the transaction")
            path, receipt = matched[0]
            marker = path / "NAS_VERIFIED"
            pin = path / "PINNED"
            if marker.is_symlink() or not marker.is_file() or marker.stat().st_uid != backup_owner:
                raise RuntimeError("Transaction has no NAS verification")
            if pin.is_symlink() or not pin.is_file() or pin.stat().st_uid != backup_owner:
                raise RuntimeError("Transaction recovery pin is missing")
            published = json.loads(marker.read_text())
            manifest = backup_publish.digest(path / "COMPLETE.json")
            if (
                receipt.get("scope") != "deployment"
                or receipt.get("services") != plan["backup"]
                or receipt.get("manifestSha256") != manifest
                or published.get("manifestSha256") != manifest
                or json.loads(pin.read_text()).get("transaction") != token
            ):
                raise RuntimeError("Transaction recovery receipt differs")
            metadata_snapshot = verify(path)
            if (
                metadata_snapshot.get("host") != metadata(previous)["host"]
                or metadata_snapshot.get("scope") != "deployment"
                or metadata_snapshot.get("services") != plan["backup"]
            ):
                raise RuntimeError("Recovery set does not cover the previous host and services")
            health()
            if check_only:
                return journal
            archive = root / ("transaction-recovered-" + token)
            os.link(journal, archive, follow_symlinks=False)
            durable.sync_directory(root)
            durable.remove(journal)
            return archive
    finally:
        os.close(descriptor)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["apply", "guard", "recover-backup"])
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--transaction-id")
    parser.add_argument("--check-only", action="store_true")
    parser.add_argument("--operation", dest="switch_operation", default="switch")
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("Only root may activate a system generation")
    candidate = system_path(args.candidate)
    if args.operation == "recover-backup":
        if not args.transaction_id:
            parser.error("Recovery requires the exact transaction ID")
        locks.initialize(ROOT)
        recover_backup_stage(candidate, args.transaction_id, check_only=args.check_only)
        print(
            "Backup-stage recovery is safe to release."
            if args.check_only
            else "Verified backup-stage transaction archived; Comin may retry activation."
        )
        return
    if args.transaction_id or args.check_only:
        parser.error("Recovery options are only accepted for backup-stage recovery")
    if args.operation == "guard":
        guard(candidate)
        return
    if args.switch_operation != "switch":
        parser.error("Stateful Darwin deployment supports switch only")
    locks.initialize(ROOT)
    # Detach from Comin's process group. Its launchd job also abandons child
    # process groups so an updater replacement cannot kill this lock owner.
    try:
        os.setsid()
    except PermissionError:
        if os.getpgrp() != os.getpid():
            raise
    with locks.operation_lock(ROOT) as fd:
        previous = system_path(CURRENT)
        if PROFILE.resolve(strict=True) != previous:
            raise RuntimeError("Current system and boot profile differ; inspect before another update")
        os.umask(0o077)
        with (ROOT / "activation.log").open("a") as log:
            os.chmod(ROOT / "activation.log", 0o600)
            plan = plan_deployment(metadata(previous), metadata(candidate))
            token = uuid.uuid4().hex

            def backup_old(old, lock):
                arguments = (
                    ()
                    if plan["legacy"]
                    else (
                        "--scope",
                        "deployment",
                        "--services",
                        *plan["backup"],
                        "--local-only",
                        "--transaction",
                        token,
                    )
                )
                children.run_service("backup", lock, 3600, system=old, log=log, arguments=arguments)
                if not plan["legacy"] and plan["recovery"] == "off-host":
                    children.run_service(
                        "backup", lock, 3600, system=old, log=log, arguments=("--publish-transaction", token)
                    )

            # Pulls use candidate definitions before activation, sequentially with
            # capture until combined host/VM peak workspace can be established.
            # Candidate wrapper supplies its own immutable service configuration.
            pull_timing = {}
            if plan["reconcile"] and not plan["legacy"]:
                started = time.monotonic()
                pull_timing = {"startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "accepted": False}
                try:
                    children.run_service(
                        "reconcile",
                        fd,
                        1800,
                        system=candidate,
                        log=log,
                        arguments=("--pull", "--services", *plan["reconcile"]),
                    )
                    pull_timing["accepted"] = True
                finally:
                    pull_timing["durationSeconds"] = round(time.monotonic() - started, 6)
                    durable.write_json(ROOT / "last-preflight.json", pull_timing)
            transaction(
                candidate,
                previous,
                ROOT,
                fd,
                backup_old,
                lambda new, lock, identity: activate(new, previous, lock, identity, log),
                lambda new, lock: children.run_service(
                    "reconcile",
                    lock,
                    1800,
                    system=new,
                    log=log,
                    arguments=("--services", *plan["reconcile"], "--health", *plan["health"]),
                ),
                token=token,
                initial_timings={"pull": pull_timing} if pull_timing else None,
                retire=lambda services: retire_services(services, log),
            )
            if plan["backup"] and not plan["legacy"]:
                try:
                    children.run_service("backup", fd, 60, system=candidate, log=log, arguments=("--unpin", token))
                except subprocess.SubprocessError:
                    log.write("Accepted deployment recovery point remains pinned; inspect retention cleanup.\n")
    print("Generation activated and assigned services verified.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError, locks.OperationDeferred):
        print(
            "Stateful activation did not complete. Preserve its transaction and inspect recovery state.",
            file=sys.stderr,
        )
        raise SystemExit(1)
