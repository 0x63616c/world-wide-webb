#!/usr/bin/env bash
# Guard (Track C, C7): the `@app-kit` / `@features` authoring-surface aliases must
# be declared IDENTICALLY in every resolver, or a module resolves in one tool and
# not another (tsc green, vite build red — or worse, silently divergent code).
#
# The alias-parity.test.ts vitest case proves the aliases RESOLVE at runtime; this
# script is the static backstop that every resolver CONFIG still carries the
# mapping, so a dropped alias fails fast in CI regardless of whether a test
# happens to import through it.
#
# Resolvers checked:
#   - tsconfig.config.json     (typechecks app-kit/ + features/ + the alias-parity
#                               proof; declares the `paths`. The ROOT tsconfig.json
#                               is deliberately paths-free so the apps:gen codegen's
#                               `@/*` resolution via apps/web/tsconfig is not shadowed,
#                               so root is NOT checked here.)
#   - apps/web/tsconfig.json   (web consumers; defines its own `paths`, so restated)
#   - apps/web/vite.config.ts  (resolve.alias)
#   - vitest.config.ts         (apps-gen project resolve.alias)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail=0
note() { printf '  %s\n' "$1"; }

# check <file> <regex-for-app-kit> <regex-for-features> <label>
check() {
  local file="$1" appkit_re="$2" features_re="$3"
  if [[ ! -f "$file" ]]; then
    echo "✗ MISSING FILE: $file"
    fail=1
    return
  fi
  local ok=1
  if ! grep -Eq "$appkit_re" "$file"; then
    echo "✗ $file: missing @app-kit alias mapping"
    ok=0
    fail=1
  fi
  if ! grep -Eq "$features_re" "$file"; then
    echo "✗ $file: missing @features alias mapping"
    ok=0
    fail=1
  fi
  if [[ "$ok" == 1 ]]; then
    echo "✓ $file"
  fi
}

# tsconfig files use JSON `paths` keys: "@app-kit" and "@features/*".
TS_APPKIT='"@app-kit"[[:space:]]*:'
TS_FEATURES='"@features/\*"[[:space:]]*:'
check "tsconfig.config.json"   "$TS_APPKIT" "$TS_FEATURES"
check "apps/web/tsconfig.json" "$TS_APPKIT" "$TS_FEATURES"

# vite + vitest use resolve.alias object keys: "@app-kit" and "@features".
ALIAS_APPKIT='"@app-kit"[[:space:]]*:'
ALIAS_FEATURES='"@features"[[:space:]]*:'
check "apps/web/vite.config.ts" "$ALIAS_APPKIT" "$ALIAS_FEATURES"
check "vitest.config.ts"        "$ALIAS_APPKIT" "$ALIAS_FEATURES"

if [[ "$fail" != 0 ]]; then
  echo ""
  echo "Alias parity FAILED: add @app-kit + @features to the resolver(s) above."
  echo "All resolvers must agree: root tsconfig.json (also bun), apps/web/tsconfig.json,"
  echo "apps/web/vite.config.ts, vitest.config.ts."
  exit 1
fi

echo ""
echo "✓ Alias parity: @app-kit + @features present in every resolver."
