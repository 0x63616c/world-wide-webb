#!/usr/bin/env bash
# Stores the guest WiFi credentials in 1Password (Homelab vault) and invalidates
# the op shim cache so the next deploy picks them up.
# The item backs the api/worker WIFI_SSID + WIFI_PASSWORD secrets in
# deploy.config.ts AND is what the captive portal checks guest passwords
# against, so set the password here FIRST, then mirror it in the UniFi console.
# Safe to re-run to rotate the password or rename the SSID.
set -euo pipefail

ITEM="WiFi Guest Credentials"
VAULT="Homelab"
PASSWORD_REF="op://$VAULT/$ITEM/password"
SSID_REF="op://$VAULT/$ITEM/ssid"

echo "Saving guest WiFi credentials to 1Password ($VAULT vault)..."
echo "(This will overwrite any existing values.)"
echo ""

echo "Step 1. SSID — press ENTER to keep the existing one."
read -rp "SSID: " SSID

echo ""
echo "Step 2. The WiFi password you want the guest network to use."
echo "Remember to set the SAME password on the guest WLAN in the UniFi console."
read -rsp "Password: " PASSWORD; echo
[ -n "$PASSWORD" ] || { echo "FATAL: empty password" >&2; exit 1; }
read -rsp "Confirm password: " PASSWORD2; echo
[ "$PASSWORD" = "$PASSWORD2" ] || { echo "FATAL: passwords do not match" >&2; exit 1; }

# The item already exists in the vault (deploy.config.ts depends on it); the
# create branch only covers a fresh vault. The ssid field lives in an unnamed
# section, but a plain label assignment edits it in place (verified: same field
# id before and after, no duplicate top-level field).
EDIT_ARGS=("password[password]=$PASSWORD")
[ -n "$SSID" ] && EDIT_ARGS+=("ssid[concealed]=$SSID")

if op item get "$ITEM" --vault "$VAULT" >/dev/null 2>&1; then
  op item edit "$ITEM" --vault "$VAULT" "${EDIT_ARGS[@]}" >/dev/null
  echo "Updated existing 1Password item: $ITEM"
else
  [ -n "$SSID" ] || { echo "FATAL: item does not exist yet, SSID is required" >&2; exit 1; }
  op item create --vault "$VAULT" --category Login --title "$ITEM" \
    "${EDIT_ARGS[@]}" >/dev/null
  echo "Created 1Password item: $ITEM"
fi

# Invalidate the shim cache so the next read returns the fresh values.
EVEE_OP_DIR="${OP_CACHE_DIR:-$HOME/.local/share/evee-op}"
if [ -d "$EVEE_OP_DIR" ]; then
  for REF in "$PASSWORD_REF" "$SSID_REF"; do
    KEY_HASH=$(printf '%s' "$REF" | shasum -a 256 | cut -d' ' -f1)
    rm -f "$EVEE_OP_DIR/$KEY_HASH"
  done
  echo "Cache invalidated."
fi

echo "Verifying..."
[ "$(op read "$PASSWORD_REF")" = "$PASSWORD" ] && echo "  ok — $PASSWORD_REF matches what you entered"
op read "$SSID_REF" >/dev/null && echo "  ok — $SSID_REF is readable"
echo "Done. References: $PASSWORD_REF , $SSID_REF"
