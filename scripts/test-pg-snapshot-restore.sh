#!/usr/bin/env bash
# Hermetic tests for scripts/pg-snapshot-restore.sh (www-jtp0.2.4).

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/pg-snapshot-restore.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0

check() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s, expected %q, got %q\n' "$desc" "$expected" "$actual"
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

check_not_contains() {
  local desc="$1" needle="$2" haystack="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    printf 'FAIL: %s, unexpectedly contained %q\n' "$desc" "$needle"
  fi
}

echo "pg-snapshot-restore.sh"

count_sql="$(bash "$SCRIPT" --print-count-sql 2>&1)"
check_contains "count SQL includes all normal tables" "c.relkind = 'r'" "$count_sql"
check_contains "count SQL excludes system schemas" "pg_catalog" "$count_sql"
check_contains "count SQL includes non-public schemas such as drizzle" "NOT LIKE 'pg_%'" "$count_sql"
check_not_contains "count SQL is not hardcoded to public only" "n.nspname = 'public'" "$count_sql"

secret_value="super-secret-password"
dry_run_output="$(POSTGRES_PASSWORD="$secret_value" bash "$SCRIPT" --dry-run --source production --scratch scratch --output-dir "$TMP/out" 2>&1)"
check_contains "dry run plans custom-format dump" "pg_dump -Fc" "$dry_run_output"
check_contains "dry run plans plain gzip dump" "pg_dump --format=plain" "$dry_run_output"
check_contains "dry run plans source counts" "capture source row counts" "$dry_run_output"
check_contains "dry run plans scratch restore" "restore custom dump into scratch" "$dry_run_output"
check_contains "dry run plans scratch counts" "capture scratch row counts" "$dry_run_output"
check_contains "dry run plans side-by-side diff" "compare source and scratch counts" "$dry_run_output"
check_not_contains "dry run never prints secret values" "$secret_value" "$dry_run_output"

if bash "$SCRIPT" --dry-run --source production --scratch production --output-dir "$TMP/out" >"$TMP/guard.out" 2>&1; then
  check "production scratch guard rejects unsafe target" "reject" "pass"
else
  check_contains "production scratch guard explains refusal" "scratch target must not be production" "$(<"$TMP/guard.out")"
fi

cat >"$TMP/source.tsv" <<'EOF'
drizzle.__drizzle_migrations|3
public.events|10
EOF

cat >"$TMP/scratch-ok.tsv" <<'EOF'
drizzle.__drizzle_migrations|3
public.events|10
EOF

cat >"$TMP/scratch-bad.tsv" <<'EOF'
drizzle.__drizzle_migrations|3
public.events|9
EOF

if bash "$SCRIPT" --compare-counts "$TMP/source.tsv" "$TMP/scratch-ok.tsv" >"$TMP/compare-ok.out" 2>&1; then
  check_contains "matching counts produce pass message" "COUNTS MATCH" "$(<"$TMP/compare-ok.out")"
else
  check "matching counts should pass" "pass" "reject"
fi

if bash "$SCRIPT" --compare-counts "$TMP/source.tsv" "$TMP/scratch-bad.tsv" >"$TMP/compare-bad.out" 2>&1; then
  check "mismatch should fail" "reject" "pass"
else
  bad_output="$(<"$TMP/compare-bad.out")"
  check_contains "mismatch tells operator to stop" "STOP" "$bad_output"
  check_contains "mismatch shows side-by-side row" "public.events" "$bad_output"
fi

echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
