# Implementation status

Configuration remains in the private
[homelab repository](https://github.com/0x63616c/homelab). The reusable operator and
bootstrap helper live in the public
[homelab-cli repository](https://github.com/0x63616c/homelab-cli). Private health and
restore operations live in `host/`; `host/Cargo.toml` pins the public implementation
used by the private package. No current release or completed migration is claimed
by this document.

## Current enrollment implementation

The Rust CLI is focused on enrollment. It provides guided SSH access, persistent
connection identity and repository binding, then a single reviewed setup flow.
There is no separate inspection dashboard or manual token-entry workflow. The
operator does not install Nix or compile a bootstrap package locally.

Schema 2 separates `onePassword.backupVault` from the Tailscale OAuth item's vault
and item. The client verifies host/recovery age-key backups before issuing the
single-use enrollment key. Reusable OAuth credentials and recovery keys stay off
the target. The target generates its own read-only GitHub deploy key.

Enrollment opens an encrypted configuration PR, verifies the exact merged
revision, installs and activates it, then owns reboot and completion checks.
Target identity, immutable build output, host-only decryption and no-replace key
installation remain enforced. Journals and receipts preserve uncertain outcomes;
setup does not silently reinstall after an ambiguous privileged operation.

Comin replaces the custom Python updater. The initial hold keeps the enrollment
revision fixed through reboot. After verified completion, Comin reconciles Git
`main` using the deploy key and pinned GitHub host keys. Runtime authorization is
the reviewed branch, not an Actions-status gate. The startup race between its
first scheduled poll and completion's deadline has a reviewed native-fetch fix;
its real full-journey validation is still in progress.

Both private host definitions enable base-host Comin reconciliation, while their
manifest entries remain `activationReady: false`, with no authorized keys or
assigned services. The update module rejects stateful container/Home Assistant
enablement alongside this base enrollment path. No production host configuration
or service cutover has been activated.

## Validation evidence and current limits

See [VM validation](vm-validation.md) for exact revisions, failed attempts and
preserved guests. Earlier disposable rehearsals proved base activation and reboot
for earlier helpers; they do not establish the complete current enrollment flow.

The current tests cover the real provisioning transaction with synthetic
1Password/OAuth providers, a real private fixture PR, actual target bootstrap,
reboot and Comin verification. The Tailscale route adapter is synthetic, so even
a passing fixture run will not prove production tailnet policy or routing.
The third disposable full-wizard VM run activated and rebooted, then stopped
during completion before Comin started. Its preserved state is under investigation.
The full private `nix flake check --no-update-lock-file --max-jobs 1 --cores 1`
passed all nine checks at `c08bc7d751e2e983131c48c0ef87d68e7ae81652`, pinning public
0.3.0 candidate `f7f2a72`. This includes both host systems, dormant container paths,
client, service-assignment, SOPS, Compose and runner-package checks. The disposable
validation guest is stopped and preserved; no physical configuration was activated.
The fourth rehearsal activated, rebooted and reached a real Comin switch. It exposed
a missing native activation command in PATH and a completion race across Comin's
own restart. Candidate `df524c5` and the corrected daemon PATH address those issues;
focused tests and independent review passed. The new candidate's full Nix check,
fresh reconciliation and completed-wizard replay still need runtime evidence.
Publication/release remains pending.

Local and hosted checks cover Rust behavior, terminal restoration, configuration
schema/example consistency and native no-Nix artifacts. These checks cannot
substitute for the outstanding live disposable journey. No production vault
credentials or production service data are used in that rehearsal.

The pinned-image Hindsight synthetic restore previously passed dump/restore,
vector, Unicode, sequence and restart checks in an isolated hosted container;
see [restore rehearsal](restore-rehearsal.md). That proves neither restoration of
production data nor readiness of the complete application stack.

## Before production migration

- Finish the current disposable enrollment, reboot, Comin handover and saved-state
  replay, then finish release validation. Repeat private configuration checks if
  the reviewed source or helper pin changes.
- Provision and verify the real host SSH/SOPS configuration and actual Tailscale
  access. Current private manifests deliberately remain unready.
- Validate consistent backups and service-specific restore rehearsals before
  moving Control Center, Home Assistant, Bambuddy or Hindsight data.
- Review stateful-service deployment ownership, health and failure handling.
  Comin's base-host handover does not implement application-aware rollback.
- Validate Home Assistant networking and cold start against the intended target
  interface and runtime. Runner lifecycle and registration remain disabled work.

Existing Python backup, snapshot and service-reconciliation code remains where
still used. A wholesale language conversion was explicitly deferred; the custom
Python updater is not the current update architecture. See [operations](operations.md),
[backups](backups.md) and [runner implementation](runner-implementation.md) for those
separate scopes.

Authorization currently covers disposable VM testing on the approved MacBook VM
host, including its scoped test tooling. It does not authorize production service
migration, installing the private configuration on physical hosts, or wiping a
Mac. Preserve the live mini until its replacement and recovery path are independently
verified; every physical wipe requires separate approval.
