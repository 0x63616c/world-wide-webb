# Implementation status

The private [homelab repository](https://github.com/0x63616c/homelab) owns host and
service configuration. The public [CLI](https://github.com/0x63616c/homelab-cli)
owns guided enrollment; private health and restore operations live in `host/`.
No physical host has received this configuration. Public CLI
[0.4.0](https://github.com/0x63616c/homelab-cli/releases/tag/v0.4.0) provides
Git-first host selection, automatic Command Line Tools installation, a live
enrollment checklist and direct publication to `main` when GitHub permits it.

## What is implemented

The Rust wizard verifies SSH identity, attaches the configuration repository,
backs up and verifies age identities through client-side 1Password, and creates
a scoped Tailscale enrollment key. The target generates its own read-only Git
key. Schema 2 names the backup vault separately from the OAuth issuer. Neither
reusable OAuth credentials nor recovery identities reach the target.

Enrollment publishes public recipients, the selected SSH public key and
ciphertext. Version 0.4.0 publishes directly when
branch rules permit, while preserving existing PRs and required PR review.
Bootstrap installs the exact approved revision, verifies it, reboots and
reconciles completion. Journals preserve uncertain outcomes; setup
does not silently reinstall or regenerate identities after failure. Nix runs on
the target, not the operator laptop.

Comin owns subsequent Git reconciliation every 30 seconds. Enrollment holds it
until verification completes. A narrow pinned patch uses Darwin's standard
system profile for both activation and retention; native Nix generation deletion
preserves the current profile under its lock. Completion checks Comin's deployed
revision, the boot profile and live `/etc/static`. Reviewed `main` is the update
authorization boundary; Actions status is not a separate runtime gate.

Both physical host manifests remain unready, without authorized keys or assigned
services. Comin cannot be enabled alongside the stateful container/Home Assistant
runtimes until their backup and deployment workflow is reviewed. Runner lifecycle
and registration remain disabled. Existing Python backup/snapshot/reconciliation
operations remain where used; the custom Python updater was removed.

## Git-first flow

`homelab.json` is the host and administrator source of truth. New connections need
only an address, defaulting to `<host>.local`. Existing local aliases, addresses,
SSH identities and journal names are preserved as connection data. Changed Git
logins require review; ambiguous aliases are not selected automatically. Saved
addresses can be edited without recreating connection or enrollment state.

Approved setup remains pinned to its saved Git workspace even if `main` changes
or removes the host. This preserves interrupted enrollment without making the
local cache another desired-host inventory. Missing Apple developer tools are
installed within approved setup using only the matching Apple CLT catalog item;
working Xcode selections are preserved and uncertain installs are not replayed.
These changes do not authorize physical deployment.

## Checklist and publication behavior

Begin setup approves the enrollment operation once. The checklist retains stage
results and elapsed time, yielding the terminal for native authentication. A stop
request takes effect at a safe boundary; it does not undo an operation already
in flight. Saved progress and uncertain outcomes remain available for resume.

Direct publication uses a non-force update, preserves unrelated configuration
changes and rejects conflicting host changes. A private receipt records the exact
candidate commit before publication, allowing lost responses to be reconciled.
Existing enrollment PRs and GitHub-required PR review are not bypassed. Expired
approved credentials are preserved for inspection rather than silently renewed.

## Current evidence

The 0.4.0 checklist passed a fresh no-Nix VM rehearsal on `homelab-checklist-1`:
real private Git publication without a PR, installation, reboot, Comin handover
and completed-wizard replay. The first preparation attempt stopped on an idle
error; retrying the same saved preparation succeeded. Synthetic providers and a
pinned guest SSH adapter were used. Public CI passed at `cc51c6e`; exact source,
installed revision and evidence paths are in [VM validation](vm-validation.md).
The VM is stopped and preserved. No production deployment is implied.

Earlier 0.3.0 validation remains below for the private configuration checks and
scheduled-update reboot evidence; it is not a new 0.4.0 private Nix run.

The earlier exercised helper is `1c06e59f39373045e8be20a9957167dbc58a1644`; public head
`f9063f6` changes documentation only. Private candidate `2bd88e2` pins that helper
and the Darwin profile patch. See [VM validation](vm-validation.md) for exact
revisions, evidence locations and limits.

- VM6 passed the complete wizard, enrollment reboot, real Comin handover and
  completed-wizard replay; the harness exited 0.
- A subsequent native scheduled update reached `586e0ade043e75601ae3b82be76ef21533b6b7ee`.
  Boot profile, current system and live `/etc` agreed, the new marker was present,
  and the independent activation verifier exited 0.
- Reboot after that scheduled update passed: the new boot retained the exact
  deployment, the secret/launchd verifier passed and Comin was running.
- The full nine-check private Nix run at `2bd88e2` passed, including both hosts,
  the current profile patch and helper pin.
- Public CI run `42333916620` passed, including the fresh-Mac smoke test without
  Nix. The published artifact's SHA-256 matches the Homebrew formula.

The VM uses synthetic credential providers and a pinned SSH adapter for Tailscale
transport. It proves neither real tailnet policy nor FileVault unlock, production
service recovery, hardware power behavior or nested container/runner isolation.
The separate pinned-image Hindsight synthetic restore passed; production-data
restore remains untested. See [restore rehearsal](restore-rehearsal.md).

## Before production migration

Provision and verify actual SSH/SOPS and Tailscale access on the intended host
only after deployment is authorized.
Rehearse consistent backups, application restores and stateful deployment failure
handling before service cutover. Home Assistant networking and runner isolation
need their own target evidence.

Current execution authorization is limited to disposable VM testing on the
approved MacBook host. Preserve the live mini until replacement and recovery are
verified. Physical configuration activation, production migration and every
physical wipe require their separate approval.
