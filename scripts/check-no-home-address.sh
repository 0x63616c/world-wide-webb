#!/usr/bin/env bash
# Blocks commits that reintroduce the home location's identifying name tokens.
# The real home coordinates + place name live ONLY in 1Password (HOME_* env,
# item "Home Location"); the repo ships a public LA placeholder. This guard
# keeps the building/neighbourhood name out of the open-source repo for good
# (CC-3zi / CC-d3j) — the repo physically rejects a regression.
#
# Mirrors scripts/check-no-ofelia.sh + check-fake-data.sh: the forbidden tokens
# may appear only on this guard's own sanctioned surface (this script, the hook
# config, and the doc that explains it).

set -euo pipefail

# Sanctioned surfaces — the only places the tokens may appear, because they
# exist to enforce or document the ban.
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

  # Case-insensitive: catches "Kurve on Wilshire", "Kurve Wilshire", bare
  # "Kurve", "KurveNet", "Wilshire Blvd", any casing.
  if grep -niE 'kurve|wilshire' "$f" >/dev/null 2>&1; then
    while IFS= read -r line; do
      violations+=("$f:$line")
    done < <(grep -niE 'kurve|wilshire' "$f")
  fi
done

if [ ${#violations[@]} -gt 0 ]; then
  echo "✗ Home-location name reintroduced — keep it out of the public repo:" >&2
  printf '   %s\n' "${violations[@]}" >&2
  echo "" >&2
  echo "The real home name/coords live in 1Password (HOME_* env, item 'Home" >&2
  echo "Location'); the repo ships a public LA placeholder. Use env.HOME_* or the" >&2
  echo "web config/home.ts, never a literal address. See CC-mqp / CC-3zi." >&2
  exit 1
fi

exit 0
