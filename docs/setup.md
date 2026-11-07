# Setup and recovery

## Before opening the wizard

On the target: create the administrator specified in your configuration and
turn on Remote Login for that administrator. Keep the Mac powered and reachable.
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
a host from its manifest. Its name and administrator come from Git. For a new
connection, enter only its address; saved addresses and SSH identities are reused.
Select a saved connection and press **e** to correct its address. Saving returns
to the host list without connecting or changing its SSH identity.
The wizard checks SSH, offers first-use host trust
and public-key installation when needed, and reads macOS/account/storage facts.
Changed saved host keys are blocked. SSH-agent keys stay in your agent.

**Begin setup.** One approval covers prerequisites, credentials, publishing the
encrypted enrollment configuration to Git, installation and reboot. A live
checklist shows completed, active and pending steps. The wizard creates or
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
Mac, and checks it again before releasing the update hold. Expect administrator
authentication during installation and potentially again after reboot; passwords
are not stored. A FileVault-protected Mac may need a local unlock after restart.
Tailscale check-mode policy may also request browser approval.

## If something stops

**Esc** requests a stop at a safe checkpoint. A running mutation is allowed to
finish so its result can be recorded; cancellation does not undo published
configuration or credentials. **D** shows curated step details. Reopen the same
host to resume from verified state rather than creating another attempt.

Previously saved aliases, addresses, SSH identities and recovery files are kept.
A saved approved setup retains its exact Git commit even if `main` changes or
removes that host. These rows show **Resume**, including completed setups retained
for verification. A host absent from a successfully loaded `main` also shows
**Saved setup (not in main)**; it does not become a new desired host. Ambiguous old
connections stop for review rather than being silently rebound. A changed Git
administrator requires connection review before SSH.

| Situation | Next step |
| --- | --- |
| Command Line Tools installation stopped | Read the installation error; reopen the same setup to verify completion. An uncertain installation is not started again blindly. |
| SSH unavailable | Use **e Edit address** if the route is wrong; otherwise check Remote Login and saved host identity |
| Vault locked | Unlock 1Password; retry the credential step |
| Key issuance uncertain | Inspect Tailscale auth keys; do not issue another blindly |
| Encryption failed | Read cleanup result; preserve identities and inspect local state |
| Approved enrollment key expired | Preserve the saved attempt and inspect target bootstrap state before approving a replacement; setup does not silently renew an approved attempt |
| Setup interrupted | Reopen the same saved host; the wizard resumes the saved attempt |
| Restart not confirmed | Check administrator authentication and resume; do not reinstall |
| Waiting for restart | Keep the Mac powered on; unlock FileVault locally if required |
| Tailscale SSH unavailable | Check the client connection, tailnet SSH policy and any browser approval |
| Host not ready | Review host settings and encrypted secrets in Git |

Do not delete journals or regenerate keys to bypass a blocked step. The wizard
resumes only phases it can establish are safe. An uncertain installer or activation
can require inspection; setup never blindly repeats it. Completing setup does not
approve service migration or wiping another Mac.

[Tailscale SSH identity verification](https://tailscale.com/docs/reference/tailscale-cli#ssh)
uses host keys supplied by Tailscale. The wizard retains your existing trusted
macOS SSH connection for administrator operations.
