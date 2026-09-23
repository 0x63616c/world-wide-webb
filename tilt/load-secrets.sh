#!/usr/bin/env bash
# Decrypts secrets/vault.yaml and emits KEY=VALUE lines for Tilt.
# SOPS+age based. Age key from macOS Keychain (CC-k8t7 migration).
# Age key is read from macOS Keychain — no manual env setup needed locally.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SOPS_AGE_KEY=$(security find-generic-password -a "$USER" -s "age-world-wide-webb-private-key" -w)
export SOPS_AGE_KEY

extract() { sops -d secrets/vault.yaml | grep "^$1:" | cut -d' ' -f2-; }

printf 'HA_TOKEN=%s\n'           "$(extract HOME_ASSISTANT_TOKEN__CREDENTIAL)"
printf 'HOME_LAT=%s\n'           "$(extract HOME_LOCATION__LAT)"
printf 'HOME_LON=%s\n'           "$(extract HOME_LOCATION__LON)"

# Optional: the guest Wi-Fi pair behind the board's Wi-Fi QR tile. Absent from
# the vault until restored, so emit "" rather than fail the whole dev boot.
extract_optional() { sops -d secrets/vault.yaml | { grep "^$1:" || true; } | cut -d' ' -f2-; }
printf 'WIFI_GUEST_SSID=%s\n'     "$(extract_optional WIFI_GUEST_WIFI_SSID)"
printf 'WIFI_GUEST_PASSWORD=%s\n' "$(extract_optional WIFI_GUEST_WIFI_PASSWORD)"
