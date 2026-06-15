#!/usr/bin/env bash
# Creates or updates the 1Password item "text-your-ex Postgres" in the Homelab
# vault. ESO syncs op://Homelab/text-your-ex Postgres/password into the k8s
# Secret cc-secrets-tye-api, which the tye-api Deployment mounts at
# /run/secrets/POSTGRES_PASSWORD. Without this item the ExternalSecret stays
# NotReady and tye-api crashloops.
#
# Run this ONCE before the first prod deploy of TYE. The password you enter here
# must match the one used to initialise the CNPG text-your-ex cluster.
#
# Usage: bash scripts/save-tye-postgres.sh
set -euo pipefail

ITEM="text-your-ex Postgres"
VAULT="Homelab"
REF="op://$VAULT/$ITEM/password"

echo "This script stores the TYE Postgres password in 1Password."
echo "It must match the password used to init the CNPG 'text-your-ex' cluster."
echo ""
read -rsp "Enter the TYE Postgres password: " VAL; echo
[ -n "$VAL" ] || { echo "FATAL: empty password" >&2; exit 1; }

if op item get "$ITEM" --vault "$VAULT" >/dev/null 2>&1; then
  op item edit "$ITEM" --vault "$VAULT" \
    "password[password]=$VAL" \
    >/dev/null
  echo "Updated existing 1Password item: $ITEM"
else
  op item create \
    --vault "$VAULT" \
    --category "Login" \
    --title "$ITEM" \
    "username[text]=postgres" \
    "password[password]=$VAL" \
    "notes[text]=Superuser password for the text-your-ex CNPG Postgres cluster. ESO syncs this into cc-secrets-tye-api (key POSTGRES_PASSWORD), mounted at /run/secrets/POSTGRES_PASSWORD by tye-api." \
    >/dev/null
  echo "Created 1Password item: $ITEM"
fi

# Invalidate the op shim cache so the next read returns the new value.
EVEE_OP_DIR="${OP_CACHE_DIR:-$HOME/.local/share/evee-op}"
if [ -d "$EVEE_OP_DIR" ]; then
  KEY_HASH=$(printf '%s' "$REF" | shasum -a 256 | cut -d' ' -f1)
  rm -f "$EVEE_OP_DIR/$KEY_HASH"
  echo "Cache invalidated."
fi

echo "Verifying..."
op read "$REF" >/dev/null && echo "  ok, $REF is readable"
echo ""
echo "Done. Reference: $REF"
echo ""
echo "Next steps:"
echo "  1. Run 'pulumi up --stack prod' (or push to main to trigger CI deploy)"
echo "     ESO will sync the password into cc-secrets-tye-api within 1h"
echo "     (or immediately on the first ExternalSecret reconcile after deploy)."
echo "  2. Check: kubectl -n control-center get secret cc-secrets-tye-api"
echo "  3. Check: kubectl -n control-center get externalsecret cc-secrets-tye-api"
