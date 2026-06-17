#!/usr/bin/env bash
# Stores the guest WiFi credentials in the SOPS vault so the api/worker
# can serve them to the captive portal. Set the SAME password here AND
# in the UniFi guest WLAN console. Safe to re-run to rotate the password
# or rename the SSID.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Saving guest WiFi credentials to vault..."
echo "(This will overwrite any existing values.)"
echo ""

echo "Step 1. SSID (press ENTER to skip, keeping the existing vault value)."
read -rp "SSID: " SSID

echo ""
echo "Step 2. The WiFi password for the guest network."
echo "Remember to set the SAME password in the UniFi console guest WLAN."
read -rsp "Password: " PASSWORD; echo
[ -n "$PASSWORD" ] || { echo "FATAL: empty password" >&2; exit 1; }
read -rsp "Confirm password: " PASSWORD2; echo
[ "$PASSWORD" = "$PASSWORD2" ] || { echo "FATAL: passwords do not match" >&2; exit 1; }

if [ -n "$SSID" ]; then
  echo "$SSID" | "$REPO_ROOT/scripts/set-secret.sh" WIFI_GUEST_CREDENTIALS__SSID
fi
echo "$PASSWORD" | "$REPO_ROOT/scripts/set-secret.sh" WIFI_GUEST_CREDENTIALS__PASSWORD

echo "Done. Vault keys: WIFI_GUEST_CREDENTIALS__SSID, WIFI_GUEST_CREDENTIALS__PASSWORD"
