#!/usr/bin/env python3
"""Generate a scheduled-only watchdog deployment from OpenTofu JSON outputs."""
import argparse
import json
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bindings", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    parser.add_argument("--destination", required=True, help="Verified owner alert address")
    args = parser.parse_args()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", args.destination):
        raise ValueError("invalid alert address")
    bindings = json.loads(args.bindings.read_text())
    if "monitoring_bindings" in bindings:
        bindings = bindings["monitoring_bindings"]["value"]
    env = bindings["environment"]
    if env != "production":
        raise ValueError("invalid environment")
    name = f"folding-watchdog-{env}"
    if bindings["worker_name"] != name or bindings["database_name"] != name:
        raise ValueError("watchdog must have an isolated database and Worker")
    if not re.fullmatch(r"[0-9a-f]{32}", bindings["account_id"]):
        raise ValueError("invalid account identifier")
    if not re.fullmatch(r"[0-9a-f-]{36}", bindings["database_id"]):
        raise ValueError("invalid database identifier")
    enabled = bindings["enabled"]
    verified = bindings["outbound_delivery_verified"]
    if type(enabled) is not bool or type(verified) is not bool:
        raise ValueError("switches must be booleans")
    if enabled and not verified:
        raise ValueError("verify outbound delivery before enabling the watchdog")
    version = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    crate = ROOT / "backend/watchdog"
    config = {
        "name": name, "account_id": bindings["account_id"],
        "main": str(crate / "build/worker/shim.mjs"),
        "compatibility_date": "2026-11-07", "workers_dev": False,
        "preview_urls": False,
        "triggers": {"crons": ["* * * * *"] if enabled else []},
        "vars": {"DEPLOYMENT": env, "WORKER_VERSION": version,
                 "MONITOR_ENABLED": str(enabled).lower(),
                 "OUTBOUND_DELIVERY_VERIFIED": str(verified).lower(),
                 "ALERT_DESTINATION": args.destination},
        "d1_databases": [{"binding": "MONITOR_DB", "database_name": name,
                          "database_id": bindings["database_id"],
                          "migrations_dir": str(crate / "migrations")}],
        "send_email": [{"name": "ALERT_EMAIL", "destination_address": args.destination}],
        "observability": {"enabled": True, "head_sampling_rate": 1},
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(config, indent=2) + "\n")
    print(f"Generated {name}; scheduled={enabled}, delivery_verified={verified}")


if __name__ == "__main__":
    main()
