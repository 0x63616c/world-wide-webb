#!/usr/bin/env bash
# Write a secret into secrets/vault.yaml via sops --set.
# Usage: scripts/set-secret.sh VAULT_KEY
# Reads the value from stdin (or prompts if stdin is a tty). Re-encrypts in-memory.
# SOPS+age based. Age key from macOS Keychain (CC-k8t7 migration).
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 VAULT_KEY" >&2
  exit 1
fi

KEY="$1"
VAULT="$(cd "$(dirname "$0")/.." && pwd)/secrets/vault.yaml"

if [ ! -f "$VAULT" ]; then
  echo "Error: vault not found at $VAULT" >&2
  exit 1
fi

if [ -t 0 ]; then
  # Interactive: prompt without echoing
  read -rsp "Value for $KEY: " VALUE
  echo >&2
else
  # Piped: read from stdin
  read -r VALUE
fi

if [ -z "$VALUE" ]; then
  echo "Error: value must not be empty" >&2
  exit 1
fi

SOPS_AGE_KEY=$(security find-generic-password -a "$USER" -s "age-world-wide-webb-private-key" -w)
export SOPS_AGE_KEY

sops --set "[\"$KEY\"] \"$VALUE\"" "$VAULT"
echo "$KEY updated in vault" >&2
