#!/usr/bin/env bash
# Run a command with all secrets injected as env vars.
# Usage: scripts/secrets.sh <command...>
# Example: scripts/secrets.sh bun run dev
#          scripts/secrets.sh pulumi up --stack prod
#
# Secrets are decrypted in-memory only — never written to disk or stdout.
set -euo pipefail

if [ $# -eq 0 ]; then
  echo "Usage: scripts/secrets.sh <command...>" >&2
  exit 1
fi

SOPS_AGE_KEY=$(security find-generic-password -a "$USER" -s "age-world-wide-webb-private-key" -w) \
  sops exec-env "$(dirname "$0")/../secrets/vault.yaml" "$*"
