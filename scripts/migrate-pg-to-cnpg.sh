#!/usr/bin/env bash
# Postgres data migration: Swarm postgres -> CNPG (www-j934.8).
#
# Implements the DESIGN §4 8-step runbook (docs/k3s-migration/DESIGN.md). Hard
# constraint (GOAL boundary 2): downtime OK, SILENT DATA DIVERGENCE IS NOT. The
# old Swarm `pgdata` volume is NEVER touched by this script; it is the rollback
# artifact and is preserved verbatim. The proof is a per-table count(*) captured
# from the source BEFORE the dump and from CNPG AFTER the restore, compared
# side by side; ANY mismatch fails the script loudly with a non-zero exit.
#
# Counts cover EVERY non-system schema, schema-qualified, so the `drizzle`
# schema's `__drizzle_migrations` ledger is in the proof too (a public-only list
# would silently pass a divergence there). Counts are exact `count(*)`, never
# the pg_stat_user_tables estimate.
#
# Source (Swarm):  ssh homelab -> docker exec <postgres task> -> psql
#   DB control_center, user postgres, image postgres:17-alpine.
# Target (CNPG):   kubectl --context $KUBE_CONTEXT -n $CNPG_NS exec primary -> psql
#   CNPG Cluster `control-center` in namespace control-center.
#
# Idempotency: every step is safe to re-run. The dump file is timestamped and
# never overwritten in place; the restore drops+recreates ONLY the CNPG target
# DB (the source is read-only throughout). Re-running --verify alone re-compares.
#
# Usage:
#   scripts/migrate-pg-to-cnpg.sh --dry-run         # print every step, touch nothing
#   scripts/migrate-pg-to-cnpg.sh --counts-only     # source+target counts + diff, read-only
#   scripts/migrate-pg-to-cnpg.sh                    # full runbook (PROMPTS before writes)
#   scripts/migrate-pg-to-cnpg.sh --yes             # full runbook, no prompts (automation)
#
# Env overrides (all have safe defaults):
#   SSH_HOST=homelab  KUBE_CONTEXT=cc-homelab  CNPG_NS=control-center
#   CNPG_CLUSTER=control-center  PGDB=control_center  PGUSER=postgres
#   DUMP_DIR=./.pg-migration  (dump artifact lives OUTSIDE any pgdata volume)
#
# NO secrets are ever printed: psql runs inside the source container / CNPG pod
# using their own in-container env (PGPASSWORD / CNPG-provisioned creds); this
# script never reads, echoes, or passes a password value.

set -euo pipefail

# ---------------------------------------------------------------------------
# Config (env-overridable)
# ---------------------------------------------------------------------------
SSH_HOST="${SSH_HOST:-homelab}"
KUBE_CONTEXT="${KUBE_CONTEXT:-cc-homelab}"
CNPG_NS="${CNPG_NS:-control-center}"
CNPG_CLUSTER="${CNPG_CLUSTER:-control-center}"
PGDB="${PGDB:-control_center}"
PGUSER="${PGUSER:-postgres}"
DUMP_DIR="${DUMP_DIR:-./.pg-migration}"

# Swarm writer services scaled to 0 in step 1 (in this order). media-worker and
# drizzle may already be 0/0; scaling an already-0 service is a no-op.
SWARM_WRITERS=(control-center_api control-center_worker control-center_media-worker control-center_drizzle)

DRY_RUN=0
COUNTS_ONLY=0
ASSUME_YES=0

for arg in "$@"; do
  case "$arg" in
    --dry-run)     DRY_RUN=1 ;;
    --counts-only) COUNTS_ONLY=1 ;;
    --yes|-y)      ASSUME_YES=1 ;;
    -h|--help)     grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $arg (try --help)" >&2; exit 2 ;;
  esac
done

TS="$(date +%Y%m%d-%H%M%S)"
DUMP_FILE="${DUMP_DIR}/${PGDB}-${TS}.dump"
SRC_COUNTS="${DUMP_DIR}/source-counts-${TS}.tsv"
DST_COUNTS="${DUMP_DIR}/cnpg-counts-${TS}.tsv"

