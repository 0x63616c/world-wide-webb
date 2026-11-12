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
import signal
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
ROOT = Path("/var/lib/homelab-operations")
CURRENT = Path("/run/current-system")
PROFILE = Path("/nix/var/nix/profiles/system")


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


HA_LABELS = ('org.nixos.homelab-ha-vmnet', 'org.nixos.homelab-ha-colima')


def ha_runtime_changed(previous, candidate):
    if 'home-assistant' not in metadata(previous)['services']:
        return False
    return any(
        (previous / 'Library/LaunchDaemons' / (label + '.plist')).read_bytes()
        != (candidate / 'Library/LaunchDaemons' / (label + '.plist')).read_bytes()
        for label in HA_LABELS
    )


def launcher_loaded(label):
    result = subprocess.run(['/bin/launchctl', 'print', 'system/' + label],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
    if result.returncode not in (0, 113):
        raise RuntimeError('Could not inspect HA launcher')
    return result.returncode == 0


def unload_ha_launcher():
    label = HA_LABELS[1]
    if not launcher_loaded(label):
        return
    subprocess.run(['/bin/launchctl', 'bootout', 'system/' + label], check=True, timeout=30)
    deadline = time.monotonic() + 60
    while launcher_loaded(label):
        if time.monotonic() >= deadline:
            raise RuntimeError('HA launcher did not finish unloading')
        time.sleep(1)


def ensure_ha_launchers():
    for label in HA_LABELS:
        if not launcher_loaded(label):
            subprocess.run(['/bin/launchctl', 'bootstrap', 'system',
                            '/Library/LaunchDaemons/' + label + '.plist'], check=True, timeout=30)


def activate(candidate, previous, fd, token, log):
    # launchd restart alone leaves an already-running Colima guest connected to
    # the old vmnet backend. Quiesce it under the transaction lock before switch.
    restart_ha = ha_runtime_changed(previous, candidate)
    if restart_ha:
        unload_ha_launcher()
        children.run_service('stop-ha', fd, 180, system=candidate, log=log)
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


def transaction(candidate, previous, root, fd, backup, switch, reconcile, token=None, initial_timings=None):
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["apply", "guard"])
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--operation", dest="switch_operation", default="switch")
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("Only root may activate a system generation")
    candidate = system_path(args.candidate)
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
