#!/usr/bin/env bash
# BLOCKING: rejects any staged secrets/*.yaml that is not SOPS-encrypted.
# A valid SOPS file always contains a `sops:` metadata block.
# Prevents accidentally committing plaintext secrets.

set -euo pipefail

failed=0

for f in "$@"; do
  case "$f" in
    secrets/*.yaml)
      if ! grep -q "^sops:" "$f" 2>/dev/null; then
        echo "UNENCRYPTED SECRET: $f" >&2
        echo "  Run: sops --encrypt --in-place $f" >&2
        failed=1
      fi
      ;;
  esac
done

exit $failed
