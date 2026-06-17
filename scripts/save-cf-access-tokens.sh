#!/usr/bin/env bash
# Create the two Cloudflare Access SERVICE TOKENS (www-cuuw) and store them in
# the SOPS vault. Run ONCE, by a human. The CF API returns the client_secret
# exactly once at creation, so this deliberate, idempotent step is the only
# place that ever sees it.
#
#   bosun-kiosk -> vault keys: CF_ACCESS_KIOSK__CLIENT_ID, CF_ACCESS_KIOSK__CLIENT_SECRET
#   bosun-ci    -> vault keys: CF_ACCESS_CI__CLIENT_ID,    CF_ACCESS_CI__CLIENT_SECRET
#
# Prerequisites (human, blocking):
#   - Cloudflare Zero Trust enabled on the account (one-time dashboard step).
#   - The CF API token must have Access: Service Tokens EDIT scope (to POST tokens).
#     The deploy-time token only needs READ; granting Edit here is fine, or use a
#     short-lived Edit token just for this run.
#
# Idempotent on the vault side; re-running a vault write is always safe.
# To rotate a service token: delete it in CF Zero Trust, then re-run.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Read CF creds from the vault (non-interactively, already stored).
_VAULT="$REPO_ROOT/secrets/vault.yaml"
SOPS_AGE_KEY=$(security find-generic-password -a "$USER" -s "age-world-wide-webb-private-key" -w)
export SOPS_AGE_KEY
_x() { sops -d "$_VAULT" | grep "^$1:" | cut -d' ' -f2-; }

ACCOUNT_ID="$(_x CLOUDFLARE_API__ACCOUNT_ID)"
CF_TOKEN="$(_x CLOUDFLARE_API__CREDENTIAL)"
[ -n "$ACCOUNT_ID" ] || { echo "FATAL: empty CLOUDFLARE_API__ACCOUNT_ID in vault" >&2; exit 1; }
[ -n "$CF_TOKEN" ] || { echo "FATAL: empty CLOUDFLARE_API__CREDENTIAL in vault" >&2; exit 1; }

API="https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/service_tokens"

# Create one CF service token (named $1) and store id+secret into the vault ($2, $3).
create_token() {
  local token_name="$1" id_key="$2" secret_key="$3"

  echo "  Creating Cloudflare service token '$token_name' ..."
  local resp
  resp="$(curl -fsS -X POST "$API" \
    -H "Authorization: Bearer $CF_TOKEN" \
    -H "Content-Type: application/json" \
    --data "{\"name\":\"$token_name\"}")"

  local client_id client_secret
  client_id="$(printf '%s' "$resp" | jq -r '.result.client_id // empty')"
  client_secret="$(printf '%s' "$resp" | jq -r '.result.client_secret // empty')"
  if [ -z "$client_id" ] || [ -z "$client_secret" ]; then
    echo "FATAL: CF did not return client_id/client_secret for '$token_name':" >&2
    printf '%s\n' "$resp" | jq -r '.errors // .' >&2
    exit 1
  fi

  echo "  Storing '$id_key' and '$secret_key' in vault..."
  echo "$client_id"     | "$REPO_ROOT/scripts/set-secret.sh" "$id_key"
  echo "$client_secret" | "$REPO_ROOT/scripts/set-secret.sh" "$secret_key"
}

echo "Cloudflare Access service tokens (www-cuuw)"
echo "Account: $ACCOUNT_ID"
echo

echo "1/2 kiosk token:"
create_token "bosun-kiosk" "CF_ACCESS_KIOSK__CLIENT_ID" "CF_ACCESS_KIOSK__CLIENT_SECRET"
echo

echo "2/2 CI token:"
create_token "bosun-ci" "CF_ACCESS_CI__CLIENT_ID" "CF_ACCESS_CI__CLIENT_SECRET"

echo
echo "Done. Vault keys:"
echo "  CF_ACCESS_KIOSK__CLIENT_ID, CF_ACCESS_KIOSK__CLIENT_SECRET"
echo "  CF_ACCESS_CI__CLIENT_ID,    CF_ACCESS_CI__CLIENT_SECRET"
echo
echo "Next (gated cutover, see docs/deployment-design.md):"
echo "  - add the CF_ACCESS_*_CLIENT_ID env vars to the kiosk Access app headers in ci.yml"
echo "  - add access:/accessFloor() declarations per the rollout order"
