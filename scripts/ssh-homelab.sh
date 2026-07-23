#!/usr/bin/env bash
# SSH to the homelab using the dedicated key stored in the SOPS vault —
# WITHOUT 1Password. The private key lives at HOMELAB_SSH__PRIVATE_KEY in
# secrets/vault.yaml, decrypted in-memory via the age key in the macOS keychain
# (same source as scripts/secrets.sh). The 1Password ssh-agent is explicitly
# bypassed (IdentityAgent=none) so ssh never prompts for a 1P unlock.
#
# Usage:
#   scripts/ssh-homelab.sh                 # interactive shell
#   scripts/ssh-homelab.sh 'uptime; hostname'   # run a remote command
#
# Any extra args are passed through to ssh (after the host).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAULT="$ROOT/secrets/vault.yaml"
HOST="${HOMELAB_SSH_HOST:-homelab}"   # resolves HostName/User/Port from ~/.ssh/config

AGE_KEY="$(security find-generic-password -a "$USER" -s "age-world-wide-webb-private-key" -w 2>/dev/null || true)"
if [ -z "$AGE_KEY" ]; then
  echo "error: age key not in keychain (age-world-wide-webb-private-key)" >&2
  exit 1
fi

# Decrypt the private key into a private temp file (0600), cleaned up on exit.
KEYFILE="$(mktemp -t homelab_ssh)"
chmod 600 "$KEYFILE"
cleanup() { rm -f "$KEYFILE"; }
trap cleanup EXIT INT TERM

SOPS_AGE_KEY="$AGE_KEY" sops -d --extract '["HOMELAB_SSH__PRIVATE_KEY"]' "$VAULT" > "$KEYFILE"
if [ ! -s "$KEYFILE" ]; then
  echo "error: HOMELAB_SSH__PRIVATE_KEY missing or empty in $VAULT" >&2
  exit 1
fi

# IdentitiesOnly=yes + IdentityAgent=none => use ONLY this key, never the 1P agent.
exec ssh \
  -i "$KEYFILE" \
  -o IdentitiesOnly=yes \
  -o IdentityAgent=none \
  -o StrictHostKeyChecking=accept-new \
  "$HOST" "$@"
