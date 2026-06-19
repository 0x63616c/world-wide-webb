#!/usr/bin/env bash
# Portal data import script (www-jtp0.5.6).
#
# Imports the current portal tables into Captive Portal Postgres from a
# pg_dump custom-format file produced by portal-export.sh.
#
# REQUIRES CALUM - production import (www-jtp0.5.7):
#   Running against the production Captive Portal database requires explicit
#   approval. Set PORTAL_IMPORT_PROD_APPROVED=1 to confirm the human review
#   checkpoint and that the rehearsal passed.
#
# For rehearsal against a scratch database, do NOT set PORTAL_IMPORT_PROD_APPROVED.
#
# Usage:
#   DUMP_FILE=portal_export_20260614T120000Z.dump \
#   POSTGRES_HOST=... POSTGRES_DB=... \
#   ./products/captive-portal/scripts/portal-import.sh
#
# The script never logs the password or any guest data.

set -euo pipefail

TABLES=(portal_authorization portal_rate_limit)

: "${POSTGRES_HOST:?POSTGRES_HOST must be set}"
: "${POSTGRES_DB:?POSTGRES_DB must be set}"
: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"
: "${DUMP_FILE:?DUMP_FILE must be set (path to the .dump file from portal-export.sh)}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"

if [[ ! -f "${DUMP_FILE}" ]]; then
  echo "ERROR: DUMP_FILE not found: ${DUMP_FILE}" >&2
  exit 1
fi

# Production guard: refuse to run against production unless approved.
if [[ "${PORTAL_IMPORT_PROD_APPROVED:-0}" != "1" ]]; then
  echo "REHEARSAL MODE: set PORTAL_IMPORT_PROD_APPROVED=1 to confirm human review" >&2
  echo "  checkpoint before running against the production Captive Portal database." >&2
  echo "  (www-jtp0.5.7 REQUIRES CALUM)" >&2
  if [[ "${POSTGRES_HOST}" == *prod* ]] || [[ "${POSTGRES_HOST}" == homelab* ]]; then
    echo "ERROR: POSTGRES_HOST looks like production. Refusing without PORTAL_IMPORT_PROD_APPROVED=1." >&2
    exit 1
  fi
fi

echo "Importing portal tables into ${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
echo "Tables: ${TABLES[*]}"
echo "Dump: ${DUMP_FILE}"

# pg_restore: restore only data (not schema - schema is managed by Drizzle migrations).
PGPASSWORD="${POSTGRES_PASSWORD}" pg_restore \
  --host="${POSTGRES_HOST}" \
  --port="${POSTGRES_PORT}" \
  --username="${POSTGRES_USER}" \
  --dbname="${POSTGRES_DB}" \
  --data-only \
  --disable-triggers \
  "${DUMP_FILE}"

echo ""
echo "Import complete. Row counts in destination:"
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
echo "Validation: compare row counts above against portal-export.sh output."
echo "Then run portal-validate.sh for semantic checks."
echo ""
echo "ROLLBACK NOTE: keep the source database untouched until soak completes."
