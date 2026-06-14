# Control Center production data cutover runbook (www-jtp0.7.7)

The P0 step of M7: move **production** Control Center data into the product-owned
CNPG cluster (`control-center` / db `control_center`), with row-count AND semantic
validation, a final snapshot, and a rollback target at every step. This is the
production-data flavor of the generic Swarm→CNPG migration in
[`DESIGN.md` §4](./DESIGN.md); it adds the M7 safety gates and the semantic checks.

**Hard rule (GOAL boundary 2):** downtime is OK, silent data divergence is NOT.
The old database/PVC and all final dumps are preserved untouched until Calum
explicitly says otherwise. Nothing here runs without `CC_CUTOVER_APPROVED=yes`.

## Tooling this runbook drives

| Tool | Purpose |
|---|---|
| `scripts/pg-snapshot-restore.sh` | dump + scratch restore + side-by-side per-table row counts (refuses `production`/`control-center` as scratch) |
| `scripts/cc-cutover-semantic-checks.sql` | semantic validation run IDENTICALLY on source + restored DB, then diffed |
| `scripts/cc-cutover-preflight.sh` | red-first gate: refuses cutover until rehearsal, snapshots, counts, rollback target, and approval are all present |
| `scripts/cc-post-cutover-smoke.sh` | post-cutover stack health (www-jtp0.7.9) |
| `scripts/verify-wall-panel.mjs` | wall-panel verification at 1366×1024 (www-jtp0.7.10) |

## Preconditions (must ALL hold before step 1)

1. **Rehearsal passed** (www-jtp0.7.6): a scratch restore proved row counts match
   and `cc-cutover-semantic-checks.sql` diffs clean. Keep the rehearsal report.
2. **Target provisioned** (www-jtp0.7.5): CNPG `control-center` Running, db
   `control_center`, auth secret `cc-postgres-auth`, rw service `control-center-rw`.
3. **Run the preflight gate** and resolve every BLOCK:
   ```bash
   export CC_REHEARSAL_REPORT=docs/k3s-migration/cc-restore-rehearsal-report.md
   export CC_SNAPSHOT_DIR=./.pg-snapshots
   export CC_SOURCE_COUNTS=./.pg-snapshots/source-counts.tsv
   export CC_ROLLBACK_DB_HOST=<old DB host>
   export CC_ROLLBACK_AUTH_SECRET=<old auth secret name>
   export CC_CUTOVER_APPROVED=yes   # only with Calum's explicit go
   scripts/cc-cutover-preflight.sh   # must print "READY"
   ```

## Cutover steps (rollback noted per step)

| # | Step | Command (shape) | Rollback |
|---|---|---|---|
| 1 | **Write freeze** | scale writers to 0: `kubectl -n control-center scale deploy/api deploy/worker --replicas=0` (media-worker is already parked at 0). Leave CNPG up. | scale writers back to 1 |
| 2 | **Capture source counts** | `OUTPUT_DIR=./.pg-snapshots scripts/pg-snapshot-restore.sh --dry-run --source production` then run for real to write `source-counts.tsv` | read-only |
| 3 | **Source semantic baseline** | `psql -d control_center -f scripts/cc-cutover-semantic-checks.sql > .pg-snapshots/source-semantic.txt` (against the source) | read-only |
| 4 | **Final snapshot (both formats)** | `pg_dump -Fc -d control_center > .pg-snapshots/control_center.dump` AND `pg_dump --format=plain -d control_center \| gzip -c > .pg-snapshots/control_center.sql.gz` | the dumps ARE the rollback artifacts; preserve them |
| 5 | **Restore into product CNPG** | restore `control_center.dump` into the `control-center` cluster (NOT scratch this time, this is the real target) via `pg_restore` in a `kubectl exec`/job | drop+recreate the CNPG db from the preserved dump; source untouched |
| 6 | **Verify row counts** | capture restored counts, then `scripts/pg-snapshot-restore.sh --compare-counts source-counts.tsv restored-counts.tsv` | on ANY mismatch: STOP, do not proceed; source intact |
| 7 | **Verify semantics** | `psql -d control_center -f scripts/cc-cutover-semantic-checks.sql > .pg-snapshots/restored-semantic.txt` against the restored DB, then `diff .pg-snapshots/source-semantic.txt .pg-snapshots/restored-semantic.txt` | on any meaningful diff (lost device intent, dropped heartbeats, orphaned media): STOP |
| 8 | **Point app at product DB** | `POSTGRES_HOST` is already `control-center-rw` in `infra/src/services.ts`, so for prod this is a DATA move, not a code change: scale writers back up against the CNPG db | revert to `CC_ROLLBACK_DB_HOST` + `CC_ROLLBACK_AUTH_SECRET`, redeploy writers there, scale down the CNPG writers |
| 9 | **Roll writers** | `kubectl -n control-center rollout status deploy/api deploy/worker` | as step 8 |
| 10 | **Post-cutover backup proof** | trigger a one-off `pg-backup` job and confirm it completes (the smoke script does this) | n/a |
| 11 | **Smoke** | `scripts/cc-post-cutover-smoke.sh` must pass (www-jtp0.7.9) | if unhealthy, roll back per step 8 |
| 12 | **Wall-panel verify** | `scripts/verify-wall-panel.mjs` at 1366×1024 (www-jtp0.7.10) | n/a |

## Rollback summary

The rollback target is the **old database host + auth secret** named in the preflight
inputs. To roll back after step 8: repoint the writers' DB env to
`CC_ROLLBACK_DB_HOST` / `CC_ROLLBACK_AUTH_SECRET`, redeploy, and scale the CNPG-backed
writers down so the enforcers stop driving actuators against the new DB. The final
dumps in `CC_SNAPSHOT_DIR` and the preserved old DB/PVC are kept until Calum
explicitly approves teardown.

## What stays live

`dashboard.worldwidewebb.co` (the legacy route) and the old DB/PVC remain in place
through cutover and are NOT retired here. Legacy-route retirement is the separate,
human-approved www-jtp0.7.11 step, gated on the wall-panel verification (www-jtp0.7.10).
