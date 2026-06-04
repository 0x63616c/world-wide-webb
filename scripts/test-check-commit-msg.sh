#!/usr/bin/env bash
# Hermetic test for scripts/check-commit-msg.sh.
#
# Stubs `bd` on PATH so the test never depends on a live Dolt DB or real
# tickets: the fake `bd show` treats CC-real as existing and everything else
# as unknown. Each case writes a temp commit-message file, runs the hook
# against it, and asserts the exit code.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$SCRIPT_DIR/check-commit-msg.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# --- fake bd: only CC-real exists -----------------------------------------
mkdir -p "$TMP/bin"
cat >"$TMP/bin/bd" <<'EOF'
#!/usr/bin/env bash
# Test stub: `bd show CC-real` succeeds; any other id fails.
if [ "${1:-}" = "show" ] && [ "${2:-}" = "CC-real" ]; then exit 0; fi
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
run_case pass   "area + real ticket"            "feat(weather/CC-real): add poller"
run_case pass   "nested area + real ticket"     "fix(web/tiles/CC-real): fix tile clip"
run_case pass   "breaking-change bang"          "refactor(api/CC-real)!: drop legacy route"
run_case pass   "ticket in scope AND body"      "$(printf 'chore(beads/CC-real): sync\n\nrefs CC-real')"

# --- rejected --------------------------------------------------------------
run_case reject "no area (ticket only in scope)" "feat(CC-real): missing area"
run_case reject "area but no ticket"             "feat(weather): no ticket here"
run_case reject "ticket only in body, not scope" "$(printf 'feat(weather): no scope ticket\n\nrefs CC-real')"
run_case reject "bad type"                       "update(weather/CC-real): not a real type"
run_case reject "not conventional at all"        "added the weather poller"
run_case reject "no parens scope"                "feat weather/CC-real: missing parens"
run_case reject "ticket not real"                "feat(weather/CC-fake): unknown ticket"
run_case reject "empty description"              "feat(weather/CC-real): "

echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
