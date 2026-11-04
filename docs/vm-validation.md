# Disposable MacBook VM validation

## Authorized boundary

Use only `homelab-macbook` as a virtualization host. Do not erase it or activate
its physical homelab configuration. Do not change the Mac mini or install tools
or change settings on the operator laptop. Repository work and SSH control are
performed from the operator workspace.

Host additions belong under `/Users/admin/homelab-vm-tests`: pinned Tart app,
isolated `TART_HOME`, test inputs, VM disks and logs. Use one VM at a time, with
no shared home directory, clipboard, USB or production credentials. Default NAT
is not a firewall boundary; test commands must never address production services.

## Repeated test cycle

1. Clone a pinned clean macOS image; record OS/build, VM hardware identity and a
   per-run guest marker before allowing setup or reboot commands.
2. Run private Nix evaluation/build checks inside a validation guest using an
   exact archived source tree. Do not activate either real host configuration.
3. Exercise the same wizard core through a pseudo-terminal against a separate
   guest with synthetic secrets and a pinned public fixture configuration.
4. Verify prerequisite failures, install/build, activation, key permissions,
   guest reboot, SSH recovery and expected launchd state.
5. Repeat from a clean clone with connection loss, wrong key and interrupted
   operation cases. Preserve bounded redacted logs and a machine-readable result.

All destructive actions must be bound to the VM identity and per-run marker.
No physical reboot, erasure or production service migration is part of this test.

## Test levels and limits

| Level | What it establishes |
| --- | --- |
| Existing public macOS CI | Native binary, synthetic adapters, terminal and bootstrap policy |
| Private Nix checks in guest | Actual private flake evaluates/builds at the recorded revision |
| Clean VM setup + reboot | Base host lifecycle and recovery, with synthetic secrets |
| Later real-hardware rehearsal | Colima, runner VMs, printer/LAN and hardware power behavior |

An M2 macOS guest cannot substantiate nested Colima/Tart execution. No VM result
will be reported as proof that those production workloads work.

## Image provenance

Tart 2.41.1 archive SHA-256:
`e680a734febccfce7d4e910c1f7f13fc3b00f19a181c945e2d746de3214c32c2`.

Base image (guest agent and development tools):
`ghcr.io/cirruslabs/macos-golden-gate-base@sha256:14f4fc32a778763ccae1a4d543ea0f177720c570dd7f859eda10b9e0020c7d05`.

Clean prerequisite image:
`ghcr.io/cirruslabs/macos-golden-gate-vanilla@sha256:b35695ce30453bcc1db961a476740be72a44c2a2e464b73ece1ff0fcac12a873`.

The pinned upstream template specifies macOS 27.2; verify guest `sw_vers` after
boot rather than inferring runtime OS from a registry tag. Base images contain
Homebrew/CLT and cannot prove an untouched Mac's prerequisite path.

## Evidence so far

November 4, 2026: SSH confirmed physical host macOS 27.2 (26B118), ARM64,
`admin` UID 501 and about 422 GiB free. Tart/Homebrew/CLT were not found and
noninteractive sudo was unavailable. Created the private tools directory;
archive download timed out. Subsequent SSH attempts also timed out. No VM or
Nix installation has run yet, and no setup/reboot test has passed on a real VM.

Fresh macOS Git requires Command Line Tools; test the missing-prerequisite error
explicitly. Do not silently turn an interactive Apple installation into a
purported unattended guarantee.
