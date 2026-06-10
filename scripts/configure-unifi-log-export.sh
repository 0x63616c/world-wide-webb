#!/usr/bin/env bash
set -euo pipefail

# Point the UniFi Cloud Gateway Fiber at the NAS log receivers. CC-dhi9.
#   - NetFlow/IPFIX export  -> <NAS>:2055, sampling OFF (full flows), 1-min export
#   - Remote syslog (SIEM)  -> <NAS>:514
#
# Uses the UniFi *local* API key (op://Homelab/UniFi/local_api_key, X-API-KEY header).
# That key authenticates against the private controller API, including set/setting —
# so these two settings (whose collector/SIEM fields are NOT in the read-only
# integration API) can be written here. Reversible: re-run with DISABLE=1 to turn off.
#
#   ./scripts/configure-unifi-log-export.sh

KEY="$(op read "op://Homelab/UniFi/local_api_key")"
CTRL="$(op read "op://Homelab/UniFi/controller_url")"
HOST="$(printf '%s' "$CTRL" | sed -E 's#^(https?://[^/]+).*#\1#')"
NAS="${NAS_HOST:-$(op read "op://Homelab/Synology DSM/host")}"
API="$HOST/proxy/network/api/s/default"
DISABLE="${DISABLE:-0}"

req(){ curl -sk -m 15 -H "X-API-KEY: $KEY" "$@"; }
set_setting(){ req -X POST -H "Content-Type: application/json" "$API/set/setting/$1" -d "$2" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(' ',d['meta'])"; }

# Networks to export flows for: LANs + any guest networks (e.g. a future
# www-guest SSID's network) — WANs excluded.
LAN_IDS=$(req "$API/rest/networkconf" | python3 -c "
import sys,json
print(json.dumps([n['_id'] for n in json.load(sys.stdin)['data'] if n.get('purpose') in ('corporate','guest')]))")
echo "LAN network ids: $LAN_IDS"

if [ "$DISABLE" = "1" ]; then
  echo "== disabling NetFlow + remote syslog =="
  set_setting netflow  '{"enabled":false}'
  set_setting rsyslogd '{"enabled":true,"this_controller":true}'
  exit 0
fi

echo "== NetFlow/IPFIX export -> $NAS:2055 (sampling off) =="
set_setting netflow "{\"enabled\":true,\"server\":\"$NAS\",\"port\":2055,\"version\":10,\"sampling_mode\":\"off\",\"export_frequency\":1,\"refresh_rate\":20,\"sampling_rate\":512,\"auto_engine_id_enabled\":true,\"network_ids\":$LAN_IDS}"

echo "== Remote syslog (SIEM) -> $NAS:514 =="
# this_controller:false == "SIEM Server" mode (UniFi syslog is internal-OR-remote, not both).
set_setting rsyslogd "{\"enabled\":true,\"this_controller\":false,\"ip\":\"$NAS\",\"port\":\"514\",\"log_all_contents\":true}"

echo
echo "Done. Flows -> /volume1/Unifi/logs/netflow/flows.json ; syslog -> /volume1/Unifi/logs/syslog/."
