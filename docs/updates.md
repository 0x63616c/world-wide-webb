# Git manages each Mac

Comin watches this private repository's `main` branch every ten minutes, builds
the matching `darwinConfigurations.<host>`, and activates it. Each Mac uses its
own read-only SSH deploy key. GitHub's reviewed SSH host key is pinned; nodes
receive no GitHub account token and do not query Actions to authorize deployment.

**Merging is deployment authorization.** Use repository reviews and checks before
merging. The host applies the resulting commit automatically after enrollment.
The checked-in host recipes enable Comin; this branch has not been deployed to
the real Macs, and the new integration still needs the disposable-VM rehearsal.

## During setup

1. The CLI creates a protected hold before first activation.
2. Launchd loads Comin through a small Rust startup check. It cannot start while
   that hold exists or before a verified enrollment completion receipt exists.
3. The wizard verifies the approved configuration, Tailscale, services and reboot.
4. It records completion, releases the hold, and waits for Comin to fetch and
   activate `main`. Only a matching successful reconciliation produces Ready.

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
`/run/comin-grpc.sock`; metrics bind to localhost. The wizard reads bounded status
JSON without printing raw commit messages or errors.

Application backup and restore remain separate workflows. Comin does not provide
the former custom updater's backup-before-activation or application rollback
transaction. Current host manifests enable no application services; migration and
restore rehearsals must establish their operational workflow before cutover.

## Pinned upstream

The configuration selects Comin `0.14.0` at
[`004a55c`](https://github.com/nlewo/comin/tree/004a55ced41d72340373ebc6774e29a417512638).
The startup check avoids relying on its suspend/resume behavior across restart.
The former Python updater is removed. Comin cannot be enabled alongside stateful
container or Home Assistant workloads until their backup/deployment workflow is
reviewed; the Nix assertion prevents silently losing those protections.
