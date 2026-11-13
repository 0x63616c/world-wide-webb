# Coding account

The MacBook's non-admin `coding` account runs Rex and agents. `modules/coding.nix`
installs Nix zsh, chezmoi, gh, ripgrep, Starship, shell plugins and Claude Code.
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

## Development dependencies

Use each project's Nix dev shell and lockfiles for runtimes and project packages.
`nix shell nixpkgs#<package>` can supply an experimental tool temporarily; pin the
input when the experiment must be repeatable. A recurring host-level tool belongs
in `modules/coding.nix` through reviewed CI/promotion. Claude instructions describe
this convention; they are not a package-installation sandbox.

Use separate worktrees for simultaneous agents. Cursor on the personal Mac can
open the same remote worktree over SSH; Rex retains agents when clients disconnect.
Host reboot or Rex server replacement interrupts running processes.
