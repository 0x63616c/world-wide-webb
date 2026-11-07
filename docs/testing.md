# Testing

## Automatic checks

Public CI uses disposable standard GitHub-hosted macOS runners. It checks Rust
formatting, Clippy, native compilation and tests. Test credentials, SSH tools and
issuer endpoints are synthetic; CI cannot access an operator's vault or tailnet.

| Layer | Evidence |
| --- | --- |
| Pure logic | Manifest validation, host binding, lifecycle and failure cases |
| Adapters | Fixture executables and local HTTP servers; no real accounts |
| Terminal | Pseudo-terminal keyboard input, secret non-echo and terminal restoration |
| Packaging | Native ARM64 binaries, macOS-only dynamic dependencies, fresh-runner help smoke |

Run `just test` for the local suite, `just test-terminal` for keyboard and terminal
handoff checks, and `just check` for formatting and Clippy. Plain `just` lists all
recipes. Ordinary tests never enroll a device or start a VM.

## UI development without setup

`just preview` builds the local CLI and opens synthetic screens through the same
Ratatui renderer used by setup. `hl-dev preview --screen attention` jumps to a
failure example. Use left/right to change examples and up/down to scroll.
Add `--dump --width 100 --height 30` to emit a plain-text screen artifact without
an interactive terminal. This uses Ratatui's test backend and production layout.
Preview does not load the operator's inventory, journals, credentials or accounts;
it cannot perform setup. It demonstrates presentation, not real provider success.

Native SSH/sudo runs in an embedded PTY without leaving the TUI. The
`authentication` test runs the production transport and exec bridge against a
synthetic no-echo prompt: password keys, public-key stdin, separate JSON stdout,
resize, failure acknowledgment, cancellation, timeout, and inert clipboard escape
sequences. It checks that passwords never appear in the rendered transcript.

Bootstrap fixtures cover accepted and refused interrupted-Nix recovery, including
a failed installer exit with verified completion. Recovery must never rerun the
installer. Receipt tests reject missing, partial and mismatched evidence. These
tests use local fixtures; they do not claim a fresh real-Mac enrollment.

## Boundaries used by tests

| Boundary | Production | Test replacement |
| --- | --- | --- |
| Presentation | Ratatui screen and keyboard | Synthetic preview, render buffers and pseudo-terminal keys |
| Target transport | Native SSH and SCP | Explicit `WizardTools` executable paths or pinned disposable guest |
| Recovery backup | 1Password | `secret_store::Store` with synthetic identities |
| Enrollment credentials | Scoped Tailscale issuance | `EnrollmentKey` and `EnrollmentDependencies` |
| GitHub | Repository operations | Fixture executables; dedicated repository for full VM enrollment |
| Saved progress | Operator-owned files | Temporary directories with interrupted/resumed attempts |

These boundaries keep test credentials out of production paths without making
provider selection part of the user interface. Tests should exercise the real
workflow and replace only its external effects; a screen saying “complete” is
not evidence that installation succeeded.

## Opt-in VM rehearsal

