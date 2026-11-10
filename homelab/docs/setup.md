# Set up a Mac

Use the current [WWW CLI release](https://github.com/0x63616c/world-wide-webb/releases?q=homelab)
for this guide’s live checklist and direct-publication flow. Version 0.3.2 has
Git-first selection and automatic prerequisites but uses an enrollment PR.

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

For this repository enter `0x63616c/world-wide-webb` when asked to attach configuration.
The CLI lists the hosts from this repository’s `homelab.json` and uses each host’s
Git-defined administrator. Select the host and confirm its address, which defaults
to `<host>.local`; there is no separate profile-name or administrator form.
Existing connection aliases, addresses and SSH identities are reused. A changed
Git administrator requires a connection review before SSH, and ambiguous saved
connections require resolution rather than an automatic choice. Select **Edit
address** to correct a saved route; its alias, SSH identity and setup state remain
intact.

On your laptop, GitHub CLI must be signed in with access to this repository.
Install the `op` CLI and unlock 1Password with desktop integration enabled. Connect
the standalone Tailscale app and CLI; the App Store variant does not supply the
SSH wrapper used for verification. The tailnet must permit your identity to SSH
as the configured administrator to `tag:homelab`. Setup does not change that policy.

| Stage | What happens |
| --- | --- |
| Connect | SSH trust, agent public-key selection if needed, read-only host checks |
| Begin setup | Review the Mac once; install missing Command Line Tools, back up and verify age keys in 1Password, encrypt the scoped enrollment key and register the Mac's read-only Git key |
| Publish configuration | Publish ciphertext and host enrollment settings to `main`; wait for review instead when GitHub requires a PR or this setup already has one |
| Install and verify | Install the exact published or merged commit, reboot, verify services and remote access, then hand over to Comin |

A live checklist keeps completed stages visible and shows the current operation
and elapsed time. It marks stages complete only after their checks succeed.
Escape requests a stop at a safe boundary; a running publication or installation
is not rolled back. Reopen the saved setup to reconcile its result rather than
starting again.

The wizard checks required client executables before starting a new enrollment.
It supplies the installer and remembers repository, host binding and private
credential paths. Approved setup resumes from its saved exact Git revision,
including when current `main` changes the administrator or removes that host.
Preserve local setup state; do not recreate the connection to resume. The local
cache records connections, not a second list of desired hosts. Do not install Nix
on your personal laptop.

Apple administrator authentication, 1Password unlock/SSH-agent approval and
Tailscale policy approval may still appear. These are the underlying systems
authorizing access; the wizard does not save passwords or bypass them. The
fullscreen checklist temporarily returns control to the native terminal for
SSH, sudo and other interactive authentication, then resumes when appropriate.

## Review before activation

**Begin setup** authorizes backing up keys, publishing encrypted enrollment
configuration and installing its exact commit. Review the Mac, account and
service assignments before beginning. The published files contain ciphertext,
public recipients, the administrator’s SSH public key and host readiness; no
private identity or plaintext credential is committed.

When GitHub permits direct updates, the wizard publishes to `main` without a
second PR step. It checks branch rules, never force-pushes, and stops on conflicting
host changes. Unrelated repository changes can be preserved when preparing the
commit. If GitHub requires a PR, or this setup already has an enrollment PR, the
wizard waits for its review and merge instead. Unknown publication results are
reconciled against the saved exact commit before another action.

Nix imports the same host facts and checks they agree with the approved setup.
You do not copy keys or manually commit generated files.

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
4. Review Begin setup and let the checklist complete; merge a PR if required.

For key backup and rotation see [secrets](secrets.md). Never wipe the existing
mini until replacement services and recovery have been verified and erasure is
explicitly approved.

## Repeatable testing

The public CLI runs synthetic adapter and terminal journeys on disposable macOS
CI, without your vault or hosts. Full install/reboot rehearsals need a disposable
Mac VM. An earlier bootstrap rehearsal passed in a synthetic guest on the MacBook,
including startup without an interactive login. The previously tested full enrollment,
reboot, Comin handover and completed-wizard replay also passed with synthetic
providers and Tailscale transport; real production policy remains untested.
See [VM validation](vm-validation.md) for exact revisions and untested production
workloads; this does not authorize deployment to a physical Mac.
See the public [testing guide](https://github.com/0x63616c/homelab-cli/blob/main/docs/testing.md).

## Saved setup repair

The saved MacBook enrollment at `fdc8781` has an explicit configuration repair in
`setup-repairs/`. Use the current local `hl-dev` build for this retry; the released
0.4.0 CLI does not read repair descriptors. Select **homelab-macbook** and resume
setup. Keep the existing profile and credentials—do not start a new enrollment.

The repair removes the obsolete `activationReady` dependency. It preserves the
manifest, encrypted secrets, recipients, lockfile and installer pin. The CLI freezes
the repair commit locally, verifies it on the target, and adopts it only before a
system build has been recorded or host identities have been installed. Completed
Nix installation is verified and reused. No configuration was activated while
preparing this repair.
