#!/usr/bin/env bash
set -euo pipefail

# Stand up the UniFi log receivers on the Synology NAS (HomeTB, DS420+). www-dhi9/www-cs0o.
#   - unifi-netflow : goflow2, NetFlow/IPFIX collector on UDP 2055 -> JSON-line flows
#   - unifi-syslog  : syslog-ng, remote syslog on UDP+TCP 514     -> daily text files
#   - unifi-enrich  : continuous enricher tailing flows.json -> enriched-flows.json
#                     (device names from UniFi API + cached rDNS + cached ASN/org)
# All write into the `Unifi` shared folder: /volume1/Unifi/logs/{netflow,syslog}.
#
# Why containers (not Log Center / bosun): Docker is already installed on the NAS;
# bosun can't publish UDP host ports and NFS-in-container hangs on OrbStack (www-6mz7),
# so the receivers live on the NAS itself. Run from the dev box; it SSHes to the NAS
# using the DSM admin login in 1Password (op://Homelab/Synology DSM/*).
#
#   ./scripts/setup-unifi-log-receivers.sh
#
# Idempotent: re-running cleanly recreates both containers. To point the gateway at
# these receivers, run scripts/configure-unifi-log-export.sh afterwards.

NAS_HOST="${NAS_HOST:-$(op read "op://Homelab/Synology DSM/host")}"
NAS_USER="${NAS_USER:-$(op read "op://Homelab/Synology DSM/username")}"
SSHPASS="$(op read "op://Homelab/Synology DSM/password")"; export SSHPASS
CONF_LOCAL="$(dirname "$0")/unifi-syslog-ng.conf"

command -v sshpass >/dev/null || { echo "FATAL: sshpass required (brew install hudochenkov/sshpass/sshpass)" >&2; exit 1; }
[ -f "$CONF_LOCAL" ] || { echo "FATAL: missing $CONF_LOCAL" >&2; exit 1; }

ssh_opts=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)

ENRICH_LOCAL="$(dirname "$0")/unifi-enrich-flows.py"
[ -f "$ENRICH_LOCAL" ] || { echo "FATAL: missing $ENRICH_LOCAL" >&2; exit 1; }

echo "== copy configs + setup script to NAS ($NAS_USER@$NAS_HOST) =="
# Synology sshd has no SFTP subsystem -> must use legacy scp (-O).
sshpass -e scp -O "${ssh_opts[@]}" "$CONF_LOCAL" "$NAS_USER@$NAS_HOST:/tmp/unifi-syslog-ng.conf"
sshpass -e scp -O "${ssh_opts[@]}" "$ENRICH_LOCAL" "$NAS_USER@$NAS_HOST:/tmp/unifi-enrich-flows.py"

# The whole root-side install runs in one `sudo bash` (Synology sudo doesn't cache).
REMOTE_SCRIPT=$(cat <<'REMOTE'
set -e
D=/usr/local/bin/docker
mkdir -p /volume1/Unifi/logs/syslog /volume1/Unifi/logs/netflow /volume1/Unifi/docker/syslog-ng
cp /tmp/unifi-syslog-ng.conf /volume1/Unifi/docker/syslog-ng/syslog-ng.conf
# goflow2 runs as non-root -> make the log dirs writable
chmod 0777 /volume1/Unifi/logs/netflow /volume1/Unifi/logs/syslog

$D pull netsampler/goflow2:latest >/dev/null
$D pull balabit/syslog-ng:latest  >/dev/null
$D rm -f unifi-netflow unifi-syslog >/dev/null 2>&1 || true

$D run -d --name unifi-netflow --restart unless-stopped \
  -p 2055:2055/udp -v /volume1/Unifi/logs/netflow:/output \
  netsampler/goflow2:latest \
  -listen "netflow://:2055" -format json -transport.file /output/flows.json >/dev/null

# TZ so daily files + timestamps split at LA midnight, matching the flow
# archives (NAS-local date) instead of UTC.
$D run -d --name unifi-syslog --restart unless-stopped \
  -e TZ=America/Los_Angeles \
  -p 514:514/udp -p 514:514/tcp -v /volume1/Unifi/logs/syslog:/output \
  -v /volume1/Unifi/docker/syslog-ng/syslog-ng.conf:/etc/syslog-ng/syslog-ng.conf:ro \
  balabit/syslog-ng:latest --no-caps >/dev/null

# Continuous enricher (www-cs0o). Holds ZERO credentials: device names come
# from the non-secret ip_names.json pushed by push-unifi-names.sh; private
# IPs not in the map fall back to gateway PTR. The UniFi key never leaves
# the dev box.
mkdir -p /volume1/Unifi/docker/enrich
cp /tmp/unifi-enrich-flows.py /volume1/Unifi/docker/enrich/unifi-enrich-flows.py
$D pull python:3.12-alpine >/dev/null
$D run -d --name unifi-enrich --restart unless-stopped \
  -v /volume1/Unifi/logs/netflow:/data \
  -v /volume1/Unifi/docker/enrich/unifi-enrich-flows.py:/app/enrich.py:ro \
  python:3.12-alpine python3 /app/enrich.py >/dev/null

sleep 4
$D ps --filter name=unifi- --format "{{.Names}}: {{.Status}}  {{.Ports}}"
REMOTE
)

echo "== run receiver setup on NAS (as root) =="
printf '%s\n' "$SSHPASS" | sshpass -e ssh "${ssh_opts[@]}" "$NAS_USER@$NAS_HOST" "sudo -S bash -c '$REMOTE_SCRIPT'"

echo "== push device-name map (non-secret) =="
"$(dirname "$0")/push-unifi-names.sh"

echo
echo "Receivers up. Next: ./scripts/configure-unifi-log-export.sh to point the gateway here."
