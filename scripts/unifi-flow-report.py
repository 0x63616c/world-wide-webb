#!/usr/bin/env python3
"""Enriched NetFlow report from goflow2's flows.json (NDJSON). www-dhi9.

Aggregates the captured flows into: top LAN devices (by traffic), top external
endpoints annotated with reverse-DNS + ASN/org (Team Cymru bulk whois, stdlib
only — no API key, no GeoIP DB), top destination ports, and protocol mix.

  python3 unifi-flow-report.py <flows.json> [ip_names.json]
"""
import sys, json, collections, ipaddress, socket

flows = sys.argv[1]
names = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else {}


def internal(ip):
    try:
        return ipaddress.ip_address(ip).is_private
    except ValueError:
        return False


def human(x):
    for u in ("B", "KB", "MB", "GB", "TB"):
        if x < 1024:
            return f"{x:.1f}{u}"
        x /= 1024
    return f"{x:.1f}PB"


bi, be, bp, bpr = (collections.Counter() for _ in range(4))
total = n = 0
for line in open(flows):
    line = line.strip()
    if not line:
        continue
    try:
        f = json.loads(line)
    except ValueError:
        continue
    n += 1
    b = f.get("bytes", 0) or 0
    total += b
    s, d = f.get("src_addr", ""), f.get("dst_addr", "")
    bpr[f.get("proto", "?")] += b
    si, di = internal(s), internal(d)
    if si and not di:
        bi[s] += b; be[d] += b; bp[f.get("dst_port", 0)] += b
    elif di and not si:
        bi[d] += b; be[s] += b; bp[f.get("dst_port", 0)] += b
    elif si and di:
        bi[s] += b

# enrich the top external endpoints: reverse DNS + ASN/org
top_ext = [ip for ip, _ in be.most_common(15)]
socket.setdefaulttimeout(2)
rdns = {}
for ip in top_ext:
    try:
        rdns[ip] = socket.gethostbyaddr(ip)[0]
    except OSError:
        rdns[ip] = ""
asn = {}
try:
    c = socket.create_connection(("whois.cymru.com", 43), timeout=5)
    c.sendall(("begin\nverbose\n" + "\n".join(top_ext) + "\nend\n").encode())
    buf = b""
    while True:
        chunk = c.recv(4096)
        if not chunk:
            break
        buf += chunk
    c.close()
    for ln in buf.decode(errors="ignore").splitlines():
        p = [x.strip() for x in ln.split("|")]
        if len(p) >= 7 and p[1] and p[1][0].isdigit():  # AS|IP|prefix|CC|registry|allocated|name
            asn[p[1]] = f"{p[6]} (AS{p[0]}, {p[3]})"
except OSError:
    pass

nm = lambda ip: names.get(ip, ip)
print(f"flows={n}  total={human(total)}\n")
print("TOP LAN DEVICES by traffic:")
for ip, b in bi.most_common(10):
    print(f"  {human(b):>9}  {nm(ip):<24} {ip}")
print("\nTOP EXTERNAL ENDPOINTS (reverse-DNS + ASN):")
for ip, b in be.most_common(15):
    print(f"  {human(b):>9}  {ip:<16} {asn.get(ip,''):<34} {rdns.get(ip,'')}")
print("\nTOP DESTINATION PORTS:")
for p, b in bp.most_common(8):
    print(f"  {human(b):>9}  port {p}")
print("\nPROTOCOL MIX:")
for p, b in bpr.most_common():
    print(f"  {human(b):>9}  {p}")
