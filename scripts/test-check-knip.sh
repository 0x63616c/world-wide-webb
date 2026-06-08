#!/usr/bin/env bash
# Hermetic tests for the knip dead-code ratchet guard (scripts/check-knip.sh).
#
# Drives the guard with canned `knip --reporter json` reports (KNIP_REPORT_FILE)
# and a throwaway baseline (KNIP_BASELINE_FILE), so it never actually invokes
# knip — fast, deterministic, no network/deps. Covers the pass/grow/shrink/update
# matrix. Mirrors scripts/test-check-commit-msg.sh.
set -uo pipefail
cd "$(dirname "$0")/.."

GUARD="scripts/check-knip.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0
fail=0

# report <file> <exports> <files> — write a minimal knip JSON with the given
# number of unused-export and unused-file findings spread across issue entries.
report() {
  local path="$1" n_exports="$2" n_files="$3"
  python3 - "$path" "$n_exports" "$n_files" <<'PY'
import json, sys
path, ne, nf = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
issues=[]
for i in range(ne):
    issues.append({"file": f"src/a{i}.ts", "exports": [{"name": f"e{i}"}]})
for i in range(nf):
    issues.append({"file": f"src/dead{i}.ts", "files": True})
json.dump({"issues": issues}, open(path, "w"))
PY
}

check() { # check <name> <expected_exit> -- runs guard, compares exit code
  local name="$1" expected="$2"; shift 2
  KNIP_REPORT_FILE="$REPORT" KNIP_BASELINE_FILE="$BASE" bash "$GUARD" "$@" >/dev/null 2>&1
  local got=$?
  if [[ "$got" == "$expected" ]]; then
    echo "  ✓ $name (exit $got)"; pass=$((pass+1))
  else
    echo "  ✗ $name — expected exit $expected, got $got"; fail=$((fail+1))
  fi
}

REPORT="$WORK/report.json"
BASE="$WORK/baseline.json"

echo "knip ratchet guard tests:"

# 1. --update writes a baseline from the report, exits 0.
report "$REPORT" 5 1
check "update writes baseline" 0 --update
grep -q '"exports": 5' "$BASE" || { echo "  ✗ baseline missing exports:5"; fail=$((fail+1)); }

# 2. Same counts → passes (baseline holds).
check "equal counts pass" 0

# 3. More findings than baseline → BLOCK (new dead code).
report "$REPORT" 6 1
check "grown exports block" 1

# 4. New file finding (files 1→2) also blocks.
report "$REPORT" 5 2
check "grown files block" 1

# 5. Fewer findings → BLOCK with "lower the baseline" (keeps ratchet honest).
report "$REPORT" 3 1
check "shrunk findings block (update needed)" 1

# 6. After --update to the lower numbers, it passes again.
check "re-update to lower baseline" 0 --update
check "lowered baseline holds" 0

# 7. Missing baseline degrades gracefully (exit 0, no crash).
rm -f "$BASE"
check "missing baseline degrades" 0

# 8. Unparseable report degrades gracefully (exit 0).
echo "not json" >"$REPORT"
report_base() { echo '{"exports":5}' >"$BASE"; }
report_base
check "bad report degrades" 0

echo
echo "knip ratchet: $pass passed, $fail failed"
[[ "$fail" == 0 ]]
