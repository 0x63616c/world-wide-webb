#!/usr/bin/env bash
set -euo pipefail

# Enriched NetFlow report (CC-dhi9): top LAN talkers (named from UniFi) + top
# external endpoints annotated with reverse-DNS + ASN/org. Reads the live
# flows.json on the NAS; runs the enrichment there (stdlib only).
#
#   ./scripts/unifi-flow-report.sh

NAS_HOST="${NAS_HOST:-$(op read "op://Homelab/Synology DSM/host")}"
NAS_USER="${NAS_USER:-$(op read "op://Homelab/Synology DSM/username")}"
SSHPASS="$(op read "op://Homelab/Synology DSM/password")"; export SSHPASS
KEY="$(op read "op://Homelab/UniFi/local_api_key")"
CTRL="$(op read "op://Homelab/UniFi/controller_url")"
HOST="$(printf '%s' "$CTRL" | sed -E 's#^(https?://[^/]+).*#\1#')"
DIR="$(cd "$(dirname "$0")" && pwd)"; TMP="$(mktemp -d)"
ssh_opts=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
trap 'rm -rf "$TMP"' EXIT

# Build an IP -> device-name map from the UniFi client list.
SID="$(curl -sk -m10 -H "X-API-KEY: $KEY" "$HOST/proxy/network/integration/v1/sites" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])")"
curl -sk -m10 -H "X-API-KEY: $KEY" "$HOST/proxy/network/integration/v1/sites/$SID/clients?limit=200" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps({c['ipAddress']:(c.get('name') or c.get('hostname')) for c in d['data'] if c.get('ipAddress') and (c.get('name') or c.get('hostname'))}))" \
  > "$TMP/ip_names.json"

sshpass -e scp -O "${ssh_opts[@]}" "$DIR/unifi-flow-report.py" "$TMP/ip_names.json" "$NAS_USER@$NAS_HOST:/tmp/" >/dev/null
printf '%s\n' "$SSHPASS" | sshpass -e ssh "${ssh_opts[@]}" "$NAS_USER@$NAS_HOST" \
  'sudo -S bash -c "python3 /tmp/unifi-flow-report.py /volume1/Unifi/logs/netflow/flows.json /tmp/ip_names.json"' 2>/dev/null
