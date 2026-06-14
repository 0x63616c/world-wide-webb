#!/usr/bin/env bash
# Saves Spotify Web API credentials to 1Password (Homelab vault, item "Spotify")
# so the control-center api/worker can drive playback via the Spotify Web API at
# deploy time (deploy.config.ts fromOp) and in local dev. Stores three concealed
# fields: client_id, client_secret, refresh_token.
#
# The refresh_token is minted here via a one-time OAuth Authorization Code flow
# (scripts/spotify-oauth.ts): the script opens the Spotify consent page in your
# browser, you approve, and it captures a long-lived refresh token. Run once;
# safe to re-run to rotate. Requires a Spotify PREMIUM account (Web API playback
# control is Premium-only) and a Spotify Developer App (see Step 1 below).
set -euo pipefail

ITEM="Spotify"
VAULT="Homelab"
REDIRECT_URI="${SPOTIFY_REDIRECT_URI:-http://127.0.0.1:8888/callback}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cat <<EOF
Spotify credentials setup
=========================

Step 1 (do this first, in your browser):
  1. Open https://developer.spotify.com/dashboard and log in.
  2. Click "Create app". Name/description: anything (e.g. "Control Center").
  3. Set the Redirect URI EXACTLY to:
       $REDIRECT_URI
  4. Tick the "Web API" checkbox, agree to terms, Save.
  5. Open the app -> Settings. Copy the Client ID and (Show) Client Secret.

When you have those two values, continue below.

EOF

read -rp "Paste Client ID: " CLIENT_ID
read -rsp "Paste Client Secret: " CLIENT_SECRET; echo
[ -n "$CLIENT_ID" ] || { echo "FATAL: empty Client ID" >&2; exit 1; }
[ -n "$CLIENT_SECRET" ] || { echo "FATAL: empty Client Secret" >&2; exit 1; }

echo ""
echo "Step 2: authorizing with Spotify (a browser tab will open)..."
echo ""

# Run the OAuth flow. stdout carries the PRODUCT= and REFRESH_TOKEN= lines;
# the human-facing prompts go to stderr (inherited to the terminal).
OAUTH_OUT="$(
  SPOTIFY_CLIENT_ID="$CLIENT_ID" \
  SPOTIFY_CLIENT_SECRET="$CLIENT_SECRET" \
  SPOTIFY_REDIRECT_URI="$REDIRECT_URI" \
  bun "$SCRIPT_DIR/spotify-oauth.ts"
)"

REFRESH_TOKEN="$(printf '%s\n' "$OAUTH_OUT" | sed -n 's/^REFRESH_TOKEN=//p')"
PRODUCT="$(printf '%s\n' "$OAUTH_OUT" | sed -n 's/^PRODUCT=//p')"

[ -n "$REFRESH_TOKEN" ] || { echo "FATAL: no refresh token captured" >&2; exit 1; }

if [ "$PRODUCT" != "premium" ]; then
  echo ""
  echo "WARNING: this Spotify account product is '$PRODUCT', not 'premium'."
  echo "Web API playback control requires Premium; saving anyway, but playback"
  echo "commands will 403 until the account is Premium."
  echo ""
fi

if op item get "$ITEM" --vault "$VAULT" >/dev/null 2>&1; then
  op item edit "$ITEM" --vault "$VAULT" \
    "client_id[password]=$CLIENT_ID" \
    "client_secret[password]=$CLIENT_SECRET" \
    "refresh_token[password]=$REFRESH_TOKEN" >/dev/null
  echo "Updated existing 1Password item: $ITEM"
else
  op item create \
    --vault "$VAULT" \
    --category "API Credential" \
    --title "$ITEM" \
    "client_id[password]=$CLIENT_ID" \
    "client_secret[password]=$CLIENT_SECRET" \
    "refresh_token[password]=$REFRESH_TOKEN" >/dev/null
  echo "Created 1Password item: $ITEM"
fi

# Invalidate the op shim cache for each ref so the next read is fresh.
EVEE_OP_DIR="${OP_CACHE_DIR:-$HOME/.local/share/evee-op}"
if [ -d "$EVEE_OP_DIR" ]; then
  for field in client_id client_secret refresh_token; do
    REF="op://$VAULT/$ITEM/$field"
    KEY_HASH=$(printf '%s' "$REF" | shasum -a 256 | cut -d' ' -f1)
    rm -f "$EVEE_OP_DIR/$KEY_HASH"
  done
  echo "Cache invalidated."
fi

echo "Verifying..."
for field in client_id client_secret refresh_token; do
  REF="op://$VAULT/$ITEM/$field"
  op read "$REF" >/dev/null && echo "  ok , $REF"
done
echo ""
echo "Done. Spotify creds are in 1Password ($VAULT/$ITEM)."
echo "I can now wire SPOTIFY_CLIENT_ID/SECRET/REFRESH_TOKEN into deploy.config.ts"
echo "and build the integration end-to-end."
