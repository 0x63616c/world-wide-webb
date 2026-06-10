#!/usr/bin/env bash
# Stores the Resend credentials in 1Password (Homelab vault) and invalidates the
# op shim cache so the next deploy picks them up.
# The API key is all Resend needs to send; the from address is stored alongside
# so the app reads its sender identity from op instead of hardcoding it.
# Safe to re-run to rotate the key or change the from address.
set -euo pipefail

ITEM="Resend"
VAULT="Homelab"
KEY_REF="op://$VAULT/$ITEM/credential"
FROM_REF="op://$VAULT/$ITEM/from-address"

echo "Saving Resend credentials to 1Password ($VAULT vault)..."
echo "(This will overwrite any existing values.)"
echo ""

echo "Step 1. Get an API key at https://resend.com/api-keys (Create API Key)."
read -rsp "Paste your Resend API key (re_...): " API_KEY; echo
[ -n "$API_KEY" ] || { echo "FATAL: empty key" >&2; exit 1; }

echo ""
echo "Step 2. From address — must use a domain verified at https://resend.com/domains"
echo "(or onboarding@resend.dev for testing, which only delivers to your own account email)."
read -rp "From address (e.g. panel@worldwidewebb.co): " FROM_ADDR
[ -n "$FROM_ADDR" ] || { echo "FATAL: empty from address" >&2; exit 1; }

if op item get "$ITEM" --vault "$VAULT" >/dev/null 2>&1; then
  op item edit "$ITEM" --vault "$VAULT" \
    "credential[concealed]=$API_KEY" \
    "from-address[text]=$FROM_ADDR" \
    >/dev/null
  echo "Updated existing 1Password item: $ITEM"
else
  op item create \
    --vault "$VAULT" \
    --category "API Credential" \
    --title "$ITEM" \
    "credential[concealed]=$API_KEY" \
    "from-address[text]=$FROM_ADDR" \
    >/dev/null
  echo "Created 1Password item: $ITEM"
fi

# Invalidate the shim cache so the next read returns the fresh values.
EVEE_OP_DIR="${OP_CACHE_DIR:-$HOME/.local/share/evee-op}"
if [ -d "$EVEE_OP_DIR" ]; then
  for REF in "$KEY_REF" "$FROM_REF"; do
    KEY_HASH=$(printf '%s' "$REF" | shasum -a 256 | cut -d' ' -f1)
    rm -f "$EVEE_OP_DIR/$KEY_HASH"
  done
  echo "Cache invalidated."
fi

echo "Verifying..."
op read "$KEY_REF" >/dev/null && echo "  ok — $KEY_REF is readable"
op read "$FROM_REF" >/dev/null && echo "  ok — $FROM_REF is readable"
echo "Done. References: $KEY_REF , $FROM_REF"
