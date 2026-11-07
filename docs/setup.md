# Set up a Mac

Use [CLI 0.3.2](https://github.com/0x63616c/homelab-cli/releases/tag/v0.3.2)
for this guide. It includes Git-first host selection and automatic prerequisite
installation; version 0.3.0 does not.

## One-time work on the target

Create the administrator shown in `homelab.json` during Setup Assistant. Enable
**System Settings → General → Sharing → Remote Login** for that administrator.
Keep the Mac powered and reachable. Your personal laptop does not need Remote Login.

**Begin setup** also authorizes installation of Apple Command Line Tools
when missing. The wizard installs the required tools before preparing enrollment
credentials; it does not install general macOS updates or replace a working Xcode
selection. There is no separate installer confirmation in the wizard.

## Use the wizard

Install the public CLI from the Homebrew tap, then run `homelab`:

```sh
brew install 0x63616c/tap/homelab
homelab
```

For this repository enter `0x63616c/homelab` when asked to attach configuration.
The CLI lists the hosts from this repository’s `homelab.json` and uses each host’s
Git-defined administrator. Select the host and confirm its address, which defaults
to `<host>.local`; there is no separate profile-name or administrator form.
Existing connection aliases, addresses and SSH identities are reused. A changed
Git administrator requires a connection review before SSH, and ambiguous saved
connections require resolution rather than an automatic choice. Select **Edit
address** to correct a saved route; its alias, SSH identity and setup state remain
intact.

On your laptop, GitHub CLI must be signed in with access to this private repository.
Install the `op` CLI and unlock 1Password with desktop integration enabled. Connect
the standalone Tailscale app and CLI; the App Store variant does not supply the
SSH wrapper used for verification. The tailnet must permit your identity to SSH
as the configured administrator to `tag:homelab`. Setup does not change that policy.

| Stage | What happens |
| --- | --- |
| Connect | SSH trust, agent public-key selection if needed, read-only host checks |
| Begin setup | Review the Mac once; install missing Command Line Tools, back up and verify age keys in 1Password, encrypt the scoped enrollment key and register the Mac's read-only Git key |
| Merge the PR | Review generated configuration in GitHub; the wizard waits for merge, installs that commit, reboots and verifies services and remote access |

The wizard checks required client executables before starting a new enrollment.
It supplies the installer and remembers repository, host binding and private
credential paths. Approved setup resumes from its saved exact Git revision,
including when current `main` changes the administrator or removes that host.
Preserve local setup state; do not recreate the connection to resume. The local
cache records connections, not a second list of desired hosts. Do not install Nix
on your personal laptop.

Apple administrator authentication, 1Password unlock/SSH-agent approval and
Tailscale policy approval may still appear. These are the underlying systems
authorizing access; the wizard does not save passwords or bypass them. GitHub PR
review remains required before installing the configuration.

## Review before activation

The wizard opens a PR with ciphertext, public recipients, the administrator's
SSH public key and host readiness. Review the account, UID and service assignments
before merging. You do not copy keys or manually commit generated files.
Nix imports these same host facts and checks they agree with the reviewed setup.

The reusable Tailscale OAuth item stays in the operator's 1Password vault.
Only the generated single-use enrollment key is encrypted for the target.
An uncertain issuance result must be inspected before retrying; the wizard does
not blindly create another key. Safe expired preparations can be renewed by the
wizard; uncertain installation state is preserved for inspection.

After reboot, the wizard verifies services, Git access and Tailscale connectivity
before releasing the update hold. Comin then applies `main`. Administrator
authentication may be needed again; FileVault can require a local unlock after
restart. See [updates](updates.md) for what future merges authorize.

## Add another host

1. Add its entry to `homelab.json`, initially disabled, and its `hosts/<name>.nix`.
2. Add the Darwin configuration in `flake.nix` and review account/UID assumptions.
3. Reload the repository in the CLI, select the new host and confirm its address.
4. Merge the enrollment PR and let the wizard complete its reboot and health checks.

For key backup and rotation see [secrets](secrets.md). Never wipe the existing
mini until replacement services and recovery have been verified and erasure is
explicitly approved.

## Repeatable testing

The public CLI runs synthetic adapter and terminal journeys on disposable macOS
CI, without your vault or hosts. Full install/reboot rehearsals need a disposable
Mac VM. An earlier bootstrap rehearsal passed in a synthetic guest on the MacBook,
including startup without an interactive login. The new full enrollment,
reboot, Comin handover and completed-wizard replay also passed with synthetic
providers and Tailscale transport; real production policy remains untested.
See [VM validation](vm-validation.md) for exact revisions and untested production
workloads; this does not authorize deployment to a physical Mac.
See the public [testing guide](https://github.com/0x63616c/homelab-cli/blob/main/docs/testing.md).
