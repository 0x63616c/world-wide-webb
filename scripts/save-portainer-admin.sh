#!/usr/bin/env bash
# Stores the Portainer admin password in 1Password (Homelab vault).
# Run after Portainer starts for the first time; re-run to rotate.
#
# After saving, set the password in Portainer itself:
#   curl -sS -X POST https://portainer.worldwidewebb.co/api/users/admin/init \
#     -H 'Content-Type: application/json' \
#     -d "{\"username\":\"admin\",\"password\":\"$(op read op://Homelab/'Portainer Admin'/password)\"}"
set -euo pipefail

ITEM="Portainer Admin"
VAULT="Homelab"
REF="op://$VAULT/$ITEM/password"

echo "Setting Portainer admin credentials in 1Password..."
echo ""
echo "Step 1. Choose a strong password for the Portainer admin account."
echo "        (Or press Enter to generate one automatically.)"
read -rsp "Paste password (or Enter to generate): " OVERRIDE; echo

if [ -z "$OVERRIDE" ]; then
  VAL=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)
  echo "(Generated a 32-character random password.)"
else
  VAL="$OVERRIDE"
fi

[ -n "$VAL" ] || { echo "FATAL: empty password" >&2; exit 1; }

if op item get "$ITEM" --vault "$VAULT" >/dev/null 2>&1; then
  op item edit "$ITEM" --vault "$VAULT" \
    "username[text]=admin" \
    "password[password]=$VAL" \
    >/dev/null
  echo "Updated existing 1Password item: $ITEM"
else
  op item create \
    --vault "$VAULT" \
    --category "Login" \
    --title "$ITEM" \
    --url "https://portainer.worldwidewebb.co" \
    "username[text]=admin" \
    "password[password]=$VAL" \
    >/dev/null
  echo "Created 1Password item: $ITEM"
fi

# Invalidate the shim cache so immediate reads return the new value.
EVEE_OP_DIR="${OP_CACHE_DIR:-$HOME/.local/share/evee-op}"
if [ -d "$EVEE_OP_DIR" ]; then
  KEY_HASH=$(printf '%s' "$REF" | shasum -a 256 | cut -d' ' -f1)
  rm -f "$EVEE_OP_DIR/$KEY_HASH"
  echo "Cache invalidated."
fi

echo "Verifying..."
op read "$REF" >/dev/null && echo "  ok , $REF is readable"
echo ""
echo "Done. Reference: $REF"
echo ""
echo "To activate the admin account on a fresh Portainer instance:"
echo "  curl -sS -X POST https://portainer.worldwidewebb.co/api/users/admin/init \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d \"{\\\"username\\\":\\\"admin\\\",\\\"password\\\":\\\"\\$(op read '$REF')\\\"}\" "
