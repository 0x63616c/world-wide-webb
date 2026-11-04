# Main-based host updates

`homelab.updates.enable` now defines a root launchd daemon that checks every
600 seconds and at boot. Both checked-in hosts keep it **false**. No timer has
been installed on either machine. Activation readiness, secrets and migration
requirements also remain unmet.

The updater fetches the private repo using its root-only read token, selects an
exact `main` commit, and requires the latest push CI attempt for that exact SHA
to have completed successfully. It builds locked inputs and keeps the candidate
GC-rooted. A different SHA, PR run or incomplete/failed attempt cannot authorize
activation. A build or merge does not deploy while updates remain disabled.

Before activation it compares host/service ownership in the two built manifests;
changes require the migration workflow. Stateful deployments require backups
enabled in both generations. Under the shared operation lock it writes a
persistent transaction marker, runs a verified backup as `_containers`, activates
the candidate as root, then reconciles and checks health as `_containers`.
Success records the deployed SHA and removes the transaction marker.

## Recovery behavior

- Backup failure prevents activation and sets both updater and operation holds.
- Failure during host activation attempts the previous host generation and
  retains the holds for inspection.
- Once application reconciliation starts, failure does **not** activate the old
  generation. The new app may have migrated its database. The updater records
  `service-failed-needs-recovery`, keeps the candidate generation and stops
  future operations. Restore/compatible application rollback requires review.
- An interrupted backup, activation or reconciliation is detected on startup.
  A transaction marker without a live process also blocks scheduled service
  and backup jobs, including after reboot. Only the transaction's inherited
  lock may run its own children while that marker exists.

Inspect `/var/lib/homelab/status.json`, the local backup set and its restart
markers, and both holds before recovery. `/var/lib/homelab-operations/transaction`
is evidence of an unfinished operation, not an expendable stale lock. Never
remove it or a hold just to force another deployment. The lock inode itself is
never deleted. Application restore and target-machine recovery rehearsal are
still unfinished, so automatic updates are not yet deployment-ready.

## Self-update supervision

The launchd plist uses stable `/run/current-system` and `/etc/homelab/updater`
entry points. Script/store-path updates do not change that plist. The updater
rejects candidate plist changes and drift in the installed plist: changes to
its own supervisor need a separately supervised manual activation. This avoids
unloading the process in the middle of its own switch. Root activation and
service children carry the operation lock descriptor and have bounded process
supervision; timeouts terminate the synchronous command group.

Unit tests cover CI eligibility, credential handling, rollback versus application
recovery, transaction order, supervision changes, lock handoff and interrupted
operation exclusion. Hosted CI compiles the enabled timer variant without
activating it. These checks do not establish real reboot, launchd, database
restore or network recovery behavior; those remain rollout gates.
