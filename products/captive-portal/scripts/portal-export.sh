#!/usr/bin/env bash
# Portal data export script (www-jtp0.5.6).
#
# Exports the current portal tables from Control Center Postgres using pg_dump.
# Produces TWO output files per run:
#   <OUTPUT_DIR>/portal_export_<TIMESTAMP>.dump   - pg_dump custom format (for pg_restore)
#   <OUTPUT_DIR>/portal_export_<TIMESTAMP>.sql.gz - plain SQL gzip (human-readable backup)
#
# REQUIRES CALUM - production export (www-jtp0.5.7):
#   This script reads from the Control Center Postgres database. Running it against
#   production requires explicit approval. Set PORTAL_EXPORT_PROD_APPROVED=1 to
#   confirm the human review checkpoint is complete before running against prod.
#
# For rehearsal against a scratch database, set:
#   POSTGRES_HOST, POSTGRES_PORT, POSTGRES_DB, POSTGRES_USER, POSTGRES_PASSWORD
# to point at the scratch instance.
#
# Usage:
#   POSTGRES_HOST=... POSTGRES_DB=... ./products/captive-portal/scripts/portal-export.sh
#   PORTAL_EXPORT_PROD_APPROVED=1 POSTGRES_HOST=prod ./products/captive-portal/scripts/portal-export.sh
#
# The script never logs the password or any guest data.

set -euo pipefail

TABLES=(portal_authorization portal_rate_limit)

: "${POSTGRES_HOST:?POSTGRES_HOST must be set}"
: "${POSTGRES_DB:?POSTGRES_DB must be set}"
: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
OUTPUT_DIR="${PORTAL_EXPORT_DIR:-/tmp/portal-export}"

# Production guard: refuse to run against production unless approved.
if [[ "${PORTAL_EXPORT_PROD_APPROVED:-0}" != "1" ]]; then
  echo "REHEARSAL MODE: set PORTAL_EXPORT_PROD_APPROVED=1 to confirm human review" >&2
  echo "  checkpoint before running against the production Control Center database." >&2
  echo "  (www-jtp0.5.7 REQUIRES CALUM)" >&2
  if [[ "${POSTGRES_HOST}" == *prod* ]] || [[ "${POSTGRES_HOST}" == homelab* ]]; then
    echo "ERROR: POSTGRES_HOST looks like production. Refusing without PORTAL_EXPORT_PROD_APPROVED=1." >&2
    exit 1
  fi
fi

TIMESTAMP="$(date -u '+%Y%m%dT%H%M%SZ')"
mkdir -p "${OUTPUT_DIR}"

DUMP_FILE="${OUTPUT_DIR}/portal_export_${TIMESTAMP}.dump"
SQL_FILE="${OUTPUT_DIR}/portal_export_${TIMESTAMP}.sql.gz"

TABLE_ARGS=()
for t in "${TABLES[@]}"; do
  TABLE_ARGS+=("-t" "${t}")
done

echo "Exporting portal tables from ${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
echo "Tables: ${TABLES[*]}"
echo "Output: ${OUTPUT_DIR}"

# pg_dump: custom format (binary, efficient, supports pg_restore --section)
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
  --host="${POSTGRES_HOST}" \
  --port="${POSTGRES_PORT}" \
  --username="${POSTGRES_USER}" \
  --dbname="${POSTGRES_DB}" \
  --format=custom \
  --no-acl \
  --no-owner \
  "${TABLE_ARGS[@]}" \
  --file="${DUMP_FILE}"

echo "Custom dump written: ${DUMP_FILE}"

# Plain SQL gzip: human-readable, for audit and rollback reference.
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
  --host="${POSTGRES_HOST}" \
  --port="${POSTGRES_PORT}" \
  --username="${POSTGRES_USER}" \
  --dbname="${POSTGRES_DB}" \
  --format=plain \
  --no-acl \
  --no-owner \
  "${TABLE_ARGS[@]}" \
  | gzip > "${SQL_FILE}"

echo "SQL gzip written: ${SQL_FILE}"

# Row counts (for validation; no guest data printed).
echo ""
echo "Row counts in source:"
for t in "${TABLES[@]}"; do
  COUNT="$(PGPASSWORD="${POSTGRES_PASSWORD}" psql \
    --host="${POSTGRES_HOST}" \
    --port="${POSTGRES_PORT}" \
    --username="${POSTGRES_USER}" \
    --dbname="${POSTGRES_DB}" \
    --tuples-only \
    --command="SELECT COUNT(*) FROM ${t};")"
  echo "  ${t}: ${COUNT// /}"
done

echo ""
echo "Export complete. ROLLBACK NOTE: keep the source database untouched until soak completes."
