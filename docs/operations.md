# Stateful operation coordination

`homelab-operation -- COMMAND ...` holds one host-wide exclusive lock while its
child runs. General service reconciliation and HA Compose use this wrapper.
Backup jobs and the update transaction also use this shared lock; creating an
unrelated backup lock would not coordinate with these jobs. These paths remain
disabled on the hosts pending deployment and recovery validation.

The lock lives at `/var/lib/homelab-operations/operation.lock`. Its parent is
root-owned mode 0755; the file is root:`_containers` mode 0660. `_containers`
can lock it but cannot unlink or replace it. Activation initializes it without
truncating or replacing its inode. Symlinks, unexpected ownership, multiple
hard links and world-accessible lock files are rejected.

If another operation holds the lock, the wrapper returns 75 immediately. Launchd
reconciliation retries on its next interval. `/var/lib/homelab-operations/hold`
is a persistent maintenance hold checked under the lock. Setting a hold stops
new operations; it does not interrupt an already-running backup or deployment.
An operator must wait for the current operation to finish before taking action.
The hold is not removed by activation or a Git update.

The wrapper passes its lock descriptor to the direct child and sets
`HOMELAB_OPERATION_FD`. A nested wrapper verifies that the descriptor identifies
the exact root-owned lock inode and reacquires the same open-file description.
It never trusts an environment flag alone. An unrelated descriptor is rejected;
an independently opened descriptor still contends with the active transaction.
The child also honors a newly set maintenance hold. Terminating the wrapper alone
does not release the lock while its child retains the inherited descriptor.
Commands must run their work synchronously and must not detach background jobs
or close the inherited descriptor before completing. The wrapper does not impose
a universal timeout: Compose already has bounded readiness waits, and a backup
must use backup-specific timeouts and recovery handling. A held lock after a
failure needs inspection, not unlinking the lock file.

The existing updater draft has a separate root-owned update lock and hold.
It is still disabled. The draft transaction now holds the operation lock across
backup, activation, direct service reconciliation and health probes. Simply holding
this lock while waiting for launchd reconcilers would deadlock the transaction;
releasing it during activation would allow backups to race. The updater needs
an explicit supervised transaction that hands its held lock to its own service
reconciliation children. This handoff and privilege drop are now wired in the
draft updater. Do not enable updates until application rollback rules, interrupted
transaction recovery and headless supervision have been validated.

Eleven local tests check cross-process exclusion, release on exceptions, persistent
hold behavior, unsafe lock paths/permissions and parent/child transaction handoff. These do not prove
live backup consistency or application recovery. No lock files or holds have
been installed on either home machine.

## Service command boundary

The modules now expose `homelab-backup-now`, `homelab-reconcile-ha`,
`homelab-reconcile-containers` and `homelab-reconcile-all` as applicable. Launchd
uses these same entry points. The aggregate starts HA reconciliation before the
general services, then runs health checks. The commands carry their reviewed
PATH, HOME, Docker socket and worker settings rather than depending on a human
login environment. Mutating service entry points reject a UID other than 350.

`scripts/service-child.py` supplies the updater's root-to-service boundary. It
accepts only backup/reconcile/health operations, requires the configured
`_containers` UID/GID/home, resolves the command from a built system under
`/nix/store`, and launches with UID/GID 350 and only that supplemental group.
The child receives a minimal environment and the inherited lock descriptor;
root GitHub, age and shell environment variables are not forwarded.

A command timeout kills its synchronous process group before reaping the leader.
This deliberately leaves backup restart-required markers for inspection rather
than pretending interrupted snapshots finished. The future root transaction must
set a maintenance hold on such a failure. Five tests verify privilege arguments,
credential-environment exclusion, rejected operations/identities and timeout
handling. They mock privilege changes; actual macOS headless execution is not
validated yet. The draft updater now calls this boundary for backup,
reconciliation and health. It requires unchanged host/service ownership and
backups enabled in both generations for stateful updates. Backup failure sets
both holds before activation; an interrupted backing-up state also requires
inspection. Host-generation rollback still does not undo database changes.

The update timer and transaction marker are now implemented; see
[update semantics](updates.md) for failure behavior and the remaining rollout gates.
