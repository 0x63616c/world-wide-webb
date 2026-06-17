#!/usr/bin/env bash
# Stores a GitHub PAT (packages:read scope) in the SOPS vault for GHCR image pulls.
# The token is used by Pulumi to create a docker pull-secret so the k8s cluster
# can pull private images from ghcr.io/0x63616c/*.
#
# How to create the PAT:
#   GitHub -> Settings -> Developer settings -> Personal access tokens (classic)
#   -> Generate new token -> scope: read:packages -> no expiry (or set a long one)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Storing a GitHub PAT (read:packages) in the vault for GHCR image pulls."
echo ""
echo "Step 1. Create a classic PAT at:"
echo "        https://github.com/settings/tokens/new?scopes=read:packages"
echo "        Scope required: read:packages"
echo ""
read -rsp "Paste the token: " VAL; echo
[ -n "$VAL" ] || { echo "FATAL: empty token" >&2; exit 1; }

# Sanity check: GitHub classic PATs start with ghp_
if [[ "$VAL" != ghp_* ]]; then
  echo "WARNING: token does not start with 'ghp_' , is this a classic PAT?" >&2
fi

echo "$VAL" | "$REPO_ROOT/scripts/set-secret.sh" GITHUB_PERSONAL_ACCESS_TOKEN__TOKEN

echo ""
echo "Done. Vault key: GITHUB_PERSONAL_ACCESS_TOKEN__TOKEN"
