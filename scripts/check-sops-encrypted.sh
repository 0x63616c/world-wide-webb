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
# keychain unless SOPS_AGE_KEY supplies the required product/host identities.
# If the key is not present
# (e.g. a contributor without it), the integrity check is skipped with a
# warning — the structure check still runs.

set -euo pipefail

AGE_KEY="${SOPS_AGE_KEY:-}"
if [ -z "$AGE_KEY" ] && [ -z "${SOPS_AGE_KEY_FILE:-}" ]; then
  AGE_KEY="$(security find-generic-password -a "$USER" -s "age-world-wide-webb-private-key" -w 2> /dev/null || true)"
fi
errors_file=$(mktemp "${TMPDIR:-/tmp}/sops-check.XXXXXX")
chmod 600 "$errors_file"
trap 'rm -f "$errors_file"' EXIT

failed=0

for f in "$@"; do
  case "$f" in
    secrets/*.yaml) ;;
    *) continue ;;
  esac

  # Check the STAGED blob (what the commit will contain), not the working tree.
  staged="$(git show ":$f" 2> /dev/null || true)"
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
  if [ -z "$AGE_KEY" ] && [ -z "${SOPS_AGE_KEY_FILE:-}" ]; then
    echo "WARNING: age key not in keychain — skipping MAC verification for $f" >&2
    echo "  (structure check passed; integrity unverified)" >&2
    continue
  fi

  if ! printf '%s\n' "$staged" \
    | SOPS_AGE_KEY="$AGE_KEY" sops -d --input-type yaml --output-type yaml /dev/stdin > /dev/null 2> "$errors_file"; then
    echo "SOPS verification failed: $f" >&2
    echo "  Supply the matching product/host identity through SOPS_AGE_KEY and verify again." >&2
    echo "  If the correct key is available, recover the last-good ciphertext and edit via sops." >&2
    failed=1
  fi
done

exit $failed
