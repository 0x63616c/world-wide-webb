#!/usr/bin/env bash
set -euo pipefail

# Saves the Synology DSM login (HomeTB / DS420+) to the SOPS vault so
# agents can SSH in + drive Container Manager / Log Center for the UniFi log
# pipeline, keeping the NAS credentials OUT of this (public) repo. (www-dhi9)
#
# The account MUST be in the Synology "administrators" group: DSM only allows
# SSH for admins, and Container Manager (docker) needs sudo.
#
# Run as calum (NOT sudo):
#   ./scripts/save-synology-dsm.sh

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

DEFAULT_USER="unifi"
DEFAULT_HOST="192.168.0.218"

echo "== Synology DSM login (HomeTB) -> SOPS vault =="
echo

read -rp "DSM admin username (default: $DEFAULT_USER): " USERNAME
USERNAME="${USERNAME:-$DEFAULT_USER}"

read -rp "NAS LAN IP (default: $DEFAULT_HOST): " HOST
HOST="${HOST:-$DEFAULT_HOST}"

read -rsp "DSM password for '$USERNAME': " PASSWORD; echo
[ -n "$PASSWORD" ] || { echo "FATAL: empty password" >&2; exit 1; }

echo "$USERNAME" | "$REPO_ROOT/scripts/set-secret.sh" SYNOLOGY_DSM__USERNAME
echo "$HOST"     | "$REPO_ROOT/scripts/set-secret.sh" SYNOLOGY_DSM__HOST
echo "$PASSWORD" | "$REPO_ROOT/scripts/set-secret.sh" SYNOLOGY_DSM__PASSWORD

echo "Done. Vault keys: SYNOLOGY_DSM__USERNAME, SYNOLOGY_DSM__HOST, SYNOLOGY_DSM__PASSWORD"
