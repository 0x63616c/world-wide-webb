# Production logs and health

The Mac mini uses rotated Docker container logs. There is no replacement
Grafana, Prometheus or Loki stack and no new health alerts.

```sh
ssh homelab '/opt/homebrew/bin/docker --context orbstack logs --tail 100 www-control-center-www-1'
ssh homelab 'curl -fsS http://127.0.0.1:4202/healthz'
```

`/healthz` reports database connectivity, shutdown state, cycle ownership and
per-worker failure counts. SQLite failures include only a numeric extended
`sqlite_code` (no SQL, bound values or row contents). Dead/stalled workers and repeated
worker storage failures fail readiness and cause process exit for container recovery;
transient external-integration errors do not restart the app. See
[worker recovery](runbooks/control-center-history.md#worker-recovery). The Compose healthcheck uses this endpoint. App and
retained PostgreSQL logs rotate at 10 MB with three files per container. Browser and
physical-panel issues still require browser inspection or local reproduction.
Never print runtime environment files or secret mounts while debugging.

The existing Hindsight healthcheck and OrbStack watchdog remain independent;
this migration introduced no notification channel. Backup exit status is visible
in launchd and its local logs; see [mini backups](runbooks/mini-backups.md).

Tunnel connectivity is checked separately every 30 seconds by
`com.calum.tunnel-recovery`. A running container can still have no Cloudflare
connections. After a two-minute startup grace and three failed local `/ready`
checks, recovery restarts only that tunnel container, with a five-minute cooldown.
It leaves stopped or paused containers alone and adds no notifications.
See [tunnel recovery](runbooks/tunnel-recovery.md) for deployment, logs and maintenance.

The retired monitoring stack's final archive is on the NAS at
`/Homelab/backups/mac-mini/monitoring-final-20261103/monitoring-final-20261103.tar.gz`.
Its SHA-256 is `b057a37fe45fc8c1ae4074a729becbdc818ffb272eddfe39f085472cd52458d6`.
The archive passed a complete tar read and NAS read-back verification. Original
Talos volumes are retained. Historical provisioning and dashboard definitions
remain in Git history before the retirement cleanup.
