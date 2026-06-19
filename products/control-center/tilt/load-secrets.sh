#!/usr/bin/env bash
# Decrypts secrets/vault.yaml and emits KEY=VALUE lines for Tilt.
# SOPS+age based. Age key from macOS Keychain (CC-k8t7 migration).
# Age key is read from macOS Keychain — no manual env setup needed locally.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

SOPS_AGE_KEY=$(security find-generic-password -a "$USER" -s "age-world-wide-webb-private-key" -w)
export SOPS_AGE_KEY

extract() { sops -d secrets/vault.yaml | grep "^$1:" | cut -d' ' -f2-; }

printf 'HA_TOKEN=%s\n'           "$(extract HOME_ASSISTANT_TOKEN__CREDENTIAL)"
printf 'UNIFI_API_KEY=%s\n'      "$(extract UNIFI__LOCAL_API_KEY)"
printf 'WIFI_SSID=%s\n'          "$(extract WIFI_GUEST_CREDENTIALS__SSID)"
printf 'WIFI_PASSWORD=%s\n'      "$(extract WIFI_GUEST_CREDENTIALS__PASSWORD)"
printf 'HOME_LAT=%s\n'           "$(extract HOME_LOCATION__LAT)"
printf 'HOME_LON=%s\n'           "$(extract HOME_LOCATION__LON)"
printf 'HOME_PLACE_NAME=%s\n'    "$(extract HOME_LOCATION__PLACE_NAME)"
printf 'HOME_RADIUS_MILES=%s\n'  "$(extract HOME_LOCATION__RADIUS_MILES)"
