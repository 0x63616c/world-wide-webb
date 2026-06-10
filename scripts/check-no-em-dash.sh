#!/usr/bin/env bash
# Blocks commits that introduce an em dash (U+2014, "—") into staged source.
# Calum's style rule is absolute: no em dashes, ever, comments included. This
# makes it a mechanical invariant instead of relying on review to catch it
# (mirrors the other check-no-* / check-fake-data guards). Use commas,
# periods, or line breaks. The en dash (U+2013) and hyphen are NOT blocked.
#
# Staged-only (lefthook passes {staged_files}); legacy files clean up as they
# are next touched. Design-reference bundles are sanctioned as-is.

set -euo pipefail

# Sanctioned paths the em dash may appear in:
#  - this guard + its test (they name the character to enforce/exercise it)
#  - design handoff bundles (verbatim reference, not shipped app code)
is_exempt() {
  case "$1" in
    scripts/check-no-em-dash.sh) return 0 ;;
    scripts/test-check-no-em-dash.sh) return 0 ;;
    docs/captive-portal/design/*) return 0 ;;
    docs/media-tiles/*) return 0 ;;
    *) return 1 ;;
  esac
}

# The em dash, as a byte pattern, so this script stays em-dash-free itself.
EMDASH="$(printf '\xe2\x80\x94')"

violations=()

for f in "$@"; do
  is_exempt "$f" && continue
  case "$f" in
    node_modules/*) continue ;;
    .beads/*) continue ;;
  esac
  [ -f "$f" ] || continue

  if grep -nF "$EMDASH" "$f" >/dev/null 2>&1; then
    while IFS= read -r line; do
      violations+=("$f:$line")
    done < <(grep -nF "$EMDASH" "$f")
  fi
done

if [ ${#violations[@]} -gt 0 ]; then
  echo "X Em dash (U+2014) is not allowed (Calum's style rule, comments included):" >&2
  printf '   %s\n' "${violations[@]}" >&2
  echo "" >&2
  echo "Replace it with a comma, a period, or a line break. The en dash (U+2013)" >&2
  echo "and the hyphen-minus are fine. Design bundles under docs/*/design are exempt." >&2
  exit 1
fi

exit 0
