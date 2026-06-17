#!/usr/bin/env bash
# Stores the Portainer admin password in the SOPS vault.
# Run after Portainer starts for the first time; re-run to rotate.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Setting Portainer admin credentials in the vault..."
echo ""
echo "Step 1. Choose a strong password for the Portainer admin account."
echo "        (Or press Enter to generate one automatically.)"
read -rsp "Paste password (or Enter to generate): " OVERRIDE; echo

if [ -z "$OVERRIDE" ]; then
  VAL=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)
  echo "(Generated a 32-character random password.)"
else
  VAL="$OVERRIDE"
fi

[ -n "$VAL" ] || { echo "FATAL: empty password" >&2; exit 1; }

echo "$VAL" | "$REPO_ROOT/scripts/set-secret.sh" PORTAINER_ADMIN__PASSWORD

echo ""
echo "Done. Vault key: PORTAINER_ADMIN__PASSWORD"
echo ""
echo "To activate the admin account on a fresh Portainer instance:"
echo "  scripts/secrets.sh bash -c 'curl -sS -X POST https://portainer.worldwidewebb.co/api/users/admin/init -H Content-Type:application/json -d \"{\\\"username\\\":\\\"admin\\\",\\\"password\\\":\\\"\\$PORTAINER_ADMIN__PASSWORD\\\"}\"'"
