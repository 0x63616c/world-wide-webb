#!/usr/bin/env bash
set -euo pipefail

# Push the (non-secret) UniFi ip->device-name map to the NAS for the enricher
# (www-cs0o). The UniFi API key stays on THIS box; only the resulting names map
# travels. Run after renaming devices in UniFi, or cron it for freshness ,
# unmapped/stale IPs degrade gracefully to gateway PTR names, never break flows.
#
#   ./scripts/push-unifi-names.sh

_VAULT_PATH="$(cd "$(dirname "$0")/.." && pwd)/secrets/vault.yaml"
SOPS_AGE_KEY=$(security find-generic-password -a "$USER" -s "age-world-wide-webb-private-key" -w)
export SOPS_AGE_KEY
_extract() { sops -d "$_VAULT_PATH" | grep "^$1:" | cut -d' ' -f2-; }
NAS_HOST="${NAS_HOST:-$(_extract SYNOLOGY_DSM__HOST)}"
NAS_USER="${NAS_USER:-admin}"
SSHPASS="$(_extract SYNOLOGY_DSM__PASSWORD)"; export SSHPASS
KEY="$(_extract UNIFI__LOCAL_API_KEY)"
HOST="$(_extract UNIFI__CONTROLLER_URL | sed -E 's#^(https?://[^/]+).*#\1#')"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
ssh_opts=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)

SID="$(curl -sk -m10 -H "X-API-KEY: $KEY" "$HOST/proxy/network/integration/v1/sites" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])")"
curl -sk -m10 -H "X-API-KEY: $KEY" "$HOST/proxy/network/integration/v1/sites/$SID/clients?limit=200" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps({c['ipAddress']:(c.get('name') or c.get('hostname')) for c in d['data'] if c.get('ipAddress') and (c.get('name') or c.get('hostname'))}))" \
  > "$TMP/ip_names.json"

N=$(python3 -c "import json;print(len(json.load(open('$TMP/ip_names.json'))))")
sshpass -e scp -O "${ssh_opts[@]}" "$TMP/ip_names.json" "$NAS_USER@$NAS_HOST:/tmp/ip_names.json" >/dev/null
printf '%s\n' "$SSHPASS" | sshpass -e ssh "${ssh_opts[@]}" "$NAS_USER@$NAS_HOST" \
  'sudo -S install -m 0644 /tmp/ip_names.json /volume1/Unifi/logs/netflow/ip_names.json' 2>/dev/null
echo "pushed $N device names to $NAS_HOST:/volume1/Unifi/logs/netflow/ip_names.json"
