# Disposable VM validation

## Current candidate and results

The current runtime helper is
`1c06e59f39373045e8be20a9957167dbc58a1644`. Public head `f9063f6` changes documentation
only. Private candidate `2bd88e2` pins that helper and the identical reviewed Darwin
Comin profile patch; its polling interval is 300 seconds.

VM6 began from fixture baseline `f997040` in the private
[synthetic fixture repository](https://github.com/0x63616c/homelab-vm-enrollment).
The real enrollment PR installed `f87a7552923874a2ee04fb5fae9f869b03b093f6`.

| Check | Current evidence |
| --- | --- |
| Complete guided enrollment | Harness exited 0; actual GitHub PR, Nix installation and activation |
| Enrollment reboot and Comin handover | Passed with real Comin reconciliation |
| Completed-wizard replay | Passed without another issuance or reboot |
| Native scheduled Git update | Reached `586e0ade043e75601ae3b82be76ef21533b6b7ee` through Comin's polling timer |
| Scheduled-update live state | Standard boot profile, `/run/current-system` and live `/etc` all matched; marker present; `vm_e2e --verify` exited 0 |
| Reboot after scheduled update | New boot UUID; all three revision pointers and marker persisted; activation verifier exited 0; Comin running |
| Final private Nix checks | All nine checks passed at `2bd88e2`; exit 0 |
| Final release artifact | CI `42333916620` passed, including fresh-Mac smoke without Nix; published 0.3.0 download checksum verified |

The operator retained full-wizard evidence at
`homelab-cli/target/vm-enrollment-full-6-operator/evidence.json`. It records
`wizardCompleted`, `rebootVerified` and `completedReplayVerified` as true, with
`provider: synthetic` and `tailscaleRoute: pinned guest SSH adapter`. Initial reboot
proof is separate from the later scheduled-update reboot evidence in
`homelab-cli/target/vm-enrollment-full-6-operator/git-update-evidence.json`.

The nine checks passed at private
`2bd88e2d77f4c88774917127072ff2758ed65159` using
`nix flake check --no-update-lock-file --max-jobs 1 --cores 1`; the log is retained
at `homelab-cli/target/private-validation-2bd88e2.log`. Those checks cover both
hosts, service assignments, SOPS identity, management client, Tart, Compose,
Softnet and the dormant MacBook container path, including the current profile
patch and helper pin. Neither physical host configuration was activated.

The release archive SHA-256 is
`1cbcbdcd55150b04318fa336b705531c1957d877ce66f3794570ad4417b29402`.
Its CI source tree matches both release commit `f9063f6` and merged CLI main
`4b9c7bc`. The Homebrew formula uses that verified archive.

## Scope and safety boundary

Bootstrap, GitHub PR operations, guest reboot and Comin are real. Credential
providers and Tailscale transport are synthetic. No production vault credentials
or service data are used. These results do not establish real tailnet policy,
FileVault unlock, application migration, LAN/printer access, physical power
behavior or nested Colima/Tart isolation.

Use only `homelab-macbook` as the physical virtualization host. Guest operations
require `VirtualMac*` identity, the exact guest hostname/nonce, and pinned SSH host
keys. Do not activate either physical host's configuration, reboot/wipe a physical
Mac, or change the production mini. Test tooling and VM state belong under
`/Users/admin/homelab-vm-tests`; use one guest at a time, without shared home,
clipboard, USB or production credentials. NAT is not a firewall boundary.

A temporary `caffeinate -is -w <Tart PID>` assertion keeps the VM host awake on AC
for the test process lifetime. An idle-only assertion was insufficient. Screen
locking remains enabled; this does not authorize permanent power or sudo changes.
Guest-only test sudo rules must pass `visudo`, `sudo -n true` and `sudo -n -v`.
Never apply the fixture's NOPASSWD/validation policy to a physical host.

## Repeatable validation

1. Clone the pinned clean image and record OS/build, hardware identity and nonce.
2. Run private flake checks against the exact archived source without activating
   either real host configuration.
3. Run the production wizard core through the guarded PTY harness, using synthetic
   providers and a real private fixture PR.
4. Verify enrollment reboot, exact activation, protected keys, launchd services,
   Comin handover and completed-wizard replay.
5. Publish a harmless fixture change, wait for native polling, verify boot/live
   state, then reboot and verify that same deployment persists.

Preserve failed attempts and their journals for inspection. Do not fabricate
receipts or bypass uncertain-operation guards. Full-harness completion and the
independent activation verifier do not imply that every standalone recovery entry
point was separately exercised. Release evidence must name the path actually run.

## Image provenance

Tart 2.41.1 archive SHA-256:
`e680a734febccfce7d4e910c1f7f13fc3b00f19a181c945e2d746de3214c32c2`.

Clean prerequisite image:
`ghcr.io/cirruslabs/macos-golden-gate-vanilla@sha256:b35695ce30453bcc1db961a476740be72a44c2a2e464b73ece1ff0fcac12a873`.

Development base image:
`ghcr.io/cirruslabs/macos-golden-gate-base@sha256:14f4fc32a778763ccae1a4d543ea0f177720c570dd7f859eda10b9e0020c7d05`.

Record actual `sw_vers` rather than inferring it from a registry tag. Earlier guests
reported macOS 27.2 (26B123), `VirtualMac2,1`, four vCPUs, 12 GiB RAM and a 120 GB
virtual disk. Development images contain CLT/Homebrew and do not prove a fresh
Mac's prerequisite path; the wizard requires CLT to be installed first.

## Relevant earlier findings

Earlier rehearsals caught CLT and sudo-validation prerequisites, installer-default
file adoption, root Git ownership, SSH StrictModes placement, GitHub argument
handling, Comin startup/restart timing and native activation PATH requirements.
The November 4 base lifecycle also passed an extra reboot without interactive
login. Those historical results are not substitutes for the current candidate.

VM5 passed initial enrollment and replay but failed its scheduled-update check:
Comin reported success while Darwin's standard boot profile and live `/etc`
remained old. Evidence is preserved at
`homelab-cli/target/vm-enrollment-full-5-operator/scheduled-update-mismatch.json`.
That finding motivated the current standard-profile patch and readiness guard.
The patch preserves active/default/history generations and uses Nix's locked
native deletion; no parallel unbounded profile history is created. VM6's scheduled
live-state check now passes, with post-update reboot proof still pending.

Detailed historical chronology remains in this document's Git history. No physical
host deployment, production migration or release is claimed here.
