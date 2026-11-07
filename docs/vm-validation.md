# Disposable MacBook VM validation

## Current enrollment rewrite

The earlier clean rehearsal below covers helper `6fd57fe`, not the current
enrollment rewrite. It is not evidence for automated backup, deploy-key enrollment,
wizard-owned reboot or the Comin handover.

Verified on 2026-11-06 inside `homelab-validation` (`VirtualMac2,1`):

- Both private host system derivations evaluate with the pinned Comin input.
- Comin 0.14.0 builds and runs. The launchd configuration uses Determinate's
  installed Nix profile; upstream's default `nix.package` reference failed evaluation.
- The current host helper exits without starting Comin when enrollment state and
  the root completion receipt are absent.
- Generated launchd settings retain `RunAtLoad`, a 60-second restart interval,
  failure restart policy and the enrollment gate command.

These early checks alone did **not** establish full builds or reboot/reconciliation.
The earlier private helper pinned review candidate `f780a9449ecec6615c586451c3a907ba12aa5ab7`
from [CLI PR #2](https://github.com/0x63616c/homelab-cli/pull/2). Its private
`nix flake check --no-update-lock-file` subsequently passed inside the guest,
including both host systems, dormant container paths, client and SOPS identity checks.
Neither host configuration was activated. The current VM
harness is being adapted from the old token/manual-reboot journey; provider tests
use synthetic credentials and cannot establish real Tailscale routing or policy.

The dedicated private fixture repository is
[`homelab-enrollment-fixture`](https://github.com/0x63616c/homelab-enrollment-fixture).
It contains synthetic encrypted data only. Its real bootstrap attempt at `7fc9a48`
stopped during build before activation: the fixture Rust adapter lacked a compiler
environment. After fixing that, fixture revision `0ddaa7e` passed `nix flake check`,
including checks of actual revision metadata and canonical health executable names.
The failed guest is preserved. The subsequent `homelab-enrollment-1` attempt at
`0ddaa7e` stopped with `bootstrap-nix-installation-unconfirmed`. Inspection found
no surviving installer/helper processes, Nix store, installer receipt or activated
system; `/nix` existed and the journal retained `InstallingNix`. That guest is
preserved and stopped, not retried or treated as a successful installation.

The full-wizard rehearsal uses a fresh `homelab-enrollment-full-1` clone and the
private [`homelab-vm-enrollment`](https://github.com/0x63616c/homelab-vm-enrollment)
repository. Its unready baseline has no host ciphertext or administrator keys;
the real wizard must create and merge its enrollment PR. Guest identity, pinned
SSH through the approved VM host, and noninteractive sudo have been checked.
The full wizard ran against baseline `19bfc54` with helper `a7b3ce8`. It prepared
synthetic verified backups and encrypted credentials, then stopped before creating
a deploy key or PR. A read-only reproduction confirmed that deploy-key discovery
combined `gh api --slurp` with `--jq`, which GitHub CLI rejects. The guest and
operator state are preserved; this is not a passed enrollment rehearsal. Fixing
that command and the fixture adapter's mutation argument handling precedes the
next clean attempt.

The second clean attempt (`homelab-enrollment-full-2`, helper `b666d77`) passed
deploy-key registration and created and merged fixture PR #1 at
`30f7bf3f7c0fa7a2729143f1df8591e89bf77386`. It then stopped because the test-only
GitHub adapter rejected the legitimate `compare/<revision>...main` read used to
verify merge ancestry. A direct read returned `identical`. This is an adapter
defect, not evidence of successful installation. The merged PR, operator state
and guest remain preserved for an explicitly guarded resume test.

The guarded resume of the second attempt installed Nix, built and activated the
exact merged configuration, and rebooted successfully. Its final reconciliation
check did not complete: the published report had `rebooted=true` and no verified
reconciliation, while Comin had started but not yet performed its first poll.
The guest is preserved and stopped. This is not a passed full wizard run.

Pinned Comin waits 600 seconds for its first scheduled fetch, matching the old
setup verification deadline. Helper `583788d` now requests one native Comin fetch
after its protected RPC socket is ready, then retains the existing strict Git and
deployment verification. Focused tests and independent review passed. A fresh
`homelab-enrollment-full-3` rehearsal used unready baseline `034d093`, created and
merged fixture PR #2, activated and rebooted. It then stopped during completion
before Comin started. Its report has `rebooted=true`, but completion and
reconciliation are not verified. The guest and operator state remain preserved;
read-only diagnosis is ongoing. No successful full rehearsal is claimed yet.

Post-reboot recovery passed service verification and released the Comin hold.
Read-only inspection then identified a second handover issue: `/run` resolves to
the native `root:daemon` `0775` directory, so the helper correctly rejected its
replaceable socket location. Candidate `f7f2a72` relocates RPC to the existing
root-owned `0700` `/var/lib/homelab` directory without weakening the guard. Its
tests and independent review passed; runtime validation is still pending.

The private helper now pins 0.3.0 candidate `f7f2a72`; schema 2 uses an explicit backup vault.
At private commit `c08bc7d751e2e983131c48c0ef87d68e7ae81652`,
`nix flake check --no-update-lock-file --max-jobs 1 --cores 1` completed with exit 0
inside the disposable third guest. All nine checks passed: `mac-mini`, `macbook`,
`service-assignments`, `sops-host-identity`, `management-client`, `runner-tart`,
`compose`, `runner-softnet` and `macbook-containers`. The operator retained the log
at `homelab-cli/target/private-validation-c08bc7d.log`; the guest is stopped and
preserved. This validates the pinned configuration builds and checks, not its
activation on either physical host.

A fresh fourth wizard rehearsal is starting from fixture baseline `a84b7e4` with
helper `f7f2a72`. Full enrollment, reboot, Comin reconciliation and completed-wizard
replay remain pending, as does release approval. No successful full journey is
claimed by the Nix check result.

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

Keep a temporary `caffeinate -is -w <Tart PID>` assertion for the VM lifetime on
AC. An idle-only `-i` assertion proved insufficient during the new rehearsal:
the physical host repeatedly entered maintenance sleep and paused guest progress.
The added `-s` assertion was confirmed through `pmset -g assertions`; the run is
still being observed. Screen locking remains enabled. No permanent physical
power, sudo or deployment configuration was changed.

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
