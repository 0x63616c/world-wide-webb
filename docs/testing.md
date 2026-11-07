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

Run locally with `cargo test --locked`, `cargo fmt --check` and
`cargo clippy --locked --all-targets -- -D warnings`.

## Opt-in VM rehearsal

For a fresh guest, [the full enrollment harness](https://github.com/0x63616c/homelab-cli/blob/main/tests/fixtures/vm-enrollment.md)
drives the real wizard, a private fixture PR and merge, installation, reboot and
Comin verification. It runs on the operator client through a pinned SSH jump host;
vault and Tailscale adapters are synthetic. Run this rehearsal before each
release. Normal tests run its local guards without contacting any machine.

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
- The command-line tools required by the pinned Nix installer.

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
installed in that revision; mocked merge results are insufficient.

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

The new completion runner has not yet passed its real-VM rehearsal. A failure
preserves the VM for inspection and must not be retried blindly. The removed
manual-token `--run` journey is rejected before contacting a target.

## Historical rehearsal

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
