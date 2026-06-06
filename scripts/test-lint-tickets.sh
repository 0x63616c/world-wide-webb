#!/usr/bin/env bash
# Hermetic tests for scripts/lint-tickets.sh.
# Stubs `bd export` on PATH with canned JSONL and pins "now" via LINT_NOW so the
# age-based warnings (P0-AGING, STALLED) are deterministic. Mirrors the
# stub-on-PATH pattern in scripts/test-check-commit-msg.sh.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/lint-tickets.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Pinned clock: 2026-06-06T00:00:00Z. "old" rows are ~36 days back (>14, >7).
NOW=1780617600
OLD='2026-05-01T00:00:00Z'
RECENT='2026-06-05T00:00:00Z'

mkroot() { printf '{"id":"%s","status":"%s","issue_type":"%s","priority":%s,"labels":%s,"acceptance_criteria":%s,"updated_at":"%s","title":"%s"}\n' "$@"; }

# Stub bd: `bd export` prints the fixture; everything else is a no-op success.
mkdir -p "$TMP/bin"
{
  mkroot A1 open    feature 2 null '""'                              "$RECENT" "feature with no AC"
  mkroot A2 open    feature 2 null '"do the thing; gates green"'     "$RECENT" "feature with prose AC"
  mkroot A3 open    feature 2 null '"- [ ] does the thing"'          "$RECENT" "feature with checkbox AC"
  mkroot A4 open    task    2 null '"- [ ] decision recorded"'       "$RECENT" "Evaluate Effect for the poller"
  mkroot A5 open    decision 3 null '""'                             "$RECENT" "Evaluate ts-pattern mapping"
  mkroot A6 open    feature 0 null '"- [ ] x"'                       "$OLD"    "aging P0 feature"
  mkroot A7 in_progress task 2 null '"- [ ] x"'                      "$OLD"    "stalled in-progress task"
  mkroot A8 open    epic    1 null '""'                              "$RECENT" "epic container"
  mkroot A9 closed  feature 2 null '""'                              "$OLD"    "closed no-AC feature"
} > "$TMP/fixture.jsonl"

cat >"$TMP/bin/bd" <<EOF
#!/usr/bin/env bash
if [ "\${1:-}" = "export" ]; then cat "$TMP/fixture.jsonl"; exit 0; fi
exit 0
EOF
chmod +x "$TMP/bin/bd"

OUT="$(PATH="$TMP/bin:$PATH" LINT_NOW="$NOW" bash "$SCRIPT")"

pass=0; fail=0
want()    { if grep -qE "^$1 .*$2" <<<"$OUT"; then pass=$((pass+1)); echo "  ok    $1 → $2"; else fail=$((fail+1)); echo "  FAIL  expected $1 → $2"; fi; }
wantnot() { if grep -qE "^$1 " <<<"$OUT"; then fail=$((fail+1)); echo "  FAIL  did not expect $1 to warn"; else pass=$((pass+1)); echo "  ok    $1 → (no warning)"; fi; }

want    A1 "MISSING-AC"
want    A2 "PROSE-AC"
wantnot A3
want    A4 "UNTYPED-SPIKE"
wantnot A5
want    A6 "P0-AGING"
want    A7 "STALLED"
wantnot A8
wantnot A9

echo
echo "lint-tickets tests: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
