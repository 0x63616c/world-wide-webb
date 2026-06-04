#!/usr/bin/env bash
# Blocks commits that reintroduce Ofelia, the third-party cron scheduler that
# bosun's in-process scheduler replaced (www-79k). Scheduling now lives in
# packages/bosun/src/scheduler.ts (a one-shot Swarm job per cronJob); there must
# be no `mcuadros/ofelia` image, no `ofelia.*` deploy labels, and no ofeliaController.
#
# This is the one sanctioned place the word may appear — it is the mechanical
# invariant, mirroring scripts/check-fake-data.sh. The repo physically rejects a
# regression.

set -euo pipefail

# The sanctioned enforcement+doc surface — the only places the token may appear,
# because they exist to enforce or document its banishment. Mirrors how
# check-fake-data.sh hardcodes its own sanctioned files.
is_sanctioned() {
  case "$1" in
    scripts/check-no-ofelia.sh) return 0 ;;
    lefthook.yml) return 0 ;;
    CLAUDE.md) return 0 ;;
    *) return 1 ;;
  esac
}

violations=()

for f in "$@"; do
  # Only inspect text we own; skip the guard's own surface and anything vendored.
  if is_sanctioned "$f"; then continue; fi
  case "$f" in
    node_modules/*) continue ;;
    .beads/*) continue ;;
  esac
  [ -f "$f" ] || continue

  # Case-insensitive match on the forbidden token. Captures ofelia,
  # ofeliaController, mcuadros/ofelia, and ofelia.* labels alike.
  if grep -niE 'ofelia' "$f" >/dev/null 2>&1; then
    while IFS= read -r line; do
      violations+=("$f:$line")
    done < <(grep -niE 'ofelia' "$f")
  fi
done

if [ ${#violations[@]} -gt 0 ]; then
  echo "✗ Ofelia reference reintroduced (replaced by bosun's scheduler in www-79k):" >&2
  printf '   %s\n' "${violations[@]}" >&2
  echo "" >&2
  echo "Schedule jobs with cronJob() — run by packages/bosun/src/scheduler.ts as a" >&2
  echo "one-shot Swarm job. No mcuadros/ofelia, no ofelia.* labels." >&2
  exit 1
fi

exit 0
