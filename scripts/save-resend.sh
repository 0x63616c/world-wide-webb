#!/usr/bin/env bash
# Stores the Resend API key in the SOPS vault.
# The from-address is stored alongside so the app reads it from env instead
# of hardcoding it. Safe to re-run to rotate the key or change the from address.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Saving Resend credentials to vault..."
echo ""

echo "Step 1. Get an API key at https://resend.com/api-keys (Create API Key)."
read -rsp "Paste your Resend API key (re_...): " API_KEY; echo
[ -n "$API_KEY" ] || { echo "FATAL: empty key" >&2; exit 1; }

echo ""
echo "Step 2. From address, must use a domain verified at https://resend.com/domains"
echo "(or onboarding@resend.dev for testing, which only delivers to your own account email)."
read -rp "From address (e.g. panel@worldwidewebb.co): " FROM_ADDR
[ -n "$FROM_ADDR" ] || { echo "FATAL: empty from address" >&2; exit 1; }

echo "$API_KEY"   | "$REPO_ROOT/scripts/set-secret.sh" RESEND__API_KEY
echo "$FROM_ADDR" | "$REPO_ROOT/scripts/set-secret.sh" RESEND__FROM_ADDRESS

echo "Done. Vault keys: RESEND__API_KEY, RESEND__FROM_ADDRESS"
