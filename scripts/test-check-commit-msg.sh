#!/usr/bin/env bash
# Hermetic test for scripts/check-commit-msg.sh.
#
# Stubs `bd` on PATH so the test never depends on a live Dolt DB or real
# tickets: the fake `bd show` treats www-real as existing and everything else
# as unknown. Each case writes a temp commit-message file, runs the hook
# against it, and asserts the exit code.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/check-commit-msg.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- fake bd: only www-real exists -----------------------------------------
mkdir -p "$TMP/bin"
cat >"$TMP/bin/bd" <<'EOF'
#!/usr/bin/env bash
# Test stub: `bd show www-real`, the epic-child `www-real.12`, and the
# grandchild `www-real.3.5` succeed; else fail.
if [ "${1:-}" = "show" ] && { [ "${2:-}" = "www-real" ] || [ "${2:-}" = "www-real.12" ] || [ "${2:-}" = "www-real.3.5" ]; }; then exit 0; fi
exit 1
EOF
chmod +x "$TMP/bin/bd"

pass=0
fail=0

# run_case <expected: pass|reject> <description> <commit message...>
run_case() {
  local expect="$1" desc="$2" msg="$3"
  local f="$TMP/msg.txt"
  printf '%s\n' "$msg" >"$f"
  if PATH="$TMP/bin:$PATH" bash "$HOOK" "$f" >/dev/null 2>&1; then
    local got="pass"
  else
    local got="reject"
  fi
  if [ "$got" = "$expect" ]; then
    pass=$((pass + 1))
    printf '  ok    [%-6s] %s\n' "$expect" "$desc"
  else
    fail=$((fail + 1))
    printf '  FAIL  expected=%s got=%s : %s\n' "$expect" "$got" "$desc"
  fi
}

echo "check-commit-msg.sh"

# --- accepted --------------------------------------------------------------
run_case pass   "area + real ticket"            "feat(weather/www-real): add poller"
run_case pass   "nested area + real ticket"     "fix(web/tiles/www-real): fix tile clip"
run_case pass   "breaking-change bang"          "refactor(api/www-real)!: drop legacy route"
run_case pass   "ticket in scope AND body"      "$(printf 'chore(beads/www-real): sync\n\nrefs www-real')"
run_case pass   "epic-child dotted ticket id"   "feat(bosun/www-real.12): child ac"
run_case pass   "epic-grandchild dotted id"     "feat(web/www-real.3.5): grandchild ac"

# --- rejected --------------------------------------------------------------
run_case reject "no area (ticket only in scope)" "feat(www-real): missing area"
run_case reject "area but no ticket"             "feat(weather): no ticket here"
run_case reject "ticket only in body, not scope" "$(printf 'feat(weather): no scope ticket\n\nrefs www-real')"
run_case reject "bad type"                       "update(weather/www-real): not a real type"
run_case reject "not conventional at all"        "added the weather poller"
run_case reject "no parens scope"                "feat weather/www-real: missing parens"
run_case reject "ticket not real"                "feat(weather/www-fake): unknown ticket"
run_case reject "empty description"              "feat(weather/www-real): "

echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
