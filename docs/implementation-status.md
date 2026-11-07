# Implementation status

The private [homelab repository](https://github.com/0x63616c/homelab) owns host and
service configuration. The public [CLI](https://github.com/0x63616c/homelab-cli)
owns guided enrollment; private health and restore operations live in `host/`.
No physical host has received this configuration, and 0.3.0 is not yet released.

## What is implemented

The Rust wizard verifies SSH identity, attaches the configuration repository,
backs up and verifies age identities through client-side 1Password, and creates
a scoped Tailscale enrollment key. The target generates its own read-only Git
key. Schema 2 names the backup vault separately from the OAuth issuer. Neither
reusable OAuth credentials nor recovery identities reach the target.

An enrollment PR contains public recipients, the selected SSH public key and
ciphertext. After merge, bootstrap installs the approved revision, verifies it,
reboots and reconciles completion. Journals preserve uncertain outcomes; setup
does not silently reinstall or regenerate identities after failure. Nix runs on
the target, not the operator laptop.

Comin owns subsequent Git reconciliation every 300 seconds. Enrollment holds it
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

## Current evidence

The exercised helper is `1c06e59f39373045e8be20a9957167dbc58a1644`; public head
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
- Final current-artifact CI, replacement of the old draft tap artifact and release
  publication remain pending.

The VM uses synthetic credential providers and a pinned SSH adapter for Tailscale
transport. It proves neither real tailnet policy nor FileVault unlock, production
service recovery, hardware power behavior or nested container/runner isolation.
The separate pinned-image Hindsight synthetic restore passed; production-data
restore remains untested. See [restore rehearsal](restore-rehearsal.md).

## Before production migration

Finish artifact checks and release validation. Then
provision and verify actual SSH/SOPS and Tailscale access on the intended host.
Rehearse consistent backups, application restores and stateful deployment failure
handling before service cutover. Home Assistant networking and runner isolation
need their own target evidence.

Current execution authorization is limited to disposable VM testing on the
approved MacBook host. Preserve the live mini until replacement and recovery are
verified. Physical configuration activation, production migration and every
physical wipe require their separate approval.
