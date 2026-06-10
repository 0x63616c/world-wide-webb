#!/usr/bin/env bash
# Create the two Cloudflare Access SERVICE TOKENS (www-cuuw) and store them in
# 1Password (Homelab). Run ONCE, by a human. bosun's reconcileAccess only
# REFERENCES these tokens (resolves name -> CF id); it never creates them, and
# the client_secret is returned by the CF API exactly once at creation — so this
# deliberate, idempotent human step is the only place that ever sees it.
#
#   bosun-kiosk -> "CF Access Kiosk Token"  (iPad wall panel, unattended)
#   bosun-ci    -> "CF Access CI Token"     (GitHub Actions deploy webhook caller)
#
# Each 1Password item gets two fields: client_id (non-secret) + client_secret.
# deploy.config.ts references *_CLIENT_ID via fromOp at the gated cutover, and
# ios-build.yml / ci.yml read the client_id+secret as repo secrets.
#
# Prerequisites (human, blocking):
#   - Cloudflare Zero Trust enabled on the account (one-time dashboard step).
#   - The CF API token in "Cloudflare API"/credential must have
#     Access: Service Tokens — EDIT scope (to POST the tokens). The deploy-time
#     token only needs Service Tokens READ; granting Edit here is fine, or use a
#     short-lived Edit token just for this run.
#
# Idempotent: a token whose 1Password item already exists is left untouched
# (re-creating it in CF would orphan the live one and rotate the secret). To
# rotate, delete the 1Password item AND the CF service token first, then re-run.
set -euo pipefail

VAULT="Homelab"
CF_API_ITEM="Cloudflare API"

# Resolve the CF account id + management token from the existing item.
ACCOUNT_ID="$(op read "op://$VAULT/$CF_API_ITEM/account_id")"
CF_TOKEN="$(op read "op://$VAULT/$CF_API_ITEM/credential")"
[ -n "$ACCOUNT_ID" ] || { echo "FATAL: empty CF account_id" >&2; exit 1; }
[ -n "$CF_TOKEN" ] || { echo "FATAL: empty CF API token" >&2; exit 1; }

API="https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/service_tokens"

# Bust the shim cache for one op:// ref (REQUIRED — the local op shim caches
# reads for 24h; without this a later `op read` returns a stale/absent value).
bust_cache() {
  local ref="$1"
  local dir="${OP_CACHE_DIR:-$HOME/.local/share/evee-op}"
  if [ -d "$dir" ]; then
    local hash
    hash="$(printf '%s' "$ref" | shasum -a 256 | cut -d' ' -f1)"
    rm -f "$dir/$hash"
  fi
}

# Create one CF service token (named $1) and store id+secret into 1Password item $2.
# Skips entirely if the item already exists (idempotent — see header).
create_token() {
  local token_name="$1" item="$2"
  local id_ref="op://$VAULT/$item/client_id"
  local secret_ref="op://$VAULT/$item/client_secret"

  if op item get "$item" --vault "$VAULT" >/dev/null 2>&1; then
    echo "  '$item' already exists in 1Password — skipping (delete it + the CF token to rotate)."
    return 0
  fi

  echo "  Creating Cloudflare service token '$token_name' ..."
  local resp
  resp="$(curl -fsS -X POST "$API" \
    -H "Authorization: Bearer $CF_TOKEN" \
    -H "Content-Type: application/json" \
    --data "{\"name\":\"$token_name\"}")"

  # The CF response carries result.client_id + result.client_secret (secret is
  # returned ONCE, here, and never again).
  local client_id client_secret
  client_id="$(printf '%s' "$resp" | jq -r '.result.client_id // empty')"
  client_secret="$(printf '%s' "$resp" | jq -r '.result.client_secret // empty')"
  if [ -z "$client_id" ] || [ -z "$client_secret" ]; then
    echo "FATAL: CF did not return client_id/client_secret for '$token_name':" >&2
    printf '%s\n' "$resp" | jq -r '.errors // .' >&2
    exit 1
  fi

  echo "  Writing '$item' to 1Password ..."
  op item create --vault "$VAULT" --category "API Credential" --title "$item" \
    "client_id[text]=$client_id" \
    "client_secret[password]=$client_secret" >/dev/null

  bust_cache "$id_ref"
  bust_cache "$secret_ref"

  echo "  Verifying op reads ..."
  op read "$id_ref" >/dev/null && echo "    ok: $id_ref"
  op read "$secret_ref" >/dev/null && echo "    ok: $secret_ref"
}

echo "Cloudflare Access service tokens (www-cuuw)"
echo "Account: $ACCOUNT_ID"
echo

echo "1/2 kiosk token:"
create_token "bosun-kiosk" "CF Access Kiosk Token"
echo
echo "2/2 CI token:"
create_token "bosun-ci" "CF Access CI Token"

echo
echo "Done. Next (gated cutover, see docs/deployment-design.md):"
echo "  - add the two CF_ACCESS_*_CLIENT_ID fromOp lines to bosun-agent in deploy.config.ts"
echo "  - add the kiosk client_id+secret as repo secrets for ios-build.yml"
echo "  - add the CI client_id+secret as repo secrets and the curl -H flags in ci.yml"
echo "  - add access:/accessFloor() declarations per the rollout order"
