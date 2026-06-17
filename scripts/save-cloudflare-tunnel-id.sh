#!/usr/bin/env bash
# Stores the Cloudflare tunnel id in the SOPS vault.
#
# The deploy (Pulumi) needs the tunnel id to set DNS CNAME targets
# (<tunnelId>.cfargotunnel.com). The value is already committed as the
# CLOUDFLARE_API__TUNNEL_ID vault entry; re-run this to update it if the
# tunnel changes.
#
# Idempotent: re-running just re-sets the vault field.
# Default is the prod tunnel; pass a different id as $1 to override.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

DEFAULT_TUNNEL_ID="633999e9-ec81-478b-b8af-2213778b9441"
TUNNEL_ID="${1:-$DEFAULT_TUNNEL_ID}"

echo "Setting CLOUDFLARE_API__TUNNEL_ID = $TUNNEL_ID ..."
echo "$TUNNEL_ID" | "$REPO_ROOT/scripts/set-secret.sh" CLOUDFLARE_API__TUNNEL_ID

echo "Done. Vault key: CLOUDFLARE_API__TUNNEL_ID"
