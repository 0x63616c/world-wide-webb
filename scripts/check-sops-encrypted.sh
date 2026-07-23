#!/usr/bin/env bash
# BLOCKING: rejects any staged secrets/*.yaml that is not a VALID SOPS file.
#
# Two levels of protection:
#   1. Structure  — the file must contain a `sops:` metadata block (catches
#      committing plaintext secrets).
#   2. Integrity  — the file must actually DECRYPT. Editing a SOPS file with a
#      raw editor (e.g. `dd`-ing lines out in nvim) leaves the `sops:` block
#      intact but invalidates the MAC computed over every value, so the whole
#      vault silently stops decrypting. Structure-only checks miss this; the
#      only way to catch it is to attempt a real decrypt. Always edit via
#      `sops secrets/vault.yaml` (opens decrypted, re-encrypts + re-MACs on
#      save) — never a raw editor.
#
# The integrity check needs the age private key. It is read from the macOS
# keychain (same source as scripts/secrets.sh). If the key is not present
# (e.g. a contributor without it), the integrity check is skipped with a
# warning — the structure check still runs.

set -euo pipefail

AGE_KEY="$(security find-generic-password -a "$USER" -s "age-world-wide-webb-private-key" -w 2>/dev/null || true)"

failed=0

for f in "$@"; do
  case "$f" in
    secrets/*.yaml) ;;
    *) continue ;;
  esac

  # Check the STAGED blob (what the commit will contain), not the working tree.
  staged="$(git show ":$f" 2>/dev/null || true)"
  if [ -z "$staged" ]; then
    # Deletion or unreadable stage — nothing to validate.
    continue
  fi

  # 1. Structure: must look like a SOPS file.
  if ! printf '%s\n' "$staged" | grep -q "^sops:"; then
    echo "UNENCRYPTED SECRET: $f" >&2
    echo "  A valid SOPS file contains a 'sops:' metadata block." >&2
    echo "  Edit with: sops $f   (never a raw editor)" >&2
    failed=1
    continue
  fi

  # 2. Integrity: must decrypt (MAC intact).
  if [ -z "$AGE_KEY" ]; then
    echo "WARNING: age key not in keychain — skipping MAC verification for $f" >&2
    echo "  (structure check passed; integrity unverified)" >&2
    continue
  fi

  if ! printf '%s\n' "$staged" \
      | SOPS_AGE_KEY="$AGE_KEY" sops -d --input-type yaml --output-type yaml /dev/stdin >/dev/null 2>/tmp/sops-check-err; then
    echo "CORRUPT SOPS FILE: $f does not decrypt" >&2
    echo "  $(head -1 /tmp/sops-check-err)" >&2
    echo "  A raw editor breaks the MAC over the encrypted values." >&2
    echo "  Recover the last-good version, then edit ONLY via: sops $f" >&2
    failed=1
  fi
done

exit $failed
