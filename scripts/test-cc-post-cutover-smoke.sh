#!/usr/bin/env bash
# Hermetic tests for scripts/cc-post-cutover-smoke.sh (www-jtp0.7.9).
# No cluster, no network, no secrets. Exercises --help and the dry-run plan, which
# must enumerate every required check without touching kubectl/curl/psql.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SCRIPT="$HERE/cc-post-cutover-smoke.sh"

pass=0
fail=0
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
    printf 'FAIL: %s, unexpectedly contains %q\n' "$desc" "$needle"
  fi
}

# --help lists the env contract.
help_out="$(bash "$SCRIPT" --help 2>&1)"
check_contains "help documents dry-run flag" "CC_SMOKE_DRY_RUN" "$help_out"
check_contains "help documents parked default" "intentionally parked" "$help_out"

# Dry run must enumerate every required check and run NO real command.
dry_out="$(CC_SMOKE_DRY_RUN=1 bash "$SCRIPT" 2>&1)"
check_contains "dry-run probes api /up" "/up" "$dry_out"
check_contains "dry-run probes climate health" "/health/climate" "$dry_out"
check_contains "dry-run greps worker logs" "logs deploy/worker" "$dry_out"
check_contains "dry-run names every worker" "light-enforcer" "$dry_out"
check_contains "dry-run names weather worker" "weather-ingest" "$dry_out"
check_contains "dry-run checks media replicas" "media-worker" "$dry_out"
check_contains "dry-run notes expected parked replicas" "expect 0" "$dry_out"
check_contains "dry-run checks integration heartbeat" "integration_sync_status" "$dry_out"
check_contains "dry-run checks storage PVCs" "get pvc" "$dry_out"
check_contains "dry-run checks backup job" "cronjob/pg-backup" "$dry_out"
check_contains "dry-run announces no execution" "no checks executed" "$dry_out"

# Dry run must not emit PASS/FAIL lines (it executes nothing).
check_not_contains "dry-run runs no real checks" "FAIL api-up" "$dry_out"

# Honors a non-parked expected replica count override in the plan.
dry_running="$(CC_SMOKE_DRY_RUN=1 CC_EXPECTED_MEDIA_REPLICAS=1 bash "$SCRIPT" 2>&1)"
check_contains "override changes expected replicas" "expect 1" "$dry_running"

echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
