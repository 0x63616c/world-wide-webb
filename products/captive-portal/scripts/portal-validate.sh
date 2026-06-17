#!/usr/bin/env bash
# Portal migration validation script (www-jtp0.5.6).
#
# Runs semantic checks against a source (Control Center) and destination
# (Captive Portal) Postgres instance after portal-import.sh completes.
# Exits non-zero if any check fails.
#
# For rehearsal against scratch databases, point SOURCE_* and DEST_* at the
# scratch instances. Do NOT run against production without PORTAL_VALIDATE_PROD_APPROVED=1.
#
# Usage:
#   SOURCE_POSTGRES_HOST=... SOURCE_POSTGRES_DB=... \
#   DEST_POSTGRES_HOST=... DEST_POSTGRES_DB=... \
#   POSTGRES_USER=... POSTGRES_PASSWORD=... \
#   ./products/captive-portal/scripts/portal-validate.sh
#
# Exit codes:
#   0 - all checks passed (ready for human review)
#   1 - one or more checks failed (abort migration)

set -euo pipefail

: "${SOURCE_POSTGRES_HOST:?SOURCE_POSTGRES_HOST must be set}"
: "${SOURCE_POSTGRES_DB:?SOURCE_POSTGRES_DB must be set}"
: "${DEST_POSTGRES_HOST:?DEST_POSTGRES_HOST must be set}"
: "${DEST_POSTGRES_DB:?DEST_POSTGRES_DB must be set}"
: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"
SOURCE_POSTGRES_PORT="${SOURCE_POSTGRES_PORT:-5432}"
DEST_POSTGRES_PORT="${DEST_POSTGRES_PORT:-5432}"

if [[ "${PORTAL_VALIDATE_PROD_APPROVED:-0}" != "1" ]]; then
  echo "REHEARSAL MODE (set PORTAL_VALIDATE_PROD_APPROVED=1 for production)" >&2
fi

# Password-only since www-p9hx: portal_guest / portal_code / portal_attempt were
# dropped; portal_authorization (mac-only) + portal_rate_limit remain.
TABLES=(portal_authorization portal_rate_limit)
FAILURES=0

count_rows() {
  local host="$1" port="$2" db="$3" table="$4"
  PGPASSWORD="${POSTGRES_PASSWORD}" psql \
    --host="${host}" --port="${port}" \
    --username="${POSTGRES_USER}" --dbname="${db}" \
    --tuples-only --command="SELECT COUNT(*) FROM ${table};" | tr -d ' '
}

run_query() {
  local host="$1" port="$2" db="$3" query="$4"
  PGPASSWORD="${POSTGRES_PASSWORD}" psql \
    --host="${host}" --port="${port}" \
    --username="${POSTGRES_USER}" --dbname="${db}" \
    --tuples-only --command="${query}" | tr -d ' \n'
}

echo "=== Portal migration validation ==="
echo ""

echo "1. Row counts:"
for t in "${TABLES[@]}"; do
  SRC="$(count_rows "${SOURCE_POSTGRES_HOST}" "${SOURCE_POSTGRES_PORT}" "${SOURCE_POSTGRES_DB}" "${t}")"
  DST="$(count_rows "${DEST_POSTGRES_HOST}" "${DEST_POSTGRES_PORT}" "${DEST_POSTGRES_DB}" "${t}")"
  if [[ "${SRC}" == "${DST}" ]]; then
    echo "  [OK]   ${t}: ${SRC}"
  else
    echo "  [FAIL] ${t}: source=${SRC} dest=${DST}"
    FAILURES=$((FAILURES + 1))
  fi
done

echo ""
echo "2. Semantic checks:"

# Active authorization: count rows where expires_at_utc > now().
SRC_ACTIVE="$(run_query "${SOURCE_POSTGRES_HOST}" "${SOURCE_POSTGRES_PORT}" "${SOURCE_POSTGRES_DB}" \
  "SELECT COUNT(*) FROM portal_authorization WHERE expires_at_utc > NOW();")"
DST_ACTIVE="$(run_query "${DEST_POSTGRES_HOST}" "${DEST_POSTGRES_PORT}" "${DEST_POSTGRES_DB}" \
  "SELECT COUNT(*) FROM portal_authorization WHERE expires_at_utc > NOW();")"
if [[ "${SRC_ACTIVE}" == "${DST_ACTIVE}" ]]; then
  echo "  [OK]   active authorizations: ${SRC_ACTIVE}"
else
  echo "  [FAIL] active authorizations: source=${SRC_ACTIVE} dest=${DST_ACTIVE}"
  FAILURES=$((FAILURES + 1))
fi

# Expired authorization: count rows where expires_at_utc <= now().
SRC_EXP="$(run_query "${SOURCE_POSTGRES_HOST}" "${SOURCE_POSTGRES_PORT}" "${SOURCE_POSTGRES_DB}" \
  "SELECT COUNT(*) FROM portal_authorization WHERE expires_at_utc <= NOW();")"
DST_EXP="$(run_query "${DEST_POSTGRES_HOST}" "${DEST_POSTGRES_PORT}" "${DEST_POSTGRES_DB}" \
  "SELECT COUNT(*) FROM portal_authorization WHERE expires_at_utc <= NOW();")"
if [[ "${SRC_EXP}" == "${DST_EXP}" ]]; then
  echo "  [OK]   expired authorizations: ${SRC_EXP}"
else
  echo "  [FAIL] expired authorizations: source=${SRC_EXP} dest=${DST_EXP}"
  FAILURES=$((FAILURES + 1))
fi

# Password-only since www-p9hx: portal_code / portal_attempt / portal_guest were
# dropped, so the code-count, attempt-lockout, and guest foreign-key integrity
# checks are gone. portal_authorization is now keyed by MAC alone (no guest_id),
# so there are no foreign keys left to validate.

echo ""
if [[ "${FAILURES}" -eq 0 ]]; then
  echo "RESULT: validation PASSED - ready for human review checkpoint"
  echo ""
  echo "ROLLBACK NOTE: Control Center database is the source of truth until"
  echo "the final cutover is approved and validated (www-jtp0.5.7 REQUIRES CALUM)."
  exit 0
else
  echo "RESULT: validation FAILED (${FAILURES} check(s) failed)"
  echo "Abort migration - review failures above before proceeding."
  exit 1
fi
