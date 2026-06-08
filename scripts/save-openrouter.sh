#!/usr/bin/env bash
# Stores the OpenRouter API key in 1Password (Homelab vault) and invalidates the
# op shim cache so the next bosun deploy picks it up.
# Run once before the first media-worker deploy; safe to re-run to rotate the key.
set -euo pipefail

ITEM="OpenRouter API Key"
VAULT="Homelab"
REF="op://$VAULT/$ITEM/credential"

echo "Saving OpenRouter API key to 1Password ($VAULT vault)..."
echo "(This will overwrite any existing value.)"
echo ""

read -rsp "Paste your OpenRouter API key (sk-or-...): " API_KEY; echo
[ -n "$API_KEY" ] || { echo "FATAL: empty key" >&2; exit 1; }

if op item get "$ITEM" --vault "$VAULT" >/dev/null 2>&1; then
  op item edit "$ITEM" --vault "$VAULT" "credential[concealed]=$API_KEY" >/dev/null
  echo "Updated existing 1Password item: $ITEM"
else
  op item create \
    --vault "$VAULT" \
    --category "API Credential" \
    --title "$ITEM" \
    "credential[concealed]=$API_KEY" \
    >/dev/null
  echo "Created 1Password item: $ITEM"
fi

# Invalidate the shim cache so the next deploy reads the fresh value.
EVEE_OP_DIR="${OP_CACHE_DIR:-$HOME/.local/share/evee-op}"
if [ -d "$EVEE_OP_DIR" ]; then
  KEY_HASH=$(printf '%s' "$REF" | shasum -a 256 | cut -d' ' -f1)
  rm -f "$EVEE_OP_DIR/$KEY_HASH"
  echo "Cache invalidated."
fi

echo "Verifying..."
op read "$REF" >/dev/null && echo "  ok — $REF is readable"
echo "Done. Reference: $REF"
