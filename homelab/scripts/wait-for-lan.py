#!/usr/bin/env python3
"""Wait for the configured physical LAN before attaching the HA bridge."""

import ipaddress
import subprocess
import sys
import time


def lan_address(interface):
    link = subprocess.run(["/sbin/ifconfig", interface], capture_output=True, text=True, timeout=5, check=False)
    if link.returncode or "status: active" not in [line.strip() for line in link.stdout.splitlines()]:
        return None
    result = subprocess.run(
        ["/usr/sbin/ipconfig", "getifaddr", interface], capture_output=True, text=True, timeout=5, check=False
    )
    if result.returncode:
        return None
    try:
        address = ipaddress.IPv4Address(result.stdout.strip())
    except ipaddress.AddressValueError:
        return None
    if (
        address.is_unspecified
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
    ):
        return None
    return str(address)


def wait_for_lan(interface, timeout=120):
    deadline = time.monotonic() + timeout
    while True:
        try:
            address = lan_address(interface)
        except (OSError, subprocess.TimeoutExpired):
            address = None
        if address:
            return address
        if time.monotonic() >= deadline:
            raise RuntimeError(f"Physical LAN {interface} has no active link and usable IPv4 after {timeout} seconds")
        time.sleep(2)


if __name__ == "__main__":
    try:
        ready = wait_for_lan(sys.argv[1])
    except RuntimeError as error:
        print(error, file=sys.stderr)
        raise SystemExit(1)
    print(f"Physical LAN {sys.argv[1]} ready at {ready}")
