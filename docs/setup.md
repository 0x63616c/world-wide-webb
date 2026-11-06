# Setup and recovery

## Before opening the wizard

On the target: create the administrator specified in your configuration and
turn on Remote Login for that administrator. Keep the Mac powered and reachable.
Bootstrap also needs Apple's Command Line Tools for Git. On a fresh target, run
`xcode-select --install` and finish the installation dialog before setup. The
helper checks this prerequisite without opening the installer or changing host
settings; a base VM with development tools already installed does not test it.
On the client: install the CLI and sign in to GitHub CLI for private-repo access.
Unlock 1Password with desktop CLI integration enabled. Connect the standalone
Tailscale client, with its CLI available. The App Store variant does not support
the `tailscale ssh` wrapper used to verify the new connection.

Your tailnet policy must allow your identity to SSH as the configured administrator
to the homelab tag. Issuing a tagged enrollment key does not grant this access.
The wizard does not change tailnet access rules.

## Three stages

**Connect.** Select the host. The wizard checks SSH, offers first-use host trust
and public-key installation when needed, and reads macOS/account/storage facts.
Changed saved host keys are blocked. SSH-agent keys stay in your agent.

**Prepare.** Attach the configuration repository once. The wizard creates or
restores age identities, saves and verifies their backups in 1Password, and
encrypts the host's enrollment key. It generates a Git key on the target and
registers its public half as a read-only deploy key using your client GitHub login.
No 1Password credential or GitHub account token is installed on the target.

**Review & set up.** The CLI uses the helper installed alongside it and the exact
configuration commit you approve. Review the setup once; the wizard opens an
enrollment PR. After you merge it, setup installs that exact configuration on the
target. Nix is installed on the target, not your client. Evaluated Nix facts must
match the reviewed manifest.

The wizard checks services and Git access, verifies Tailscale SSH, restarts the
Mac, and checks it again before releasing the update hold. Expect administrator
authentication during installation and potentially again after reboot; passwords
are not stored. A FileVault-protected Mac may need a local unlock after restart.
Tailscale check-mode policy may also request browser approval.

## If something stops

| Situation | Next step |
| --- | --- |
| Command Line Tools unavailable | Install or repair the tools on the target; verify `/usr/bin/git --version` before retrying |
| SSH unavailable | Check address, Remote Login and saved host identity |
| Vault locked | Unlock 1Password; retry the credential step |
| Key issuance uncertain | Inspect Tailscale auth keys; do not issue another blindly |
| Encryption failed | Read cleanup result; preserve identities and inspect local state |
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