For a fresh guest, [the full enrollment harness](https://github.com/0x63616c/homelab-cli/blob/main/tests/fixtures/vm-enrollment.md)
drives the real wizard, publication to a private fixture repository, installation, reboot and
Comin verification. It runs on the operator client through a pinned SSH jump host;
vault and Tailscale adapters are synthetic. Run this rehearsal before each
release. Normal tests run its local guards without contacting any machine.

With a prepared disposable guest and the private fixture described in that guide:

```sh
just test-vm /absolute/private/vm-enrollment.json
```

This is an explicit, mutating VM test, not part of `just test`. The harness checks
the guest's VM identity and dedicated fixture repository before enrollment. It
uses real installation and reboot operations with synthetic vault/tailnet
adapters. VM preparation and cleanup are separate; the recipe does not erase or
reset any Mac. Preserve a failed guest and its journal for inspection.

The Rust runner in `tests/vm_e2e.rs` exercises real completion on an already
activated synthetic guest: verify, reboot, reconnect, release the hold, and
confirm Comin reconciliation. A second completion must not reboot again. Normal
`cargo test` checks transport arguments and skips all machine operations.
Provider preparation is tested separately with real age/SOPS and synthetic
providers. These narrower checks do not replace the full enrollment rehearsal.

Build on a development Mac:

```sh
cargo test --locked --release --test vm_e2e --no-run
cargo build --locked --release --bin homelab-host
```

Cargo prints the standalone test executable path. Copy that executable and the
matching `homelab-host` to the explicitly approved VM host; no Rust compiler is
needed there. VM creation, seeding and snapshot cleanup remain separate operator
actions. This runner never deletes a VM or erases a disk.

Prepare a private, owner-only JSON fixture with these fields:

```json
{
  "repository": "example/synthetic-config",
  "revision": "0123456789abcdef0123456789abcdef01234567",
  "manifestPath": "/private/tmp/vm-fixture/manifest.json",
  "configurationHost": "vm-test",
  "guestIp": "192.168.64.7",
  "guestHostname": "vm-test.local",
  "physicalHostname": "vm-host.local",
  "nonce": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "sshPrivateKey": "/private/tmp/vm-fixture/ssh-key",
  "knownHosts": "/private/tmp/vm-fixture/known-hosts",
  "ageKey": "/private/tmp/vm-fixture/host.age",
  "helperPath": "/private/tmp/vm-fixture/homelab-host"
}
```

Replace every example value. Generate a fresh nonce and disposable identities;
never use production keys. All input files except the executable helper must be
owned by the runner's user and mode 0600. The known-hosts file must contain
exactly the guest's IP and pinned SSH host key. The manifest describes one ready
host and must match the committed synthetic fixture. Completion uses a synthetic
Tailscale route over the same pinned guest SSH connection. It proves sequencing,
not real Tailscale enrollment, routing or policy. No vault or tailnet is accessed.

Before running, seed the guest with:

- SSH access for the manifest administrator and fixture-only passwordless sudo.
- `/var/tmp/homelab-vm-e2e.json` containing the exact `nonce` and `hostname`.

For the full enrollment rehearsal, start without Command Line Tools so the
approved wizard must install them. The standalone completion diagnostic below
starts after activation and cannot validate prerequisite installation.

Validate both `sudo -n true` and `sudo -n -v` as the guest administrator.
Mixed password and NOPASSWD rules can permit commands while still requiring a
password for validation. For this disposable fixture only, use a sudoers drop-in
validated with `visudo` containing `Defaults:admin verifypw=never` (replace `admin`
if the fixture uses another administrator), alongside its NOPASSWD rule.
Validate the complete sudoers configuration and both commands before the run.
Do not apply this test-only policy to the physical VM host or production Macs.

The fixture Nix configuration must declare `/etc/homelab-vm-e2e.json` with `host`
and exact `revision`, and launchd service `org.homelab.vm-e2e`. That service checks
its synthetic decrypted marker and writes the current `kern.boottime` to
`/var/tmp/homelab-vm-e2e-boot`. The synthetic flake template is in
`tests/fixtures/vm-config`; its placeholders are not a deployable configuration.
The guest must have completed real bootstrap activation with the current helper,
its protected hold and activation receipt. Never fabricate these receipts. It
also needs real Comin, immutable health/revision metadata and synthetic Tailscale
status. The configured Git repository must contain the exact encrypted files
installed in that revision; mocked publication results are insufficient.

Run only on the approved VM host:

```sh
/private/tmp/vm-fixture/vm_e2e --complete /private/tmp/vm-fixture/fixture.json
```

The runner requires the local hostname to match `physicalHostname` and rejects
any guest whose model is not `VirtualMac*`, whose hostname is the physical host,
or whose marker differs. It freezes input snapshots, isolates HOME and environment,
and uses native SSH with an explicit private key and known-hosts file; it never
reads or writes the operator's SSH configuration. The target independently verifies
its activated system and actual Git reconciliation.

Use the full enrollment harness above for release validation. This standalone
completion command is a recovery diagnostic, not a substitute for that journey.
A failure preserves the VM for inspection and must not be retried blindly. The removed
manual-token `--run` journey is rejected before contacting a target.

## November 7, 2026 local rehearsal

The configuration/state cleanup passed full enrollment on a clean disposable
macOS guest with no Nix installation. The wizard prepared synthetic credentials,
published to a dedicated private fixture repository, installed the configuration,
rebooted, verified real Comin reconciliation and replayed the completed setup
without issuing credentials or rebooting again. The guest already had Apple's
Command Line Tools; this run did not reinstall them.

The fixture's enrolled revision was
`387caffbe9a1cab4b53e31d63f917173890a428b`. Its vendored helper-source Git tree was
`44f99fd58e1cd7322b658c4f1b02825b28790c9f`: only Cargo files, `build.rs`, `src/`
and checked-in synthetic `tests/` were included, never operator state or secrets.
The vault/issuer and Tailscale transport were synthetic; SSH, Git publication,
age/SOPS, Nix installation, activation, reboot and Comin verification were real.
The guest and private evidence were preserved after stopping the VM.

An earlier fresh attempt stopped safely because the fixture lacked `.sops.yaml`.
The template now includes empty creation rules. That failed guest and its journals
were preserved; the successful run used a new clean guest and operator directory.

The current private Nix worktree also evaluated successfully in the guest:
`lib.setupPlan` and both host system derivations. No private host configuration
was built or activated. This checks evaluation, not production service behavior.

The current configuration-contract cleanup is local-only. A normal wizard reads
the configuration repository's GitHub `main`, not this laptop's Nix checkout.
Before production enrollment, publish the compatible private Nix/module changes
and reviewed helper pin together with the CLI release. Removing `activationReady`
from a new enrollment while the old private `main` still requires it is not a
supported mixed-version deployment. Historical saved proposals retain their
original bytes for reconciliation; they are not silently rewritten.

Repeat the clean-guest rehearsal before release when setup or helper behavior
changes. UI preview and unit tests do not replace full setup/reboot validation.

## Earlier rehearsals

The November 4, 2026 rehearsal passed guided installation, activation, SSH recovery
and guest reboot on a disposable macOS 27.2 VM. It used helper source
`6fd57fe68d72bd95d710a3bc76798e1c39a0ef4c` and synthetic fixture
`bc018941356081b20ec48331a1a2394eb891ce23`.

An additional guest reboot with automatic login disabled passed the same verifier:
SSH and the decrypted-secret boot sentinel returned while the console owner was
root. An explicit replay of completed setup was also rejected before credential
reads. These additional checks were driven separately from the main harness.

Earlier attempts caught missing developer tools, a sudo validation prompt, an
installer-default file conflict, root Git ownership rejection and SSH key placement
incompatible with StrictModes. The final run includes the reviewed fixes.

That older result establishes the previous base setup lifecycle, not the new
enrollment and Comin flow. It does not
validate production services, tailnet enrollment, FileVault recovery or nested
runner VMs. Production Macs are never automatic test fixtures; real 1Password
authorization remains a separate adapter smoke test.

### Configuration repair recovery

`cargo test --test bootstrap --test bootstrap_state --test setup_repair`
covers failed evaluation with a completed Nix install, unchanged credentials,
interruption before and after journal migration, repeated resume, protected-file
changes, wrong revision pairs, missing journals and forbidden activation phases.
The frozen client selection also survives edits or deletion of the Git repair
descriptor. These tests use synthetic command adapters and do not deploy to Macs.
