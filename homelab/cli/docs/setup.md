# Setup and recovery

## Before opening the wizard

On the target: create the administrator specified in your configuration and
turn on Remote Login for that administrator. Set the local hostname in Sharing
to the exact host name in `homelab.json` (for example, `homelab-macbook`).
Keep the Mac powered and on the same local network as your client during setup.
After you approve setup, the wizard installs missing Apple Command Line Tools
automatically over SSH, then continues. It installs only that prerequisite, not
full Xcode or macOS updates. Existing working developer tools are left alone.
On the client: install the CLI and sign in to GitHub CLI for private-repo access.
Install the `op` CLI and unlock 1Password with desktop CLI integration enabled. Connect the standalone
Tailscale client, with its CLI available. The App Store variant does not support
the `tailscale ssh` wrapper used to verify the new connection.

Your tailnet policy must allow your identity to SSH as the configured administrator
to the homelab tag. Issuing a tagged enrollment key does not grant this access.
The wizard does not change tailnet access rules.

## Three stages

**Choose & connect.** Open your GitHub configuration repository once, then select
a host from its manifest. Its name and administrator come from Git; SSH always uses
`adminUser@host-name.local`. There is no address field or local route override.
The selected SSH identity is reused.
The wizard checks SSH, offers first-use host trust
and public-key installation when needed, and reads macOS/account/storage facts.
Changed saved host keys are blocked. SSH-agent keys stay in your agent.

**Begin setup.** One approval covers prerequisites, credentials, publishing the
encrypted enrollment configuration to Git, installation and reboot. A live
checklist shows completed, active and pending steps. Before the first privileged
step, the wizard checks its saved administrator Login in the Git-configured
`onePassword.backupVault`. When there is no saved password, it asks once in a
masked form, validates that password against sudo on the verified SSH peer, and
saves it in 1Password. A rejected password is never saved. A changed password is
validated before updating the same item. The item is bound to the repository,
host, administrator and pinned SSH host key; ambiguous or mismatched items stop
setup for review. Historical setups retain their verified backup-vault identity
while migrating to the explicit Git configuration.

The wizard creates or
restores age identities, saves and verifies their backups in 1Password, and
encrypts the host's enrollment key. It generates a Git key on the target and
registers its public half as a read-only deploy key using your client GitHub login.
No 1Password credential or GitHub account token is installed on the target.

**Publish & verify.** The wizard commits enrollment to `main` and installs that
exact commit using the helper supplied with the CLI. It preserves unrelated Git
changes and stops on conflicting host changes rather than overwriting them.
When repository rules require a PR, the checklist shows its link; **O** opens it
in your browser, and setup continues automatically after merge. An existing
saved PR still requires its review. Nix is installed on the target, not your
client. Evaluated Nix facts must match the approved manifest.

The wizard checks services and Git access, verifies Tailscale SSH, restarts the
Mac, and checks it again before releasing the update hold. Administrator prompts
stay inside the TUI with masked typing feedback. During one setup attempt, the
CLI can reuse the accepted password in memory for the same pinned SSH identity.
It clears that memory when the attempt ends or authentication fails. Later setup
or verification reuses the canonical 1Password item after validating it again.
Local state records only the vault/item identity and a save receipt. Passwords
never enter plaintext files, Git, logs, command arguments or exported environment
variables. The client alone accesses 1Password; nothing is installed on the target.
A Tailscale-native fallback may still need a separate prompt. Opening the details
of a completed host does not request its password; choosing **Verify setup** may
authorize privileged verification.

To add the saved credential to an already enrolled Mac without installing,
rebooting or rerunning verification, use
`homelab setup --host homelab-macbook --authorize-only`. It runs the same masked
credential step after verifying the Git-defined administrator and SSH identity.
The checklist shows developer tools, repository access, recovery and secrets,
Git configuration, Mac configuration, startup checks, and automatic updates.
Enabling updates lets Comin build and apply the configured deployment branch (`deploy/homelab`
for schema3; `main` for historical schema1/2); verification itself
does not install changes. Screens that need acknowledgement show **Press Enter to continue**.
A FileVault-protected Mac may need an unlock after restart. Unattended cold boot
requires choosing a boot policy that does not depend on a password unlock.
Tailscale check-mode policy may also request browser approval.

