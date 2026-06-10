#!/usr/bin/env bash
# Blocks commits that introduce Calum's personal (non-public) email into the
# public, open-source repo (CC-4ma / CC-twpy). His commit identity is the GitHub
# noreply address; the iCloud login email must never land in tracked content.
#
# Why a HASH and not base64: base64 is trivially reversible, so it cannot hide a
# secret — it only worked for the home-address guard because that guard encodes a
# low-sensitivity *building-name fragment*, not the full private value. An email's
# sensitive part IS the local-part, so there is no harmless fragment to encode.
# Instead this guard stores a ONE-WAY SHA-256 digest: the cleartext email appears
# NOWHERE in this repo, and the stored digest is irreversible. The guard extracts
# email-shaped tokens from each staged file, lowercases + hashes each, and blocks
# on a digest match. It never prints the matched token (that would re-leak it to
# the terminal / CI logs) — only "<redacted>" with the file:line.
#
# The real email lives only in 1Password / the git global identity; this keeps it
# out of the public repo for good. Mirrors the other blocking pre-commit guards.

set -euo pipefail

# SHA-256 of the lowercased personal email. One-way: cannot be reversed to the
# address. To rotate, run:  printf '%s' 'you@example.com' | shasum -a 256
BLOCKED_DIGESTS=(
  "7820c562019d916d5a3f1a25120a7e88c03b88537c7fc9e4ee641ea24465397c"
)

# TEST-ONLY: hermetic tests inject an EXTRA throwaway digest (space/comma
# separated) so they can exercise the full extract→hash→block path with a
# disposable address (e.g. test@example.com) — the real email is never needed,
# and this only ever ADDS to the blocked set, so it can't weaken the guard.
if [ -n "${PERSONAL_EMAIL_SHA256_EXTRA:-}" ]; then
  IFS=', ' read -r -a _extra <<<"$PERSONAL_EMAIL_SHA256_EXTRA"
  BLOCKED_DIGESTS+=("${_extra[@]}")
fi

# Email-shaped token matcher (RFC-pragmatic, not exhaustive).
EMAIL_RE='[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'

# Portable SHA-256 (macOS shasum / Linux sha256sum).
sha256_hex() {
  if command -v shasum >/dev/null 2>&1; then
    printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  else
    printf '%s' "$1" | sha256sum | awk '{print $1}'
  fi
}

is_blocked_digest() {
  local h="$1" d
  for d in "${BLOCKED_DIGESTS[@]}"; do
    [ "$h" = "$d" ] && return 0
  done
  return 1
}

# Sanctioned surfaces — the guard's own files (they contain no cleartext email).
is_sanctioned() {
  case "$1" in
    scripts/check-no-personal-email.sh) return 0 ;;
    scripts/test-check-no-personal-email.sh) return 0 ;;
    *) return 1 ;;
  esac
}

violations=()

for f in "$@"; do
  if is_sanctioned "$f"; then continue; fi
  case "$f" in
    node_modules/*) continue ;;
  esac
  [ -f "$f" ] || continue

  # -I skips binary files (treats as no match). lineno:token per match.
  while IFS= read -r match; do
    [ -n "$match" ] || continue
    lineno="${match%%:*}"
    token="${match#*:}"
    lc="$(printf '%s' "$token" | tr '[:upper:]' '[:lower:]')"
    if is_blocked_digest "$(sha256_hex "$lc")"; then
      # Never echo the token itself — that would re-leak the email.
      violations+=("$f:$lineno: <redacted personal email>")
    fi
  done < <(grep -InoE "$EMAIL_RE" "$f" 2>/dev/null || true)
done

if [ ${#violations[@]} -gt 0 ]; then
  echo "✗ Personal email reintroduced — keep it out of the public repo:" >&2
  printf '   %s\n' "${violations[@]}" >&2
  echo "" >&2
  echo "Your commit identity is the GitHub noreply address; the personal login" >&2
  echo "email lives only in 1Password / the git global config and must never enter" >&2
  echo "tracked content. Remove it (use the noreply address). See CC-twpy / CC-4ma." >&2
  exit 1
fi

exit 0
