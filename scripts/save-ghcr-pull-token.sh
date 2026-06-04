#!/usr/bin/env bash
# Stores a GitHub PAT (packages:read scope) in 1Password for GHCR image pulls.
# The token is used by bosun/bootstrap to create a docker secret on the homelab
# so the swarm can pull private images from ghcr.io/0x63616c/*.
#
# How to create the PAT:
#   GitHub → Settings → Developer settings → Personal access tokens (classic)
#   → Generate new token → scope: read:packages → no expiry (or set a long one)
set -euo pipefail

ITEM="GHCR Pull Token"
VAULT="Homelab"
REF="op://$VAULT/$ITEM/credential"

echo "Storing a GitHub PAT (read:packages) in 1Password for GHCR image pulls."
echo ""
echo "Step 1. Create a classic PAT at:"
echo "        https://github.com/settings/tokens/new?scopes=read:packages"
echo "        Scope required: read:packages"
echo ""
read -rsp "Paste the token: " VAL; echo
[ -n "$VAL" ] || { echo "FATAL: empty token" >&2; exit 1; }

# Sanity check: GitHub classic PATs start with ghp_
if [[ "$VAL" != ghp_* ]]; then
  echo "WARNING: token does not start with 'ghp_' — is this a classic PAT?" >&2
fi

if op item get "$ITEM" --vault "$VAULT" >/dev/null 2>&1; then
  op item edit "$ITEM" --vault "$VAULT" \
    "credential[password]=$VAL" \
    >/dev/null
  echo "Updated existing 1Password item: $ITEM"
else
  op item create \
    --vault "$VAULT" \
    --category "API Credential" \
    --title "$ITEM" \
    "credential[password]=$VAL" \
    "username[text]=0x63616c" \
    "notes[text]=read:packages scope — used by homelab swarm to pull ghcr.io/0x63616c/* images" \
    >/dev/null
  echo "Created 1Password item: $ITEM"
fi

# Invalidate the shim cache so the next op read returns the new token.
EVEE_OP_DIR="${OP_CACHE_DIR:-$HOME/.local/share/evee-op}"
if [ -d "$EVEE_OP_DIR" ]; then
  KEY_HASH=$(printf '%s' "$REF" | shasum -a 256 | cut -d' ' -f1)
  rm -f "$EVEE_OP_DIR/$KEY_HASH"
  echo "Cache invalidated."
fi

echo "Verifying..."
op read "$REF" >/dev/null && echo "  ok — $REF is readable"
echo ""
echo "Done. Reference: $REF"
echo ""
echo "To pre-seed the docker secret on homelab before bootstrap:"
echo "  ssh homelab \"op read '$REF' | docker secret create ghcr_pull_token -\""
