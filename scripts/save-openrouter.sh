#!/usr/bin/env bash
# Stores the OpenRouter API key in the SOPS vault.
# Run once before the first media-worker deploy; safe to re-run to rotate the key.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Saving OpenRouter API key to vault..."
echo "(This will overwrite any existing value.)"
echo ""

read -rsp "Paste your OpenRouter API key (sk-or-...): " API_KEY; echo
[ -n "$API_KEY" ] || { echo "FATAL: empty key" >&2; exit 1; }

echo "$API_KEY" | "$REPO_ROOT/scripts/set-secret.sh" OPENROUTER__API_KEY

echo "Done. Vault key: OPENROUTER__API_KEY"
