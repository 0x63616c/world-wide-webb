#!/usr/bin/env bash
# Provision the bosun deploy-webhook bearer token.
#
# The token authenticates CI's POST to https://hooks.worldwidewebb.co/deploy/
# control-center against the bosun-agent receiver. 1Password is the source of
# truth; this script (re)materializes it into BOTH consumers so they never drift:
#   - the GitHub Actions secret BOSUN_WEBHOOK_TOKEN (the caller)
#   - the docker secret, synced by `bosun secrets sync` from the op ref (the receiver)
#
# Idempotent: reuses the existing 1Password value on re-run, generates one only
# on first provision. Safe to run anytime to re-sync the GH secret.
set -euo pipefail

ITEM="Bosun Webhook Token"
VAULT="Homelab"
REF="op://$VAULT/$ITEM/credential"

if op item get "$ITEM" --vault "$VAULT" >/dev/null 2>&1; then
  echo "Existing '$ITEM' found — reusing its value."
  # Read real op directly (bypass any stale shim cache) so GH gets the true value.
  VAL=$(op item get "$ITEM" --vault "$VAULT" --fields credential --reveal)
else
  echo "Generating a new webhook token."
  VAL=$(openssl rand -hex 32)
  op item create --vault "$VAULT" --category "API Credential" --title "$ITEM" \
    "credential[password]=$VAL" >/dev/null
fi
[ -n "$VAL" ] || { echo "FATAL: empty token" >&2; exit 1; }

# Invalidate the shim cache for this ref (REQUIRED — the local op is a 24h-caching
# shim; bosun secrets sync would otherwise resolve a stale value).
EVEE_OP_DIR="${OP_CACHE_DIR:-$HOME/.local/share/evee-op}"
if [ -d "$EVEE_OP_DIR" ]; then
  KEY_HASH=$(printf '%s' "$REF" | shasum -a 256 | cut -d' ' -f1)
  rm -f "$EVEE_OP_DIR/$KEY_HASH"
fi

echo "Setting GitHub Actions secret BOSUN_WEBHOOK_TOKEN..."
printf '%s' "$VAL" | gh secret set BOSUN_WEBHOOK_TOKEN

echo "Verifying op read..."
op read "$REF" >/dev/null && echo "  op ok"
echo "Done. GH secret + 1Password are in sync; run 'bosun secrets sync' to push the docker secret."