log()  { printf '\033[1;36m[migrate %s]\033[0m %s\n' "$(date +%H:%M:%S)" "$*"; }
warn() { printf '\033[1;33m[migrate %s] WARN:\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; }
die()  { printf '\033[1;31m[migrate %s] FATAL:\033[0m %s\n' "$(date +%H:%M:%S)" "$*" >&2; exit 1; }

# run / show a command depending on --dry-run. Use for STATE-CHANGING commands.
do_or_echo() {
  if [[ "$DRY_RUN" == 1 ]]; then
    printf '\033[2m  would run:\033[0m %s\n' "$*"
  else
    "$@"
  fi
}

confirm() {
  [[ "$ASSUME_YES" == 1 || "$DRY_RUN" == 1 ]] && return 0
  local reply
  read -r -p "  >> $1 [y/N] " reply
  [[ "$reply" == "y" || "$reply" == "Y" ]]
}

# ---------------------------------------------------------------------------
# Connection plumbing (read paths are always live, even under --dry-run)
# ---------------------------------------------------------------------------

# Resolve the Swarm postgres task container id on the host (name carries a
# random suffix, so resolve it live rather than hardcoding).
src_container() {
  ssh -o ConnectTimeout=10 -o BatchMode=yes "$SSH_HOST" \
    'docker ps --filter name=control-center_postgres --format "{{.Names}}" | head -n1'
}

# Run a psql command inside the SOURCE (Swarm) postgres container. Read-only by
# construction here: callers only ever pass SELECTs / pg_dump. Uses the
# container's own env for auth (no password crosses this script).
src_psql() {
  local sql="$1" cid
  cid="$(src_container)"
  [[ -n "$cid" ]] || die "could not find a running control-center_postgres task on $SSH_HOST"
  ssh -o ConnectTimeout=10 -o BatchMode=yes "$SSH_HOST" \
    "docker exec -i '$cid' psql -U '$PGUSER' -d '$PGDB' -At -F'|' -c \"$sql\""
}

# Resolve the CNPG PRIMARY pod for the cluster (read-only kubectl).
cnpg_primary() {
  kubectl --context "$KUBE_CONTEXT" -n "$CNPG_NS" get pods \
    -l "cnpg.io/cluster=${CNPG_CLUSTER},cnpg.io/instanceRole=primary" \
    -o jsonpath='{.items[0].metadata.name}' 2>/dev/null
}

# Run a psql command inside the CNPG primary pod (container `postgres`). CNPG
# wires local trust / its own creds in-pod, so no password is handled here.
dst_psql() {
  local sql="$1" pod
  pod="$(cnpg_primary)"
  [[ -n "$pod" ]] || die "no CNPG primary pod for cluster $CNPG_CLUSTER in ns $CNPG_NS (context $KUBE_CONTEXT)"
  kubectl --context "$KUBE_CONTEXT" -n "$CNPG_NS" exec -i "$pod" -c postgres -- \
    psql -U "$PGUSER" -d "$PGDB" -At -F'|' -c "$sql"
}

# The single source of truth for "what to count": every non-system schema,
# schema-qualified, ordered deterministically. Both sides run the SAME SQL so
# the table SET itself is compared, not just the rows (a table present on one
# side and absent on the other shows up as a count diff / missing row).
COUNT_SQL=$(cat <<'SQL'
SELECT n.nspname || '.' || c.relname AS qname,
       (xpath('/row/c/text()',
         query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname),
                      false, true, '')))[1]::text::bigint AS rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_temp%'
ORDER BY qname
SQL
)

# ---------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------

step1_quiesce() {
  log "STEP 1/8: quiesce Swarm writers (scale to 0): ${SWARM_WRITERS[*]}"
  log "          postgres itself stays UP; this only stops writers so counts are stable."
  for svc in "${SWARM_WRITERS[@]}"; do
    do_or_echo ssh -o ConnectTimeout=10 -o BatchMode=yes "$SSH_HOST" "docker service scale ${svc}=0"
  done
}

step2_source_counts() {
  log "STEP 2/8: capture SOURCE counts (exact count(*), all schemas) -> $SRC_COUNTS"
  mkdir -p "$DUMP_DIR"
  # Always live (read-only); we WANT the real numbers even on a dry run.
  src_psql "$COUNT_SQL" | sort > "$SRC_COUNTS"
  log "          source tables: $(wc -l < "$SRC_COUNTS" | tr -d ' ')"
  sed 's/^/            /' "$SRC_COUNTS"
}

step3_dump() {
  log "STEP 3/8: pg_dump -Fc $PGDB from Swarm postgres -> $DUMP_FILE (off the pgdata volume)"
  if [[ "$DRY_RUN" == 1 ]]; then
    printf '\033[2m  would run:\033[0m ssh %s docker exec <pg> pg_dump -Fc %s > %s\n' "$SSH_HOST" "$PGDB" "$DUMP_FILE"
    return 0
  fi
  local cid; cid="$(src_container)"
  [[ -n "$cid" ]] || die "no source postgres container for dump"
  # Stream the custom-format dump back over ssh into a file on THIS host. The
  # pgdata volume is never written; the dump lands in $DUMP_DIR only.
  mkdir -p "$DUMP_DIR"
  ssh -o ConnectTimeout=10 -o BatchMode=yes "$SSH_HOST" \
    "docker exec -i '$cid' pg_dump -U '$PGUSER' -d '$PGDB' -Fc" > "$DUMP_FILE"
  [[ -s "$DUMP_FILE" ]] || die "dump file is empty: $DUMP_FILE"
  log "          dump size: $(du -h "$DUMP_FILE" | cut -f1)"
}

step4_cnpg_ready() {
  log "STEP 4/8: confirm CNPG cluster is up and the target DB exists"
  if [[ "$DRY_RUN" == 1 ]]; then
    printf '\033[2m  would run:\033[0m kubectl --context %s -n %s get cluster %s\n' "$KUBE_CONTEXT" "$CNPG_NS" "$CNPG_CLUSTER"
    return 0
  fi
  local pod; pod="$(cnpg_primary)"
  [[ -n "$pod" ]] || die "CNPG primary not ready; bring the cluster Running first (www-j934.5)"
  log "          CNPG primary pod: $pod"
}

