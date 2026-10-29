# Postgres backup overdue

`PostgresBackupOverdue` fires separately for `control-center/pg-backup` and
`home-assistant/home-assistant-pg-backup` after 26 hours without success. It uses
kube-state-metrics' persistent CronJob last-success timestamp, independent of
Job history pruning and pod restarts. A never-successful CronJob gets 26 hours
from creation. A missing CronJob or scrape data fires immediately: inspect the
kube-state-metrics target as well as the CronJob. Alerts are visible in Prometheus
and Grafana Explore (`ALERTS{alertname="PostgresBackupOverdue"}`); no notification
receiver is configured in this stack.

Start with Grafana's Loki logs for the backup pod. Check Job events if it never
started. The jobs forbid overlap, expire after 1800 seconds, and retry once.
An old Job created before those settings may still require operator cleanup.

The CNPG image runs as UID 26. Both storage modes use UID/GID/fsGroup 26;
kubelet makes new local-lvm volumes group-writable. NFS does not implement the
same ownership repair: before restoring NAS mode, grant UID/GID 26 write access
to both backup directories on the NAS (including its ACLs/root-squash policy).
Do not disable root squash or run the backup as root to bypass permissions.

With `nasEnabled=false`, each namespace writes to its 5Gi local-lvm fallback
PVC. It shares the database SSD and does not protect against disk loss. The NAS
setting is intentionally unchanged by this fix. Fallback dumps older than three
days are pruned only after a verified backup is published.

The script writes a `.partial` file, checks the gzip checksum, reads the whole
decompressed stream, and requires `-- PostgreSQL database dump complete` as its
final non-empty line. It also requires at least 1024 SQL bytes for control-center
and 512 for Home Assistant: HA has no user tables until recorder cutover, so a
complete empty-schema dump is about 720 bytes. Only then does it rename the file
to the dated `.sql.gz` name. Failed runs
remove their partial file and cannot replace a previously verified dump. SIGKILL
or node loss can leave a partial file; inspect and remove these during recovery.
These cheap checks detect empty/truncated output; they do not prove restorability.

## Operator verification after deploy

1. Start a fresh Job from each CronJob and confirm it completes on the fallback
   PVC. Confirm logs report `verified` and the expected dump path and SQL size.
2. Copy each dump out and run `gzip -t`. Restore with `gzip -dc dump.sql.gz |
   psql -v ON_ERROR_STOP=1 ...` into an isolated disposable PostgreSQL 18 database
   with the required roles/extensions. Check expected tables and representative
   row counts. Never restore a smoke test over a live database.
3. Confirm each CronJob's last-success timestamp advances and its alert clears.
   Exercise the alert rule with an old timestamp or Prometheus rule tests;
   never interrupt production backups to test an alert.
4. When the NAS is ready, repair stale mounts and check directory permissions,
   copy verified fallback dumps to it, then separately enable NAS mode and
   verify another fresh backup and restore.
