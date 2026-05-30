#!/usr/bin/env bash
# Blocks commits that introduce fake/placeholder data sentinels.
#
# Rules:
#   FALLBACK or PLACEHOLDER (uppercase, as identifiers — not lowercase words,
#   not comment text, not test-name strings) in staged TS/TSX → blocked everywhere.
#
#   DEMO_ or demo_ in staged TS/TSX → blocked UNLESS the file is one of the
#   sanctioned always-on demo backends or their direct unit tests:
#     apps/api/src/services/network-service.ts
#     apps/api/src/services/weather-service.ts
#     apps/api/src/__tests__/network.test.ts
#     apps/api/src/__tests__/weather.test.ts
#
# What counts as "in a comment" — lines we strip before checking:
#   //…        single-line comments
#   *…         JSDoc / block-comment continuations
#   it(   / describe( / test(  — test-name strings

set -euo pipefail

SANCTIONED=(
  "apps/api/src/services/network-service.ts"
  "apps/api/src/services/weather-service.ts"
  "apps/api/src/__tests__/network.test.ts"
  "apps/api/src/__tests__/weather.test.ts"
)

is_sanctioned() {
  local f="$1"
  for s in "${SANCTIONED[@]}"; do
    [[ "$f" == "$s" ]] && return 0
  done
  return 1
}

fail=0

for f in "$@"; do
  # Only check TS/TSX
  case "$f" in *.ts|*.tsx) ;; *) continue ;; esac

  # Strip comment lines and test-name strings before searching.
  filtered=$(grep -v -E '^\s*//|^\s*\*' "$f" 2>/dev/null \
    | grep -v -E '^\s*(it|describe|test)\s*\(' || true)

  # 1. FALLBACK or PLACEHOLDER (UPPERCASE ONLY — not lowercase "fallback" param names
  #    or "placeholder" in prose/comments) — blocked everywhere, no exceptions.
  if echo "$filtered" | grep -qE '(^|[^a-z])(FALLBACK|PLACEHOLDER)'; then
    echo "BLOCKED: $f contains FALLBACK or PLACEHOLDER sentinel — use shimmer Skeleton instead"
    fail=1
  fi

  # 2. DEMO_ / demo_ — blocked outside the sanctioned set
  is_sanctioned "$f" && continue
  if echo "$filtered" | grep -qE '(DEMO_|demo_)'; then
    echo "BLOCKED: $f introduces DEMO_ / demo_ outside sanctioned backend files"
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "Fix the above before committing."
  echo "Sanctioned DEMO_ files (always-on stubs until real integrations land):"
  for s in "${SANCTIONED[@]}"; do echo "  $s"; done
  exit 1
fi
