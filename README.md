# homelab-cli

**Set up a Mac. Manage it from Git.**

A guided terminal installer for Apple silicon macOS homelabs. Connect to a new
Mac, approve its configuration, and let the wizard handle credentials,
installation and reboot checks. Afterwards, your configuration repository owns
ongoing changes.

## What it handles

- **Connect:** verify the Mac and use your existing SSH key, including keys in
  the 1Password SSH agent.
- **Prepare:** create encryption identities, back them up to 1Password and verify
  those backups. Create a scoped Tailscale enrollment key and encrypt it.
- **Publish:** give the Mac its own read-only Git deploy key and commit its
  encrypted enrollment configuration to `main`. Use a PR when review is required.
- **Set up:** install the approved configuration, reboot and
  verify services, Git access and Tailscale SSH.
- **Resume:** keep the approved attempt and recovery state if setup stops.

Nix runs on the target Mac. You do not need Nix on your personal laptop.

## How it works

![Your laptop enrolls each Mac once. Each node runs SSH, Tailscale, Nix, nix-darwin and Comin. Comin pulls configuration from your private GitHub repo. Optional containers and runner VMs are configured separately.](docs/images/architecture.svg)

The public CLI contains the installer and tests. **Your own repository contains
hosts, services, Nix configuration and encrypted secrets.** This enrollment flow
requires Comin for updates: merging to `main` authorizes the next deployment.
The CLI finishes after enrollment.

## Requirements

| Where | What you need |
| --- | --- |
| Your laptop | Apple silicon macOS; GitHub CLI signed in; 1Password with its `op` CLI and desktop integration; the standalone Tailscale app and CLI, connected to your tailnet |
| New Mac | Apple silicon macOS; an administrator account; Remote Login enabled for that account; local hostname matching the Git host name; power and the same LAN as your laptop |
| Configuration | A GitHub repository implementing the [configuration contract](docs/configuration.md), including a locked nix-darwin flake |
| Tailscale | A tag-scoped OAuth credential saved in 1Password, and tailnet policy allowing your administrator's Tailscale SSH connection |

**1Password and Tailscale are required.** There is no provider-selection step.
The target receives its own scoped credentials; it does not receive your
1Password login or GitHub account token.

## Get started

Install the published CLI:

```sh
brew install 0x63616c/tap/homelab
homelab
```

`hl` is the short name for the same installed CLI.

Setup starts with three choices, then runs as a live checklist:

1. **Open your repository.** Enter `owner/repository` once. Git supplies the host
   list, administrator accounts and desired configuration.
2. **Choose your Mac.** The CLI connects to `adminUser@host-name.local` from Git.
   Your selected SSH identity is reused; missing developer tools install automatically.
3. **Begin setup.** Approve preparation, publication to Git, installation and
   reboot once. The checklist advances automatically and asks for attention only
   when needed, such as native authentication or a required PR review.

If repository rules require a PR, its link appears in the checklist; **O** opens
it in your browser. Setup continues automatically after merge. Existing saved
PRs keep their review path. Success means reboot and access checks passed and
Git-managed updates are enabled.

Use **↑ / ↓** to choose, **Enter** to continue and **Esc** to go back. To reopen a
saved attempt, select the same host again. `homelab setup --host NAME` also works.

Local files remember the repository, selected SSH identity and recovery progress.
Git owns the host and administrator; the SSH address is always `<host-name>.local`.
Existing keys and setup journals survive this upgrade.

Administrator authentication may be needed during setup. FileVault can require
someone to unlock the target locally after reboot. See the [setup guide](docs/setup.md)
for prerequisites and recovery; do not delete saved keys or journals to bypass an error.

## Local development

To try the real first-run flow with fresh local state:

```sh
hl-dev --profile demo
```

Enter your Git repository at the first prompt. The profile name appears in the
header. Reusing `demo` resumes it; use another name to start fresh again. Plain
`hl-dev` (or `--profile default`) keeps your existing setup.

Profiles separate repository selection, SSH key selection and recovery progress.
They share installed tools, external sign-ins and SSH host trust. This is the real
wizard, not a dry run; use `hl-dev preview` for screens without setup operations.

The footer shows the installed version. Interactive setup checks the public GitHub
release endpoint in the background, at most once every six hours, and shows newer
versions without installing them. It sends no setup data or credentials. Set
`HOMELAB_NO_UPDATE_CHECK=1` to disable this check; previews never perform it.

With Rust and Just installed (`brew install just`), run `just dev` from this checkout. It incrementally
builds both the CLI and its matching helper, then links `homelab-dev` and `hl-dev`
in `~/.local/bin` (that directory must be on your PATH). Run either name to try
the local version; rerun `just dev` after editing code. No GitHub release is needed.
Run plain `just` to list the available commands and their descriptions.

Try the interface without accounts or a target Mac:

```sh
just preview
# Or, after building:
hl-dev preview --screen progress
# Write a plain-text rendering for review, without a terminal:
hl-dev preview --screen progress --dump --width 100 --height 30
```

Preview uses synthetic examples and the same renderer as setup. Use **← / →**
to browse host selection, summary, progress, attention, completion, input and help
screens. It never reads saved setup state or contacts GitHub, Tailscale or
1Password. The example actions do not perform setup.

Run `just test` for automated local checks, `just test-terminal` for terminal
interaction, and `just check` for formatting and lints. See [Testing](docs/testing.md)
for explicitly selected disposable-VM rehearsals.

Development builds show `VERSION-dev(#COMMIT)` in `--version` and the screen
footer, with `-dirty` when tracked files differ from that commit. They use a
separate build directory and leave the Homebrew release untouched. Both versions
use the same saved connections and setup journals; run one setup session at a time.
Building alone never starts setup or deploys a machine.

## Security and scope

- Recovery identities stay off the target. Backups are verified before setup proceeds.
- Secrets are encrypted before being committed to Git. Each Mac gets read-only
  repository access and a single-use Tailscale enrollment key.
- Setup binds to the reviewed configuration and trusted host identity. An uncertain
  installation or activation stops for inspection rather than being repeated blindly.
- The wizard does not migrate applications, register runners or erase machines.
  Those changes belong in your infrastructure project.

This is an early project. Synthetic tests and disposable-VM rehearsals have
[different coverage and limits](docs/testing.md); they do not establish that your
production services or tailnet policy are correct.

## Documentation

When editing your configuration, use the [editor schema](schema/homelab-v2.schema.json)
for autocomplete and run `homelab config validate ./homelab.json` to check it
offline. The schema describes the host fields and 1Password references; secrets
never belong in the manifest.

- [Setup and recovery](docs/setup.md) — prerequisites, authentication and interrupted setup.
- [Configuration contract](docs/configuration.md) — connect your private Nix repository.
- [Example manifest](examples/homelab.json) — host facts and credential references, not a complete flake.
- [Testing](docs/testing.md) — automated checks and disposable macOS rehearsals.
- [Contributing](CONTRIBUTING.md) — build, test and propose changes.

## License

[MIT](LICENSE).
