#!/usr/bin/env python3
"""Continuous NetFlow enrichment daemon (www-cs0o). Runs in the `unifi-enrich`
container on the NAS.

Tails goflow2's raw flows.json (NDJSON) incrementally and writes
enriched-flows.json alongside it: each flow gains device names (from the UniFi
client list), reverse-DNS and ASN/org for the external side. Raw stays raw;
enriched lags by ~POLL_SECS. Built to be cheap at steady state:

  - device map: 1 UniFi API call per DEVICE_REFRESH_SECS (default 5 min)
  - reverse-DNS: cached RDNS_TTL_SECS (default 24 h), negative results too
  - ASN/org: Team Cymru bulk whois, only for never-seen IPs, cached forever
  - rotation-aware: when flows.json shrinks/changes inode, restart from 0

Device names come from /data/ip_names.json — a NON-SECRET ip->name map pushed
from the dev box by scripts/push-unifi-names.sh (the UniFi API key never
leaves the dev box; this container holds zero credentials). Private IPs not
in the map fall back to reverse-DNS against the gateway (PTR), so most
devices are named even when the map is stale.

Env: INPUT (default /data/flows.json), OUTPUT (default
/data/enriched-flows.json), NAMES (default /data/ip_names.json). Stdlib only.
"""
import ipaddress
import json
import os
import socket
import sys
import time

INPUT = os.environ.get("INPUT", "/data/flows.json")
OUTPUT = os.environ.get("OUTPUT", "/data/enriched-flows.json")
NAMES = os.environ.get("NAMES", "/data/ip_names.json")
POLL_SECS = float(os.environ.get("POLL_SECS", "5"))
RDNS_TTL_SECS = int(os.environ.get("RDNS_TTL_SECS", "86400"))

log = lambda m: (print(m, flush=True))


def is_private(ip):
    try:
        return ipaddress.ip_address(ip).is_private
    except ValueError:
        return False


class DeviceMap:
    """ip -> name from the pushed ip_names.json, reloaded when its mtime changes."""

    def __init__(self):
        self.names, self.mtime = {}, -1.0

    def get(self, ip):
        try:
            mt = os.stat(NAMES).st_mtime
            if mt != self.mtime:
                with open(NAMES) as f:
                    self.names = json.load(f)
                self.mtime = mt
                log(f"loaded {len(self.names)} device names from {NAMES}")
        except (OSError, ValueError):
            pass  # map absent/corrupt -> PTR fallback still names devices
        return self.names.get(ip)


class RdnsCache:
    def __init__(self):
        self.cache = {}  # ip -> (name|"", expires)

    def get(self, ip):
        hit = self.cache.get(ip)
        now = time.time()
        if hit and hit[1] > now:
            return hit[0]
        socket.setdefaulttimeout(1.5)
        try:
            name = socket.gethostbyaddr(ip)[0]
        except OSError:
            name = ""
        self.cache[ip] = (name, now + RDNS_TTL_SECS)
        return name


class AsnCache:
    """Team Cymru bulk whois; queried in batches of new IPs, cached forever."""

    def __init__(self):
        self.cache = {}
        self.pending = set()

    def note(self, ip):
        if ip not in self.cache:
            self.pending.add(ip)

    def flush(self):
        if not self.pending:
            return
        batch, self.pending = list(self.pending)[:200], set()
        try:
            c = socket.create_connection(("whois.cymru.com", 43), timeout=8)
            c.sendall(("begin\nverbose\n" + "\n".join(batch) + "\nend\n").encode())
            buf = b""
            while True:
                chunk = c.recv(4096)
                if not chunk:
                    break
                buf += chunk
            c.close()
            for ln in buf.decode(errors="ignore").splitlines():
                p = [x.strip() for x in ln.split("|")]
                if len(p) >= 7 and p[1] and p[1][0].isdigit():
                    self.cache[p[1]] = f"{p[6]} (AS{p[0]})"
        except OSError as e:
            log(f"cymru lookup failed ({e}); will retry batch later")
            self.pending.update(batch)
        for ip in batch:  # negative-cache misses so we don't requery forever
            self.cache.setdefault(ip, "")

    def get(self, ip):
        return self.cache.get(ip, "")


def enrich(flow, devices, rdns, asn):
    for side in ("src", "dst"):
        ip = flow.get(f"{side}_addr", "")
        if not ip:
            continue
        if is_private(ip):
            # pushed UniFi alias wins; gateway PTR names the rest
            name = devices.get(ip) or rdns.get(ip).removesuffix(".").removesuffix(".localdomain")
            if name:
                flow[f"{side}_name"] = name
        else:
            host = rdns.get(ip)
            if host:
                flow[f"{side}_rdns"] = host
            org = asn.get(ip)
            if org:
                flow[f"{side}_org"] = org
    return flow


def main():
    devices, rdns, asn = DeviceMap(), RdnsCache(), AsnCache()
    offset, ino = 0, -1
    log(f"unifi-enrich: {INPUT} -> {OUTPUT} (poll {POLL_SECS}s)")
    while True:
        try:
            st = os.stat(INPUT)
        except FileNotFoundError:
            time.sleep(POLL_SECS)
            continue
        if st.st_ino != ino or st.st_size < offset:  # rotated -> fresh file
            offset, ino = 0, st.st_ino
        if st.st_size > offset:
            with open(INPUT, "rb") as f:
                f.seek(offset)
                data = f.read()
            # consume only up to the last complete line (byte-exact offset)
            cut = data.rfind(b"\n")
            if cut == -1:
                time.sleep(POLL_SECS)
                continue
            offset += cut + 1
            lines = data[: cut + 1].decode(errors="replace").splitlines()
            flows = []
            for ln in lines:
                try:
                    flows.append(json.loads(ln))
                except ValueError:
                    continue
            # pre-register external IPs, one bulk ASN query per poll
            for fl in flows:
                for side in ("src", "dst"):
                    ip = fl.get(f"{side}_addr", "")
                    if ip and not is_private(ip):
                        asn.note(ip)
            asn.flush()
            with open(OUTPUT, "a") as out:
                for fl in flows:
                    out.write(json.dumps(enrich(fl, devices, rdns, asn)) + "\n")
        time.sleep(POLL_SECS)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
