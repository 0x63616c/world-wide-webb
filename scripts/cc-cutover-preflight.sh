#!/usr/bin/env bash
# Control Center production cutover preflight gate (www-jtp0.7.7).
#
# The cutover (www-jtp0.7.7) is the P0 step that moves production data into the
# product CNPG cluster. It is irreversible-ish (rollback exists but costs a second
# window), so it MUST NOT start until every safety input is present. This script
# is the red-first gate: it exits NON-ZERO until the operator supplies all of:
#
#   - a proven restore rehearsal (www-jtp0.7.6) artifact,
#   - the final pre-cutover snapshot files (custom-format + plain gzip),
#   - recorded source row counts to compare against post-restore,
#   - the semantic-check SQL present (scripts/cc-cutover-semantic-checks.sql),
#   - a named rollback target (old DB host + auth secret) to fall back to,
#   - an explicit human approval flag.
#
# It NEVER reads or prints a secret value. It validates presence + shape only.
# Pass `--help` for the full input contract.

set -euo pipefail

# --- required inputs (env, so nothing sensitive lands in shell history args) ---
REHEARSAL_REPORT="${CC_REHEARSAL_REPORT:-}"        # path to a completed www-jtp0.7.6 rehearsal report
SNAPSHOT_DIR="${CC_SNAPSHOT_DIR:-}"                 # dir holding final pre-cutover dumps
SOURCE_COUNTS="${CC_SOURCE_COUNTS:-}"              # tsv of source row counts (pg-snapshot-restore.sh output)
ROLLBACK_DB_HOST="${CC_ROLLBACK_DB_HOST:-}"        # old DB host to roll back to (e.g. the pre-CNPG host)
ROLLBACK_AUTH_SECRET="${CC_ROLLBACK_AUTH_SECRET:-}" # name of the old auth secret (NOT its value)
APPROVED="${CC_CUTOVER_APPROVED:-}"                # must be exactly "yes" (human gate)

SEMANTIC_SQL="$(cd "$(dirname "$0")" && pwd)/cc-cutover-semantic-checks.sql"
DATABASE="${DATABASE:-control_center}"

err() { printf '[cutover-preflight] BLOCK: %s\n' "$1" >&2; }
ok() { printf '[cutover-preflight] ok: %s\n' "$1"; }

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,40p' "$0" | sed -n 's/^# \{0,1\}//p'
  cat <<'USAGE'

Required environment:
  CC_REHEARSAL_REPORT    Path to the completed restore-rehearsal report (www-jtp0.7.6).
  CC_SNAPSHOT_DIR        Directory containing the final dumps:
                           $DATABASE.dump  (pg_dump -Fc, restore source of truth)
                           $DATABASE.sql.gz (pg_dump --format=plain | gzip, human-readable backup)
  CC_SOURCE_COUNTS       TSV of pre-cutover source row counts
                           (scripts/pg-snapshot-restore.sh writes source-counts.tsv).
  CC_ROLLBACK_DB_HOST    Hostname of the OLD database to roll back to on failure.
  CC_ROLLBACK_AUTH_SECRET Name (not value) of the old auth secret.
  CC_CUTOVER_APPROVED    Must be exactly "yes" (human approval gate).

Exit 0 only when ALL inputs are present and valid. Otherwise lists every gap.
USAGE
  exit 0
fi

fail=0

# 1. Rehearsal proof must exist and be non-empty.
if [ -z "$REHEARSAL_REPORT" ] || [ ! -s "$REHEARSAL_REPORT" ]; then
  err "CC_REHEARSAL_REPORT missing or empty (run the www-jtp0.7.6 rehearsal first)"; fail=1
else
  ok "rehearsal report present: $REHEARSAL_REPORT"
fi

# 2. Final snapshot files must exist (both formats).
if [ -z "$SNAPSHOT_DIR" ] || [ ! -d "$SNAPSHOT_DIR" ]; then
  err "CC_SNAPSHOT_DIR missing or not a directory"; fail=1
else
  for f in "$DATABASE.dump" "$DATABASE.sql.gz"; do
    if [ ! -s "$SNAPSHOT_DIR/$f" ]; then
      err "final snapshot missing/empty: $SNAPSHOT_DIR/$f"; fail=1
    else
      ok "snapshot present: $SNAPSHOT_DIR/$f"
    fi
  done
fi

# 3. Recorded source counts to compare post-restore.
if [ -z "$SOURCE_COUNTS" ] || [ ! -s "$SOURCE_COUNTS" ]; then
  err "CC_SOURCE_COUNTS missing or empty (capture source row counts before freeze)"; fail=1
else
  ok "source row counts recorded: $SOURCE_COUNTS"
fi

# 4. Semantic-check SQL must be present (identical file used at rehearsal + cutover).
if [ ! -s "$SEMANTIC_SQL" ]; then
  err "semantic-check SQL missing: $SEMANTIC_SQL"; fail=1
else
  ok "semantic-check SQL present: $SEMANTIC_SQL"
fi

# 5. Rollback target must be named (host + secret name).
if [ -z "$ROLLBACK_DB_HOST" ]; then
  err "CC_ROLLBACK_DB_HOST unset (name the old DB host to roll back to)"; fail=1
else
  ok "rollback DB host: $ROLLBACK_DB_HOST"
fi
if [ -z "$ROLLBACK_AUTH_SECRET" ]; then
  err "CC_ROLLBACK_AUTH_SECRET unset (name the old auth secret, NOT its value)"; fail=1
else
  ok "rollback auth secret name: $ROLLBACK_AUTH_SECRET"
fi

# 6. Human approval, last so the operator sees every other gap first.
if [ "$APPROVED" != "yes" ]; then
  err "CC_CUTOVER_APPROVED is not \"yes\" (explicit human approval required)"; fail=1
else
  ok "human approval recorded"
fi

if [ "$fail" -ne 0 ]; then
  printf '[cutover-preflight] NOT READY: resolve the BLOCKs above. Cutover refused.\n' >&2
  exit 1
fi

printf '[cutover-preflight] READY: all cutover preconditions satisfied.\n'
printf '[cutover-preflight] Proceed with docs/k3s-migration/cc-cutover-runbook.md.\n'
