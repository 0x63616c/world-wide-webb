#!/usr/bin/env bash
# Stores the TYE Postgres password in the SOPS vault.
# Run ONCE before the first prod deploy of TYE. The password you enter here
# must match the one used to initialise the CNPG text-your-ex cluster.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Storing the TYE Postgres password in the vault."
echo "It must match the password used to init the CNPG 'text-your-ex' cluster."
echo ""
read -rsp "Enter the TYE Postgres password: " VAL; echo
[ -n "$VAL" ] || { echo "FATAL: empty password" >&2; exit 1; }

echo "$VAL" | "$REPO_ROOT/scripts/set-secret.sh" TEXT_YOUR_EX_POSTGRES__PASSWORD

echo "Done. Vault key: TEXT_YOUR_EX_POSTGRES__PASSWORD"
echo ""
echo "Next steps:"
echo "  1. Push to main to trigger CI deploy. Pulumi injects the password into"
echo "     cc-secrets-tye-api which tye-api mounts at /run/secrets/POSTGRES_PASSWORD."
echo "  2. Check: kubectl -n control-center get secret cc-secrets-tye-api"
