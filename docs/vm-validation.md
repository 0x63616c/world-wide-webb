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

November 4, 2026: the physical MacBook runs macOS 27.2 (26B118), with `admin`
UID 501 and initially about 422 GiB free. The test guests report macOS 27.2
(26B123), `VirtualMac2,1`, four vCPUs, 12 GiB RAM and a 120 GB virtual disk.
Tart and the Determinate 3.24.1 installer passed their pinned checksum checks.

A temporary four-hour `caffeinate -is` assertion prevents physical system sleep
on AC. Screen locking remains enabled and does not stop SSH or the VMs. No
permanent physical power, sudo or deployment configuration was changed.

| Check | Evidence |
| --- | --- |
| Private Nix evaluation and full build | All nine checks passed at `442ae6adb6b6afabf34f6e0287d2d89f8425b605` |
| Installer-default adoption fix | All nine private checks passed again at `960a364711b6430a6842318211be1c7bb2826ec9` |
| Final private configuration | All nine checks passed at `95a0d91caedb3694724b57a5096ec8b1da286754`, including the SSH and activation fixes |
| Missing CLT | Real helper rejected absent tools before credential reads or journal creation |
| Nix installation through wizard | Succeeded in clean vanilla guests after CLT preparation |
| Custom Nix configuration | Modified content was rejected and preserved; untouched installer default activated |
| Recovery guard | Refused automatic replay after an uncertain activation |
| Complete guided activation and reboot | Passed on the fourth clean attempt, including SSH recovery, SOPS and boot-time launchd execution |
| Startup without interactive login | Passed an additional reboot with guest automatic login disabled; console owner was root and the new boot sentinel matched |
| Completed setup replay | Explicit resume was rejected before reading deliberately absent credential files |

Full private checks use `nix flake check --no-update-lock-file --max-jobs 2
--cores 2`, including both host systems, the container-enabled variant, Compose,
SOPS identity and runner tools. Neither real host configuration was activated.
Logs and machine-readable results are retained under the MacBook's test directory.
After review, failed disposable copies were removed. The clean prepared baseline,
successful guest and private-validation cache remain stopped for repeat tests.

## Findings and fixes

- Fresh macOS requires CLT for Git. The helper now fails early with a specific
  error. Apple Software Update installed CLT 27.2 unattended in the test guest;
  that prerequisite installation is not yet a shipped CLI feature.
- Cirrus permits `sudo -n true` but its default policy can still prompt for
  `sudo -v`. The harness checks both. Only disposable guests receive the validated
  test-only `verifypw=never` setting.
- nix-darwin initially rejected Determinate's untouched `nix.custom.conf`.
  An exact content hash permits adoption with a backup; customized files remain
  blocked. Both cases were tested inside a guest.
- Root activation cannot re-evaluate an administrator-owned Git checkout under
  Git's ownership rules. The helper now switches the exact prebuilt system using
  nix-darwin's native profile/activation sequence, without weakening Git checks.
- SSH key symlinks into the group-writable Nix store conflict with OpenSSH's
  strict ownership checks. A reviewed Rust helper installs an atomic regular
  root-owned key file instead. StrictModes remains enabled.

The current clean rehearsal uses synthetic fixture
`bc018941356081b20ec48331a1a2394eb891ce23` and helper source
`6fd57fe68d72bd95d710a3bc76798e1c39a0ef4c`. The full wizard and guest reboot
passed without intervention. Independent post-reboot checks confirmed a regular
root-owned SSH key file (0644), its root-owned directory (0755), StrictModes enabled,
the exact activated revision, matching current-boot sentinel and the preserved
installer-default backup. Final private checks and the logged-out boot test also
passed. This verifies the base lifecycle; production migration and nested runner
or container virtualization were not performed.
