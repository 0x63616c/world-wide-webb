# Git manages each Mac

Main is the authoring branch. Successful selected Homelab CI authorizes source
promotion to `deploy/homelab`; Comin polls that branch every 30 seconds. GitHub
promotion completion is distinct from host acceptance. Check the installed revision
and `/var/lib/homelab-operations/last-success.json` before claiming deployment.

Comin reads the `projects/homelab` flake from the promoted repository.

## Generation changes

Evaluated per-application and shared inputs feed the pure deployment planner.
Application image/configuration/credential changes select their applications;
shared runtime/storage changes select affected applications and require off-host
recovery. Host monitoring-agent changes leave application inputs unchanged.
Unknown/old descriptors retain full protection. Image-only Compose edits are local
recovery changes; other Compose edits conservatively require an off-host point.
Host ciphertext rotation selects all consumers without exposing plaintext digests.

Under the existing operation lock, the transaction pre-pulls selected images, captures
old state, activates Nix, reconciles selected projects with two concurrent children,
checks selected/dependent readiness and records phase timings. HA precedes dependent
Control Center acceptance. Cold snapshots and image pulls stay sequential; both host
and VM admission reserves are checked before pulls. A new assignment still needs
existing restored volumes and provisioning; removal requires explicit retirement.

Ordinary application updates require a complete, fsynced, verified local recovery
point. NAS publication runs independently. Shared VM/storage/safety changes wait for
their transaction's off-host verification. Backup and mutation failures preserve the
journal and recovery pins; no data rollback or ambiguous action replay is automatic.
On the first optimized release, the installed older generation still performs its
full synchronous backup because it cannot provide scoped metadata/commands.

The journal records source system paths, selected scope/reasons and monotonic phase
durations. Local backup receipts record capture duration, container cold durations
and bytes; NAS receipts record publication time. Successful receipt plus current/boot
profile agreement establishes host acceptance. Timings are observed work, not timeout
budgets. Preserve interrupted transactions for inspection.

For a failed **backup-phase** transaction whose local set was later published to NAS,
use the candidate path and transaction ID from the root-owned journal:

```sh
homelab-activate-generation recover-backup --candidate PATH --transaction-id ID --check-only
```

The root-only check verifies the old system/profile, journal,
recovery set and service health without changing state. Run the same command
without `--check-only` only after the check passes; it archives the journal under
the operation lock so Comin can make a new attempt. The original recovery set
remains pinned. This command refuses activation or reconcile phase failures.

## During setup

1. The CLI creates a protected hold before first activation.
2. Launchd loads Comin through a small Rust startup check. It cannot start while
   that hold exists or before a verified enrollment completion receipt exists.
3. The wizard verifies the approved configuration, Tailscale, services and reboot.
4. It records completion, releases the hold, and waits for Comin to fetch and
   activate `deploy/homelab`. Only a matching successful reconciliation produces Ready.

If the connection drops, resume the saved host. The approved revision is saved
locally before installation; changes on `main` do not replace an in-progress
claimed installation. Once enrollment is released, a failed reconciliation check
means updates are running but unconfirmed—it does not pause Comin again.

## Restarts and recovery

Launchd starts the updater at boot, retries failures, and checks every minute for
a stopped process. That also covers Comin's successful exit when its configuration
changes. Comin owns Git polling, builds and deployments; the Rust wrapper only
protects first enrollment. It is not a general pause switch for a running updater.

Comin logs to `/var/log/comin.log`. Its status API is restricted to root through
`/var/lib/homelab/comin.sock`, inside the bootstrap-owned root `0700` directory;
metrics bind to localhost. The startup gate checks that directory before starting
Comin. The native macOS `/run` directory is group-writable and is not used for RPC.
The wizard reads bounded status JSON without printing raw commit messages or errors.

Comin invokes the stateful generation transaction for application hosts. Restore
remains explicit: rolling Nix back does not reverse application schema/data changes.

## Pinned upstream

The configuration selects Comin `0.14.0` at
[`004a55c`](https://github.com/nlewo/comin/tree/004a55ced41d72340373ebc6774e29a417512638).
The [Darwin profile patch](../packages/comin-darwin-profile.patch) makes updates
advance the standard macOS system profile before activation. Without it, the boot
daemon can restore old settings even after Comin reports a successful deployment.
Retention uses the same profile, preserves active/history generations and delegates
deletion to Nix's locked profile operation. Unrelated profiles are excluded.
Completion checks the boot profile and live `/etc/static` against the current system.
The startup check avoids relying on its suspend/resume behavior across restart.
The former Python updater is removed. The Nix assertion requires transactional activation and backups whenever
container or Home Assistant workloads are assigned.
