# Production logs and health

The Mac mini uses rotated Docker container logs. There is no replacement
Grafana, Prometheus or Loki stack and no new health alerts.

```sh
ssh homelab '/opt/homebrew/bin/docker --context orbstack logs --tail 100 www-control-center-www-1'
ssh homelab 'curl -fsS http://127.0.0.1:4201/healthz'
```

`/healthz` reports database connectivity, shutdown state, cycle ownership and
per-worker failure counts. The Compose healthcheck uses this endpoint. App and
PostgreSQL logs rotate at 10 MB with three files per container. Browser and
physical-panel issues still require browser inspection or local reproduction.
Never print runtime environment files or secret mounts while debugging.

The existing Hindsight healthcheck and OrbStack watchdog remain independent;
this migration introduced no notification channel. Backup exit status is visible
in launchd and its local logs; see [mini backups](runbooks/mini-backups.md).

The retired monitoring stack's final archive is on the NAS at
`/Homelab/backups/mac-mini/monitoring-final-20261103/monitoring-final-20261103.tar.gz`.
Its SHA-256 is `b057a37fe45fc8c1ae4074a729becbdc818ffb272eddfe39f085472cd52458d6`.
The archive passed a complete tar read and NAS read-back verification. Original
Talos volumes are retained. Historical provisioning and dashboard definitions
remain in Git history before the retirement cleanup.
