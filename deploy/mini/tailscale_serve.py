#!/usr/bin/env python3
"""Declare the private native API route without changing other Tailscale services."""

import json
import os
import shutil
import subprocess

HOST = "homelab.tail8c014d.ts.net"
ORIGIN = "http://127.0.0.1:4201"
PORT = "443"


def validate(config, hostname):
    if hostname.rstrip(".") != HOST:
        raise RuntimeError("Tailscale node does not match the native app endpoint")
    if config.get("AllowFunnel", {}).get(HOST + ":443"):
        raise RuntimeError("The native API must never be published with Tailscale Funnel")
    route = config.get("Web", {}).get(HOST + ":443", {})
    if route and route.get("Handlers") != {"/": {"Proxy": ORIGIN}}:
        raise RuntimeError("HTTPS port 443 already belongs to another Tailscale service")
    tcp = config.get("TCP", {}).get(PORT)
    if tcp and not tcp.get("HTTPS"):
        raise RuntimeError("Port 443 must terminate HTTPS in Tailscale Serve")


def unrelated(config):
    result = json.loads(json.dumps(config))
    for group, key in [("TCP", PORT), ("Web", HOST + ":443"), ("AllowFunnel", HOST + ":443")]:
        result.setdefault(group, {}).pop(key, None)
        if not result[group]:
            result.pop(group)
    return result


def main():
    binary = os.environ.get("WWW_TAILSCALE_BIN") or shutil.which("tailscale")
    if not binary:
        raise RuntimeError("Install Tailscale before publishing the private API")

    def read(*args):
        return json.loads(subprocess.check_output([binary, *args], text=True))

    node = read("status", "--json")
    before = read("serve", "status", "--json")
    validate(before, node["Self"]["DNSName"])
    subprocess.run([binary, "serve", "--bg", "--https=443", ORIGIN], check=True, stdout=subprocess.DEVNULL)
    after = read("serve", "status", "--json")
    validate(after, node["Self"]["DNSName"])
    if after.get("Web", {}).get(HOST + ":443", {}).get("Handlers") != {"/": {"Proxy": ORIGIN}}:
        raise RuntimeError("Private native API route did not become active")
    if unrelated(before) != unrelated(after):
        raise RuntimeError("An unrelated Tailscale service changed")
    print("Verified private Tailscale HTTPS route; unrelated services unchanged")


if __name__ == "__main__":
    main()
