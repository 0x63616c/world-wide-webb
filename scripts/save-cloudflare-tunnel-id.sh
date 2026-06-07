#!/usr/bin/env bash
# Add the Cloudflare tunnel id to the "Cloudflare API" 1Password item.
#
# bosun's routes/DNS reconcile (CC-vqyv) needs three NON-secret Cloudflare
# identifiers on the bosun-agent: the account id, the zone id, and the TUNNEL id.
# The account_id + zone_id already live on the "Cloudflare API" item; the tunnel
# id was the one missing field (DNS CNAMEs point at <tunnelId>.cfargotunnel.com).
# All three are sourced via fromOp() in deploy.config.ts and exported to env by
# the agent entrypoint — same pattern as the other agent secrets.
#
# Idempotent: re-running just re-sets the field. Default is the prod
# evee-webhooks tunnel; pass a different id as $1 to override.
set -euo pipefail

ITEM="Cloudflare API"
VAULT="Homelab"
REF="op://$VAULT/$ITEM/tunnel_id"

# Prod tunnel: evee-webhooks. The dashboard/storybook/hooks/drizzle CNAMEs all
# point at <this>.cfargotunnel.com today.
DEFAULT_TUNNEL_ID="633999e9-ec81-478b-b8af-2213778b9441"
TUNNEL_ID="${1:-$DEFAULT_TUNNEL_ID}"

op item get "$ITEM" --vault "$VAULT" >/dev/null 2>&1 || {
  echo "FATAL: item '$ITEM' not found in vault '$VAULT'." >&2
  echo "       The CF API token/account_id/zone_id must already exist on it." >&2
  exit 1
}

echo "Setting $ITEM.tunnel_id = $TUNNEL_ID ..."
op item edit "$ITEM" --vault "$VAULT" "tunnel_id[text]=$TUNNEL_ID" >/dev/null

# Invalidate the shim cache for this ref (REQUIRED — the local op is a 24h-caching
# shim; bosun secrets sync would otherwise resolve a stale/absent value).
EVEE_OP_DIR="${OP_CACHE_DIR:-$HOME/.local/share/evee-op}"
if [ -d "$EVEE_OP_DIR" ]; then
  KEY_HASH=$(printf '%s' "$REF" | shasum -a 256 | cut -d' ' -f1)
  rm -f "$EVEE_OP_DIR/$KEY_HASH"
fi

echo "Verifying op read..."
op read "$REF" >/dev/null && echo "  ok: $REF"
echo "Done. bosun secrets sync will now resolve CF_TUNNEL_ID for the agent."
