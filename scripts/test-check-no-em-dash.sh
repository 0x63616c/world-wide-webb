#!/usr/bin/env bash
# Hermetic test for scripts/check-no-em-dash.sh.
#
# Writes temp files (some with an em dash U+2014, some without, some in
# excluded design-bundle paths), runs the guard against them, and asserts the
# exit code. No git or network needed.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/check-no-em-dash.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# A literal em dash, built from its codepoint so this test file itself stays
# em-dash-free (it would otherwise trip the very guard it tests).
EMDASH="$(printf '\xe2\x80\x94')"
ENDASH="$(printf '\xe2\x80\x93')"

pass=0
fail=0

# run_case <expected: pass|reject> <description> <relpath> <file-contents>
run_case() {
  local expect="$1" desc="$2" rel="$3" body="$4"
  local f="$TMP/$rel"
  mkdir -p "$(dirname "$f")"
  printf '%s\n' "$body" >"$f"
  if (cd "$TMP" && bash "$HOOK" "$rel" >/dev/null 2>&1); then
    local got="pass"
  else
    local got="reject"
  fi
  if [ "$got" = "$expect" ]; then
    pass=$((pass + 1))
    printf '  ok    [%-6s] %s\n' "$expect" "$desc"
  else
    fail=$((fail + 1))
    printf '  FAIL  [want %-6s got %-6s] %s\n' "$expect" "$got" "$desc"
  fi
}

# --- pass: no em dash --------------------------------------------------------
run_case pass   "clean ts file (hyphen, not em dash)"        "src/a.ts"   "// a clean, comma-joined comment - with a hyphen"
run_case pass   "clean css file"                             "src/b.css"  "/* tokens, fonts, all fine */"
run_case pass   "en dash is allowed (only em dash banned)"   "src/c.ts"   "// range 400${ENDASH}700 uses an en dash"

# --- reject: em dash present in an owned file --------------------------------
run_case reject "em dash in a ts comment"                    "src/d.ts"   "// loading${EMDASH}the accessible name"
run_case reject "em dash in a css comment"                   "src/e.css"  "/* swaps ${EMDASH} paired with preloads */"
run_case reject "em dash in a shell comment"                 "f.sh"       "# a no-op shim ${EMDASH} jsdom gap"
run_case reject "em dash in an nginx conf comment"           "nginx.conf" "# proxy ONLY portal ${EMDASH} guest boundary"
run_case reject "em dash in markdown prose"                  "doc.md"     "Self-recovery ${EMDASH} the panel is unattended."
run_case reject "em dash in json string"                     "x.json"     "{\"note\": \"a ${EMDASH} b\"}"

# --- pass: excluded design-reference bundles (sanctioned as-is) --------------
run_case pass   "em dash in docs/captive-portal/design is exempt"  "docs/captive-portal/design/theme.css" "/* swaps ${EMDASH} paired */"
run_case pass   "em dash in docs/media-tiles is exempt"            "docs/media-tiles/x.jsx"               "// design ${EMDASH} handoff"

# --- pass: the guard's own surface is exempt ---------------------------------
run_case pass   "the guard script itself is exempt"          "scripts/check-no-em-dash.sh" "# rejects U+2014 ${EMDASH} the em dash"

echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
