#!/usr/bin/env bash
# Product CNPG local-name migration cleanup preflight (www-0y64.2).
#
# This guard is intentionally narrow: it never creates, restores, switches, or
# deletes Kubernetes resources. Run it immediately before OLD cluster/PVC cleanup
# after a product DB has moved from a product-slug CNPG Cluster to the local
# `postgres` CNPG Cluster name. It exits non-zero until validation evidence exists.
#
# Expected evidence directory:
#   source-counts.tsv   row counts from the old cluster before switch
#   target-counts.tsv   row counts from the new postgres cluster after restore
#   schema.diff         diff of old vs new schema-only dumps, expected empty
#   smoke.txt           post-switch smoke output, must contain PASS and no FAIL
#   soak.txt            soak record, must contain SOAK COMPLETE
#
# It NEVER reads or prints secret values.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPARE_SCRIPT="$ROOT_DIR/scripts/pg-snapshot-restore.sh"

PRODUCT="${CNPG_MIGRATION_PRODUCT:-}"
NAMESPACE="${CNPG_MIGRATION_NAMESPACE:-}"
OLD_CLUSTER="${CNPG_OLD_CLUSTER:-}"
NEW_CLUSTER="${CNPG_NEW_CLUSTER:-postgres}"
EVIDENCE_DIR="${CNPG_LOCAL_NAME_EVIDENCE_DIR:-}"
APPROVED="${CNPG_CLEANUP_APPROVED:-}"

err() { printf '[cnpg-local-name-preflight] BLOCK: %s\n' "$1" >&2; }
ok() { printf '[cnpg-local-name-preflight] ok: %s\n' "$1"; }

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '2,80p' "$0" | sed -n 's/^# \{0,1\}//p'
  cat <<'USAGE'

Required environment:
  CNPG_MIGRATION_PRODUCT       Product slug, e.g. captive-portal or control-center.
  CNPG_MIGRATION_NAMESPACE     Kubernetes namespace that owns both clusters.
  CNPG_OLD_CLUSTER             Existing product-slug CNPG Cluster to keep until cleanup.
  CNPG_NEW_CLUSTER             New local-name CNPG Cluster. Defaults to postgres.
  CNPG_LOCAL_NAME_EVIDENCE_DIR Directory containing validation evidence files.
  CNPG_CLEANUP_APPROVED        Must be exactly "yes" after human review.

Exit 0 only when the cleanup evidence is complete. This script performs no cleanup.
USAGE
  exit 0
fi

fail=0

if [ -z "$PRODUCT" ]; then
  err "CNPG_MIGRATION_PRODUCT unset"; fail=1
else
  ok "product: $PRODUCT"
fi

if [ -z "$NAMESPACE" ]; then
  err "CNPG_MIGRATION_NAMESPACE unset"; fail=1
else
  ok "namespace: $NAMESPACE"
fi

if [ -z "$OLD_CLUSTER" ]; then
  err "CNPG_OLD_CLUSTER unset"; fail=1
elif [ "$OLD_CLUSTER" = "$NEW_CLUSTER" ]; then
  err "CNPG_OLD_CLUSTER must differ from CNPG_NEW_CLUSTER"; fail=1
else
  ok "old cluster preserved for rollback: $OLD_CLUSTER"
fi

if [ -z "$NEW_CLUSTER" ]; then
  err "CNPG_NEW_CLUSTER unset"; fail=1
else
  ok "new cluster: $NEW_CLUSTER"
fi

if [ -z "$EVIDENCE_DIR" ] || [ ! -d "$EVIDENCE_DIR" ]; then
  err "CNPG_LOCAL_NAME_EVIDENCE_DIR missing or not a directory"; fail=1
else
  ok "evidence dir: $EVIDENCE_DIR"
fi

source_counts="$EVIDENCE_DIR/source-counts.tsv"
target_counts="$EVIDENCE_DIR/target-counts.tsv"
schema_diff="$EVIDENCE_DIR/schema.diff"
smoke_report="$EVIDENCE_DIR/smoke.txt"
soak_report="$EVIDENCE_DIR/soak.txt"

if [ -d "${EVIDENCE_DIR:-/dev/null}" ]; then
  if [ ! -s "$source_counts" ]; then
    err "missing source row counts: $source_counts"; fail=1
  fi
  if [ ! -s "$target_counts" ]; then
    err "missing target row counts: $target_counts"; fail=1
  fi
  if [ -s "$source_counts" ] && [ -s "$target_counts" ]; then
    if "$COMPARE_SCRIPT" --compare-counts "$source_counts" "$target_counts" >/dev/null; then
      ok "source and target row counts match"
    else
      err "row-count comparison failed; old cluster cleanup refused"; fail=1
    fi
  fi

  if [ ! -e "$schema_diff" ]; then
    err "missing schema diff evidence: $schema_diff"; fail=1
  elif [ -s "$schema_diff" ]; then
    err "schema diff is non-empty; old cluster cleanup refused"; fail=1
  else
    ok "schema diff present and empty"
  fi

  if [ ! -s "$smoke_report" ]; then
    err "missing post-switch smoke report: $smoke_report"; fail=1
  elif grep -q 'FAIL' "$smoke_report"; then
    err "smoke report contains FAIL; old cluster cleanup refused"; fail=1
  elif ! grep -q 'PASS' "$smoke_report"; then
    err "smoke report does not contain PASS evidence"; fail=1
  else
    ok "smoke report passed"
  fi

  if [ ! -s "$soak_report" ]; then
    err "missing soak report: $soak_report"; fail=1
  elif ! grep -q 'SOAK COMPLETE' "$soak_report"; then
    err "soak report does not record SOAK COMPLETE"; fail=1
  else
    ok "soak completion recorded"
  fi
fi

if [ "$APPROVED" != "yes" ]; then
  err "CNPG_CLEANUP_APPROVED is not \"yes\" (explicit human approval required)"; fail=1
else
  ok "cleanup approval recorded"
fi

if [ "$fail" -ne 0 ]; then
  printf '[cnpg-local-name-preflight] NOT READY: keep the old cluster and PVCs.\n' >&2
  exit 1
fi

printf '[cnpg-local-name-preflight] READY: cleanup evidence is complete.\n'
printf '[cnpg-local-name-preflight] Safe to execute the documented old-cluster cleanup commands.\n'
