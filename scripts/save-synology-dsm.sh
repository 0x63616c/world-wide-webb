#!/usr/bin/env bash
set -euo pipefail

# Saves the Synology DSM login (HomeTB / DS420+) to 1Password (Homelab vault) so
# agents can SSH in + drive Container Manager / Log Center for the UniFi log
# pipeline , keeping the NAS credentials OUT of this (public) repo. (www-dhi9)
#
# The account MUST be in the Synology "administrators" group: DSM only allows
# SSH for admins, and Container Manager (docker) needs sudo. Default user: unifi.
#
# Run as calum (NOT sudo , it writes 1Password as you):
#   ./scripts/save-synology-dsm.sh

ITEM="Synology DSM"
VAULT="Homelab"
BASE="op://$VAULT/$ITEM"

DEFAULT_USER="unifi"
DEFAULT_HOST="192.168.0.218"

echo "== Synology DSM login (HomeTB) -> 1Password ($VAULT/$ITEM) =="
echo

read -rp "DSM admin username (default: $DEFAULT_USER): " USERNAME
USERNAME="${USERNAME:-$DEFAULT_USER}"

read -rp "NAS LAN IP (default: $DEFAULT_HOST): " HOST
HOST="${HOST:-$DEFAULT_HOST}"

read -rsp "DSM password for '$USERNAME': " PASSWORD; echo
[ -n "$PASSWORD" ] || { echo "FATAL: empty password" >&2; exit 1; }

URL="http://$HOST:5000"

FIELDS=(
  "username[text]=$USERNAME"
  "password[password]=$PASSWORD"
  "host[text]=$HOST"
  "url[url]=$URL"
)

if op item get "$ITEM" --vault "$VAULT" >/dev/null 2>&1; then
  op item edit "$ITEM" --vault "$VAULT" "${FIELDS[@]}" >/dev/null
  echo "Updated existing item."
else
  op item create --vault "$VAULT" --category "Login" --title "$ITEM" "${FIELDS[@]}" >/dev/null
  echo "Created item."
fi

# --- invalidate the op-shim cache for each ref (REQUIRED on write) -----------
EVEE_OP_DIR="${OP_CACHE_DIR:-$HOME/.local/share/evee-op}"
if [ -d "$EVEE_OP_DIR" ]; then
  for f in username password host url; do
    REF="$BASE/$f"
    KEY_HASH=$(printf '%s' "$REF" | shasum -a 256 | cut -d' ' -f1)
    rm -f "$EVEE_OP_DIR/$KEY_HASH"
  done
fi

# --- verify -----------------------------------------------------------------
echo "Verifying..."
op read "$BASE/username" >/dev/null && op read "$BASE/password" >/dev/null && echo "  ok ($USERNAME @ $HOST)"
