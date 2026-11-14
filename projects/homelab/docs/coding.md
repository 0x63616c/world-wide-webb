# Coding account

The MacBook's non-admin `coding` account runs Rex and agents. `modules/coding.nix`
installs Nix zsh, chezmoi, gh, ripgrep, Starship, wtp, xcodes, shell plugins and Claude Code.
Git, curl and jq are already shared host tools. The Mini does not import this module.
The account's login shell and Rex's new terminal shell use Nix zsh. Updating Rex's
launch environment restarts its server, so finish any active remote tasks first.

## Files and updates

`0x63616c/dotfiles` owns the shared shell files, the `coding` shell profile,
selected Claude settings and `~/.claude/CLAUDE.md`. Its coding profile ignores
personal GUI settings, SSH keys, Git signing configuration, Homebrew bootstrap
and every chezmoi script. Nix/Comin owns packages; chezmoi owns these home files.
Neither manages provider credentials or copies the personal Mac's private keys.

After the Nix deployment, as `coding`:

```sh
chezmoi init 0x63616c --promptString 'Shell profile=coding'
chezmoi diff
chezmoi apply
```

The profile is persisted by init. The account name `coding` also selects it as
an initial default; an explicit local profile wins. Later `chezmoi update` pulls
and reapplies it. No additional updater/launchd writer is installed for dotfiles.
The dotfiles README describes file ownership and profile rendering checks.

Claude's package is the official native binary pinned in `packages/claude-code.nix`.
Its Nix wrapper disables self-updates. Update version, official
manifest checksum and URL together through a normal homelab PR; never update all
nixpkgs inputs just to change Claude. Provider sign-in is a separate interactive
step: open a Rex terminal, run `claude`, and follow the login flow. A version/doctor
check does not prove authentication or a model request has succeeded.

## Xcode

`modules/coding.nix` records the host's Xcode version in one `xcodeVersion`
binding (currently 27.2.0, at `/Applications/Xcode-27.2.0.app`). Downloading
Xcode needs the owner's interactive Apple ID and 2FA, so activation never
downloads it. When the bundle exists, activation selects it, accepts the license
and runs first launch, each only when needed. A missing bundle or iOS Simulator
runtime prints a warning with the commands below; activation still succeeds.

Install or bump, as `admin` on the MacBook (xcodes prompts for the Apple ID):

```sh
sudo /run/current-system/sw/bin/xcodes install 27.2.0 --directory /Applications --experimental-unxip --select
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch
sudo xcodebuild -downloadPlatform iOS
```

Before the first deployment that adds xcodes, use `nix run nixpkgs#xcodes --`
in place of the installed path. To bump, install the new version, then promptly
change `xcodeVersion` and the version asserted by the `coding-account` check in
`flake-outputs.nix` through a homelab PR; until it is promoted, each activation
reselects the recorded version. Remove the old bundle by hand once unused.

## Development dependencies

Use each project's Nix dev shell and lockfiles for runtimes and project packages.
`nix shell nixpkgs#<package>` can supply an experimental tool temporarily; pin the
input when the experiment must be repeatable. A recurring host-level tool belongs
in `modules/coding.nix` through reviewed CI/promotion. Claude instructions describe
this convention; they are not a package-installation sandbox.

Use separate worktrees for simultaneous agents. Cursor on the personal Mac can
open the same remote worktree over SSH; Rex retains agents when clients disconnect.
Host reboot or Rex server replacement interrupts running processes.