step5_restore() {
  log "STEP 5/8: restore the dump into CNPG (drop+recreate the target DB first; SOURCE untouched)"
  if [[ "$DRY_RUN" == 1 ]]; then
    printf '\033[2m  would run:\033[0m kubectl cp %s -> primary; pg_restore --clean --create into CNPG\n' "$DUMP_FILE"
    return 0
  fi
  [[ -s "$DUMP_FILE" ]] || die "no dump to restore (run without --counts-only, or pass an existing --dump)"
  confirm "Restore $DUMP_FILE into CNPG cluster '$CNPG_CLUSTER' (overwrites the CNPG '$PGDB' DB)?" \
    || die "aborted at restore by operator"
  local pod; pod="$(cnpg_primary)"
  # Copy the dump into the pod, then pg_restore with --clean --if-exists so a
  # re-run is idempotent (drops existing objects in the target before recreating).
  kubectl --context "$KUBE_CONTEXT" -n "$CNPG_NS" cp "$DUMP_FILE" "${pod}:/tmp/restore.dump" -c postgres
  kubectl --context "$KUBE_CONTEXT" -n "$CNPG_NS" exec -i "$pod" -c postgres -- \
    pg_restore -U "$PGUSER" -d "$PGDB" --clean --if-exists --no-owner --no-acl /tmp/restore.dump
  kubectl --context "$KUBE_CONTEXT" -n "$CNPG_NS" exec -i "$pod" -c postgres -- rm -f /tmp/restore.dump
}

step6_verify() {
  log "STEP 6/8: capture CNPG counts and DIFF against source (FAILS LOUDLY on any mismatch)"
  if [[ "$DRY_RUN" == 1 ]]; then
    printf '\033[2m  would run:\033[0m capture CNPG count(*) (all schemas) and diff vs source; die non-zero on ANY mismatch\n'
    return 0
  fi
  mkdir -p "$DUMP_DIR"
  [[ -s "$SRC_COUNTS" ]] || die "no source counts file ($SRC_COUNTS); run step 2 first"
  dst_psql "$COUNT_SQL" | sort > "$DST_COUNTS"

  log "          side-by-side (table | source | cnpg):"
  # Full outer join on table name so a table present on only ONE side is shown.
  join -t'|' -a1 -a2 -e 'MISSING' -o '0,1.2,2.2' "$SRC_COUNTS" "$DST_COUNTS" \
    | awk -F'|' '{printf "            %-45s %12s %12s%s\n", $1, $2, $3, ($2==$3?"":"   <-- MISMATCH")}'

  if diff -q "$SRC_COUNTS" "$DST_COUNTS" >/dev/null; then
    log "          COUNTS IDENTICAL across all schemas/tables. Data proof PASSED."
  else
    warn "COUNT MISMATCH. Source and CNPG differ. Migration is NOT verified."
    warn "Source: $SRC_COUNTS   CNPG: $DST_COUNTS"
    die "data divergence detected; DO NOT cut over. Source + pgdata are intact, investigate."
  fi
}

step7_preserve_source() {
  log "STEP 7/8: confirm the Swarm pgdata volume is PRESERVED (rollback artifact, never deleted)"
  local vols
  vols="$(ssh -o ConnectTimeout=10 -o BatchMode=yes "$SSH_HOST" 'docker volume ls --format "{{.Name}}" | grep -i pgdata || true')"
  if [[ -n "$vols" ]]; then
    log "          pgdata volume(s) still present:"
    echo "$vols" | sed 's/^/            /'
  else
    warn "no pgdata-named volume found on $SSH_HOST. Verify manually before any teardown."
  fi
}

step8_note() {
  log "STEP 8/8: point app at CNPG: NOT done here."
  log "          Repointing api/worker to the CNPG Service + scaling writers on k3s is the"
  log "          cutover (DESIGN §7 / www-j934.9). This script's job ends at a VERIFIED restore."
}

# ---------------------------------------------------------------------------
# Drivers
# ---------------------------------------------------------------------------

run_counts_only() {
  log "MODE: --counts-only (read-only; captures source + CNPG counts and diffs them)"
  step2_source_counts
  if [[ -n "$(cnpg_primary 2>/dev/null || true)" ]]; then
    step6_verify
  else
    warn "CNPG primary not reachable yet; captured SOURCE counts only ($SRC_COUNTS)."
  fi
}

run_full() {
  [[ "$DRY_RUN" == 1 ]] && log "MODE: --dry-run (read paths live; no state-changing command runs)"
  step1_quiesce
  step2_source_counts
  step3_dump
  step4_cnpg_ready
  step5_restore
  step6_verify
  step7_preserve_source
  step8_note
  log "DONE. Restore verified by identical per-table counts. Source + pgdata preserved."
  log "Cutover (app repoint, Swarm teardown) is a separate, deliberate step (www-j934.9)."
}

if [[ "$COUNTS_ONLY" == 1 ]]; then
  run_counts_only
else
  run_full
fi
