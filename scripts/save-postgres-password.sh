#!/usr/bin/env bash
# Generates a strong Postgres password and stores it in the SOPS vault.
# Run once before the first deploy; safe to re-run to rotate the password.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Generating a new Postgres password for control-center..."
echo "(This will overwrite any existing value in the vault.)"
echo ""

# Generate a 32-character random password, no shell-special chars so it's
# safe to pass directly in postgres DSN strings.
GENERATED=$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)

echo "Generated: (hidden)"
read -rsp "Press Enter to use the generated password, or paste your own: " OVERRIDE; echo
VAL="${OVERRIDE:-$GENERATED}"
[ -n "$VAL" ] || { echo "FATAL: empty password" >&2; exit 1; }

echo "$VAL" | "$REPO_ROOT/scripts/set-secret.sh" CONTROL_CENTER_POSTGRES__PASSWORD

echo "Done. Vault key: CONTROL_CENTER_POSTGRES__PASSWORD"
