#!/usr/bin/env bash
# Hermetic tests for scripts/cnpg-local-name-preflight.sh (www-0y64.2).

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/cnpg-local-name-preflight.sh"
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

evidence="$TMP/evidence"
mkdir -p "$evidence"
cat >"$evidence/source-counts.tsv" <<'EOF'
public.events|10
public.guests|3
EOF
cat >"$evidence/target-counts.tsv" <<'EOF'
public.events|10
public.guests|3
EOF
: >"$evidence/schema.diff"
printf 'PASS api-up\nPASS pg-backup\n' >"$evidence/smoke.txt"
printf 'start: 2026-06-18T10:00:00Z\nend: 2026-06-19T10:00:00Z\nSOAK COMPLETE\n' >"$evidence/soak.txt"

good_env=(
  "CNPG_MIGRATION_PRODUCT=captive-portal"
  "CNPG_MIGRATION_NAMESPACE=captive-portal"
  "CNPG_OLD_CLUSTER=captive-portal"
  "CNPG_NEW_CLUSTER=postgres"
  "CNPG_LOCAL_NAME_EVIDENCE_DIR=$evidence"
  "CNPG_CLEANUP_APPROVED=yes"
)

run() { env -i PATH="$PATH" "$@" bash "$SCRIPT"; }

out="$(run 2>&1)"; rc=$?
check "empty env blocks cleanup" 1 "$rc"
check_contains "empty env refuses cleanup" "NOT READY" "$out"
check_contains "empty env asks for approval" "CNPG_CLEANUP_APPROVED" "$out"

out="$(run "${good_env[@]}" CNPG_CLEANUP_APPROVED=no 2>&1)"; rc=$?
check "approval is required" 1 "$rc"
check_contains "approval block is named" "approval required" "$out"

cp "$evidence/target-counts.tsv" "$TMP/target-counts.good"
printf 'public.events|9\npublic.guests|3\n' >"$evidence/target-counts.tsv"
out="$(run "${good_env[@]}" 2>&1)"; rc=$?
check "row-count mismatch blocks" 1 "$rc"
check_contains "row-count block names comparison" "row-count comparison failed" "$out"
mv "$TMP/target-counts.good" "$evidence/target-counts.tsv"

printf 'CREATE INDEX changed;\n' >"$evidence/schema.diff"
out="$(run "${good_env[@]}" 2>&1)"; rc=$?
check "schema diff blocks" 1 "$rc"
check_contains "schema block names diff" "schema diff is non-empty" "$out"
: >"$evidence/schema.diff"

printf 'PASS api-up\nFAIL pg-backup\n' >"$evidence/smoke.txt"
out="$(run "${good_env[@]}" 2>&1)"; rc=$?
check "smoke failure blocks" 1 "$rc"
check_contains "smoke block names fail" "smoke report contains FAIL" "$out"
printf 'PASS api-up\nPASS pg-backup\n' >"$evidence/smoke.txt"

printf 'start only\n' >"$evidence/soak.txt"
out="$(run "${good_env[@]}" 2>&1)"; rc=$?
check "missing soak completion blocks" 1 "$rc"
check_contains "soak block names completion" "SOAK COMPLETE" "$out"
printf 'SOAK COMPLETE\n' >"$evidence/soak.txt"

out="$(run "${good_env[@]}" 2>&1)"; rc=$?
check "complete evidence allows cleanup" 0 "$rc"
check_contains "green path announces ready" "READY: cleanup evidence is complete" "$out"

echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