## If something stops

**Esc** requests a stop at a safe checkpoint. A running mutation is allowed to
finish so its result can be recorded; cancellation does not undo published
configuration or credentials. **?** shows curated step help. Reopen the same
host to resume from verified state rather than creating another attempt.

While a native authentication pane is active, keys go to SSH/sudo, not wizard
shortcuts. **Ctrl-C** interrupts that connection; remote work may still be running.
The wizard preserves the attempt and never treats interruption as success.

Previously saved aliases, SSH identities and recovery files are kept. Legacy saved
addresses no longer override the Git-derived `.local` connection.
A saved approved setup retains its exact Git commit even if `main` changes or
removes that host. The home screen checks saved setup and the Mac
in the background: **Checking**, **Not set up**, **Resume setup**, **Set up** or
**Not checked**. **Set up** means enrollment completion was verified, not that
every application is currently healthy. A fresh client without the matching saved
approval may show **Not checked** even for an enrolled Mac. A host absent from a successfully loaded `main` also shows
**Saved setup (not in main)**; it does not become a new desired host. Ambiguous old
connections stop for review rather than being silently rebound. A changed Git
administrator requires connection review before SSH.

| Situation | Next step |
| --- | --- |
| Command Line Tools installation stopped | Read the installation error; reopen the same setup to verify completion. An uncertain installation is not started again blindly. |
| SSH unavailable | Check the matching local hostname, same-LAN connectivity, Remote Login and saved host identity |
| Vault locked | Unlock 1Password; retry the credential step |
| Key issuance uncertain | Inspect Tailscale auth keys; do not issue another blindly |
| Encryption failed | Read cleanup result; preserve identities and inspect local state |
| Approved enrollment key expired | Preserve the saved attempt and inspect target bootstrap state before approving a replacement; setup does not silently renew an approved attempt |
| Setup interrupted | Reopen the same saved host; the wizard resumes the saved attempt |
| Nix installation interrupted | The wizard checks the pinned installer's root-owned completion receipt and live daemon, then reuses the installation. Missing or incomplete evidence stops recovery without reinstalling. |
| Restart not confirmed | Check administrator authentication and resume; do not reinstall |
| Waiting for restart | Keep the Mac powered on; unlock FileVault locally if required |
| Tailscale SSH unavailable | Check the client connection, tailnet SSH policy and any browser approval |
| Host not ready | Review host settings and encrypted secrets in Git |

Target bootstrap diagnostics are saved under the administrator's
`~/.local/state/homelab/bootstrap/diagnostics.jsonl` once the journal exists.
They contain timestamps, phases and fixed error codes—no passwords, keys, command
arguments or subprocess output. The file is private and bounded to about 64 KiB.

Do not delete journals or regenerate keys to bypass a blocked step. The wizard
resumes only phases it can establish are safe. An uncertain installer or activation
can require inspection; setup never blindly repeats it. Completing setup does not
approve service migration or wiping another Mac.

[Tailscale SSH identity verification](https://tailscale.com/docs/reference/tailscale-cli#ssh)
uses host keys supplied by Tailscale. The wizard retains your existing trusted
macOS SSH connection for administrator operations.

### Recovering a published configuration error

A failed setup keeps its original Git approval, credentials and target journal.
The repository can publish `setup-repairs/<original-commit>.json` with an exact
replacement commit for that host. The wizard verifies that it is a descendant
and preserves the manifest, encrypted host secrets, SOPS rules, lockfile and Nix
installer specification. It saves that repair selection locally before installation;
subsequent retries keep the same selection even if `main` changes.

On your next setup attempt, the target adopts the repair only before a built
system is recorded or host-key installation starts. An interrupted Nix installation must first be verified
complete. The journal records the replacement and original commits atomically;
credentials and the original enrollment reservation are retained. Uncertain key
installation or activation still requires investigation rather than a new repair.
