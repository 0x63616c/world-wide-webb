# Local candidate: Rust / SQLite cutover

Nothing here changes production until the final approved delivery step.
`compose.rust.yaml` is a candidate; existing `compose.yaml` remains the rollback
manifest. The Rust server owns `/app/data/control-center.sqlite`; mount its complete
host `data/sqlite` directory, not one database file. Existing media path is unchanged.
No app PostgreSQL service is declared in the candidate. Never delete its old volume.

## Freeze and snapshot

Hold all automatic publication gates, drain deployments and suspend the nightly
backup trigger before the cutover. The cutover owner invokes:

```sh
python3 cutover-backup.py snapshot --engine postgres \
  --app-root /Users/calum/www-control-center \
  --destination /Users/calum/homelab-backups/<new-private-snapshot-directory>
```

The destination must not exist and must be outside the app directory. The script
acquires deploy.lock, stops the app writer, creates the PostgreSQL dump and full
media/config archive, and writes archive hashes. It **does not restart the app or
release the lock**, on success or failure. A stopped app is accepted; an existing
release lock is never stolen. PostgreSQL remains available for dumping, not app
writes. Disable or freeze any additional external database writers before invoking.

Upload/read-back verify the frozen payloads with the existing private NAS uploader.
SNAPSHOT.json is local evidence, not a NAS completion marker. Restore/rehearse and
validate row/content hashes and every media reference before opening new writers.
Do not publish an archive or extract credentials into logs.

After validation, the cutover owner installs the accepted immutable Rust image and
candidate manifest without invoking release.sh while its lock is held. Preserve
old current.env, compose.yaml and original volumes in the snapshot. Start only the
new app, verify actual health/features, and then release the owned lock explicitly:

```sh
python3 cutover-backup.py release-lock \
  --app-root /Users/calum/www-control-center \
  --destination /Users/calum/homelab-backups/<same-private-snapshot-directory>
```

This verifies the ownership marker; it never starts a service. On failure keep the
app stopped and lock held while deciding forward repair or rollback. Never restart
old PostgreSQL writers after accepting new SQLite writes without reconciling them.
Normal release/recovery script adaptation and final deployment ordering still need
candidate verification; these tools do not execute the entire cutover automatically.

## Nightly SQLite backup

Install backup.py, sqlite_snapshot.py, and nas-upload.py together. After cutover,
set the LaunchAgent command to `backup.py --database-engine sqlite`. Default remains
postgres during migration. SQLite uses the backup API, integrity and foreign-key
checks, while the app is stopped for a consistent DB/media snapshot. Every other
service's backup remains unchanged, including Hindsight's independent PostgreSQL.

Tests: `python3 -m unittest discover -s deploy/mini -p 'test_*.py'`.
