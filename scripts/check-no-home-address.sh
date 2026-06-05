#!/usr/bin/env bash
# Blocks commits that reintroduce the private home-location name tokens.
# The real home coordinates + place name live ONLY in 1Password (HOME_* env,
# item "Home Location"); the repo ships a public LA placeholder. This guard
# keeps the private location out of the open-source repo for good (www-3zi /
# www-d3j) — the repo physically rejects a regression.
#
# The blocked pattern is base64-encoded below so this public, open-source script
# never spells out the private location name itself. It decodes to a
# case-insensitive alternation of the location's identifying tokens. Mirrors
# the repo's other blocking pre-commit guards in spirit.

set -euo pipefail

# Decodes to the regex alternation of the location's identifying tokens. Kept
# encoded so the name is not written in cleartext anywhere in the public repo.
PATTERN="$(printf '%s' 'a3VydmV8d2lsc2hpcmU=' | base64 --decode)"

# Sanctioned surfaces — the guard's own files, which reference the ban.
is_sanctioned() {
  case "$1" in
    scripts/check-no-home-address.sh) return 0 ;;
    lefthook.yml) return 0 ;;
    .gitleaks.toml) return 0 ;;
    CLAUDE.md) return 0 ;;
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

  # Case-insensitive match of the private location tokens (any casing, including
  # combined forms and adjoining words like the SSID or street variants).
  if grep -niE "$PATTERN" "$f" >/dev/null 2>&1; then
    while IFS= read -r line; do
      violations+=("$f:$line")
    done < <(grep -niE "$PATTERN" "$f")
  fi
done

if [ ${#violations[@]} -gt 0 ]; then
  echo "✗ Private home-location name reintroduced — keep it out of the public repo:" >&2
  printf '   %s\n' "${violations[@]}" >&2
  echo "" >&2
  echo "The real home name/coords live in 1Password (HOME_* env, item 'Home" >&2
  echo "Location'); the repo ships a public LA placeholder. Use env.HOME_* or the" >&2
  echo "web config/home.ts, never a literal address. See www-mqp / www-3zi." >&2
  exit 1
fi

exit 0
