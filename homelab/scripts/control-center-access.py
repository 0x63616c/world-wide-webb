#!/usr/bin/env python3
"""Keep the installed app's private address independent of its hosting machine."""

import copy
import json
import subprocess
import sys

SERVICE = "svc:homelab"
HOST = "homelab.tail8c014d.ts.net:443"
ORIGIN = "http://127.0.0.1:4202"
EXPECTED = {
    "TCP": {"443": {"HTTPS": True}},
    "Web": {HOST: {"Handlers": {"/": {"Proxy": ORIGIN}}}},
}


def validate(config):
    if config.get("AllowFunnel", {}).get(HOST):
        raise RuntimeError("Control Center must remain private to the tailnet")
    current = config.get("Services", {}).get(SERVICE)
    if current is not None and current != EXPECTED:
        raise RuntimeError("The app service already has a different route; refusing to replace it")
    for foreground in config.get("Foreground", {}).values():
        if SERVICE in foreground.get("Services", {}):
            raise RuntimeError("The app service has a foreground owner")


def unrelated(config):
    result = copy.deepcopy(config)
    result.get("Services", {}).pop(SERVICE, None)
    if not result.get("Services"):
        result.pop("Services", None)
    return result


def reconcile(binary):
    def read(*args):
        result = subprocess.run([binary, *args], check=True, capture_output=True, text=True, timeout=30)
        return json.loads(result.stdout) or {}

    node = read("status", "--json", "--peers=false")
    if node.get("BackendState") != "Running":
        raise RuntimeError("Tailscale is not connected")
    if node.get("Self", {}).get("HostName") != "homelab-mac-mini":
        raise RuntimeError("Only the production Mini may advertise the app service")
    if "tag:homelab" not in node.get("Self", {}).get("Tags", []):
        raise RuntimeError("The Mini requires its managed Tailscale identity")
    before = read("serve", "status", "--json")
    validate(before)
    if before.get("Services", {}).get(SERVICE) != EXPECTED:
        subprocess.run(
            [binary, "serve", "--service=" + SERVICE, "--https=443", ORIGIN],
            check=True,
            capture_output=True,
            text=True,
            timeout=60,
        )
    after = read("serve", "status", "--json")
    validate(after)
    if after.get("Services", {}).get(SERVICE) != EXPECTED:
        raise RuntimeError("The app service route did not become active")
    if unrelated(before) != unrelated(after):
        raise RuntimeError("An unrelated Tailscale route changed")
    # Advertisements are separate from ServeConfig and may be lost on restore.
    subprocess.run(
        [binary, "serve", "advertise", SERVICE],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    )
    print("Verified private app service route and advertisement")


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise RuntimeError("A Tailscale executable is required")
        reconcile(sys.argv[1])
    except (RuntimeError, subprocess.SubprocessError, ValueError, OSError) as error:
        # Never emit subprocess output, node inventory or application payloads.
        print(str(error) if isinstance(error, RuntimeError) else "App route reconciliation failed", file=sys.stderr)
        sys.exit(1)
