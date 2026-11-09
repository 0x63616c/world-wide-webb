"""Run selected existing service handlers with bounded independent concurrency."""

import argparse
import json
import os
import shutil
import subprocess
from pathlib import Path

from bounded import run_independent
from deployment_plan import SERVICES


def run(command):
    # Inherit the transaction's lock into every mutation process. The outer
    # service-child process group owns timeout/cancellation for the whole tree.
    value = os.environ.get("HOMELAB_OPERATION_FD", "")
    fds = (int(value),) if value.isdecimal() and int(value) >= 3 else ()
    subprocess.run(command, check=True, pass_fds=fds, timeout=900)


def admit_pull(service):
    """Check both storage domains before adding image layers; capture stays serial."""
    env = os.environ.copy()
    profile = "services"
    if service == "home-assistant":
        env["COLIMA_HOME"] = "/var/lib/_containers/.colima-ha"
        profile = "ha"
    result = subprocess.check_output(
        ["colima", "ssh", "--profile", profile, "--", "df", "-Pk", "/var/lib/docker"], env=env, text=True, timeout=30
    )
    vm_free = int(result.splitlines()[-1].split()[3]) * 1024
    if shutil.disk_usage("/var/lib/_containers").free < 30 * 1024**3 or vm_free < 5 * 1024**3:
        raise RuntimeError("Insufficient host or VM image workspace; deployment deferred")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--services", nargs="*")
    parser.add_argument("--health", nargs="*")
    parser.add_argument("--pull", action="store_true")
    args = parser.parse_args()
    config = json.loads(args.config.read_text())
    selected = config["services"] if args.services is None else args.services
    if len(set(selected)) != len(selected) or not set(selected) <= set(config["services"]) <= SERVICES:
        raise ValueError("Invalid selected services")
    health = selected if args.health is None else args.health
    if len(set(health)) != len(health) or not set(health) <= set(config["services"]):
        raise ValueError("Invalid health selection")
    if args.pull:
        # Pull before capture when combined VM/host peak space is not provable.
        for service in selected:
            admit_pull(service)
            os.environ["DOCKER_HOST"] = "unix:///var/lib/_containers/" + (
                ".colima-ha/ha/docker.sock" if service == "home-assistant" else ".colima/services/docker.sock"
            )
            run(config["pullCommands"][service])
        return
    if "home-assistant" in selected:
        run(config["commands"]["home-assistant"])
    run_independent([config["commands"][s] for s in selected if s != "home-assistant"], run)
    run_independent([config["healthCommands"][s] for s in health], run)


if __name__ == "__main__":
    main()
