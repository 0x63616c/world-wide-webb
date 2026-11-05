# Setup and recovery

## Before opening the wizard

On the target: create the administrator specified in your configuration and
turn on Remote Login for that administrator. Keep the Mac powered and reachable.
Bootstrap also needs Apple's Command Line Tools for Git. On a fresh target, run
`xcode-select --install` and finish the installation dialog before setup. The
helper checks this prerequisite without opening the installer or changing host
settings; a base VM with development tools already installed does not test it.
On the client: install the CLI and sign in to GitHub CLI for private-repo access.
Use local 1Password desktop integration if choosing its credential adapter.

## Three stages

**Connect.** Select the host. The wizard checks SSH, offers first-use host trust
and public-key installation when needed, and reads macOS/account/storage facts.
Changed saved host keys are blocked. SSH-agent keys stay in your agent.

**Prepare.** Attach the configuration repository once. The wizard creates or
reuses private age identities, asks you to back them up, and prepares encrypted
host secrets. Publish only the review directory through your repository review
process; never commit the adjacent identity or plaintext token files.

**Review & set up.** The CLI uses the helper installed alongside it and the exact
configuration commit it fetched. It fills in saved credential paths. Review the
repository, host, administrator and enabled services before typing the host name
to authorize setup. Only then are credentials transferred and Nix installed on
the target. Evaluated Nix facts must match the reviewed manifest.

## If something stops

| Situation | Next step |
| --- | --- |
| Command Line Tools unavailable | Install or repair the tools on the target; verify `/usr/bin/git --version` before retrying |
| SSH unavailable | Check address, Remote Login and saved host identity |
| Vault locked | Unlock 1Password; retry the credential step |
| Key issuance uncertain | Inspect Tailscale auth keys; do not issue another blindly |
| Encryption failed | Read cleanup result; preserve identities and inspect local state |
| Setup interrupted | Inspect the target journal before choosing resume |
| Host not ready | Review host settings and encrypted secrets in Git |

Do not delete journals or regenerate keys to bypass a blocked step. The wizard
resumes only phases it can establish are safe. A completed bootstrap is followed
by separate Tailscale, reboot and service checks; it does not approve migration.
