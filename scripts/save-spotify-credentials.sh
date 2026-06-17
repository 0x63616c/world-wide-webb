#!/usr/bin/env bash
# Saves Spotify Web API credentials to the SOPS vault so the control-center
# api/worker can drive playback via the Spotify Web API. Stores three fields:
# client_id, client_secret, refresh_token.
#
# The refresh_token is minted here via a one-time OAuth Authorization Code flow
# (scripts/spotify-oauth.ts): the script opens the Spotify consent page in your
# browser, you approve, and it captures a long-lived refresh token. Run once;
# safe to re-run to rotate. Requires a Spotify PREMIUM account (Web API playback
# control is Premium-only) and a Spotify Developer App (see Step 1 below).
set -euo pipefail

REDIRECT_URI="${SPOTIFY_REDIRECT_URI:-http://127.0.0.1:8888/callback}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
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

echo "$CLIENT_ID"     | "$REPO_ROOT/scripts/set-secret.sh" SPOTIFY__CLIENT_ID
echo "$CLIENT_SECRET" | "$REPO_ROOT/scripts/set-secret.sh" SPOTIFY__CLIENT_SECRET
echo "$REFRESH_TOKEN" | "$REPO_ROOT/scripts/set-secret.sh" SPOTIFY__REFRESH_TOKEN

echo ""
echo "Done. Vault keys: SPOTIFY__CLIENT_ID, SPOTIFY__CLIENT_SECRET, SPOTIFY__REFRESH_TOKEN"
