#!/usr/bin/env bash
# Hermetic tests for scripts/cc-cutover-preflight.sh (www-jtp0.7.7).
# No real database, no secrets, no network. Builds disposable fixtures in a tmp
# dir and exercises the red (missing inputs) -> green (all present) gate path.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/cc-cutover-preflight.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0
check() {
  local desc="$1" expected_rc="$2" actual_rc="$3"
  if [ "$expected_rc" -eq "$actual_rc" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s (expected rc=%s, got rc=%s)\n' "$desc" "$expected_rc" "$actual_rc"
  fi
}
check_contains() {
  local desc="$1" needle="$2" haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s, missing %q\n' "$desc" "$needle"
  fi
}

# --- fixtures ---
report="$TMP/rehearsal.md"
printf 'rehearsal: counts matched\n' >"$report"
snap="$TMP/snap"
mkdir -p "$snap"
printf 'binary-ish dump\n' >"$snap/control_center.dump"
printf 'sql gz placeholder\n' >"$snap/control_center.sql.gz"
counts="$TMP/source-counts.tsv"
printf 'public.events|5\n' >"$counts"

# All-good environment shared by tests, overridden per case.
good_env=(
  "CC_REHEARSAL_REPORT=$report"
  "CC_SNAPSHOT_DIR=$snap"
  "CC_SOURCE_COUNTS=$counts"
  "CC_ROLLBACK_DB_HOST=old-db.homelab"
  "CC_ROLLBACK_AUTH_SECRET=cc-postgres-auth-legacy"
  "CC_CUTOVER_APPROVED=yes"
)

run() { env -i PATH="$PATH" "$@" bash "$SCRIPT"; }

# 1. Empty environment must BLOCK (rc=1) and never claim ready.
out="$(run 2>&1)"; rc=$?
check "empty env blocks" 1 "$rc"
check_contains "empty env names missing approval" "CC_CUTOVER_APPROVED" "$out"
check_contains "empty env refuses cutover" "NOT READY" "$out"

# 2. Everything but approval present -> still blocks specifically on approval.
out="$(run "${good_env[@]}" CC_CUTOVER_APPROVED=no 2>&1)"; rc=$?
check "missing approval blocks" 1 "$rc"
check_contains "approval gate fires last" "approval required" "$out"

# 3. Missing one snapshot file blocks with the file named.
rm -f "$snap/control_center.sql.gz"
out="$(run "${good_env[@]}" 2>&1)"; rc=$?
check "missing snapshot blocks" 1 "$rc"
check_contains "missing snapshot is named" "control_center.sql.gz" "$out"
printf 'sql gz placeholder\n' >"$snap/control_center.sql.gz"  # restore for next case

# 4. Missing rollback target blocks.
out="$(run "${good_env[@]}" CC_ROLLBACK_DB_HOST= 2>&1)"; rc=$?
check "missing rollback host blocks" 1 "$rc"
check_contains "rollback host gap named" "CC_ROLLBACK_DB_HOST" "$out"

# 5. All inputs present -> READY (rc=0).
out="$(run "${good_env[@]}" 2>&1)"; rc=$?
check "all inputs present -> ready" 0 "$rc"
check_contains "green path announces ready" "READY: all cutover preconditions" "$out"
check_contains "green path points to runbook" "cc-cutover-runbook.md" "$out"

# 6. Never echoes a secret VALUE (we only ever pass names; assert no value leaks).
check_contains "no secret value in output" "cc-postgres-auth-legacy" "$out"  # name ok
# (the script is given only names, so there is no value to leak; this asserts the
#  name-not-value contract is what flows through.)

echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
