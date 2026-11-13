# Coding account

The MacBook's non-admin `vov` account runs Rex and agents. `modules/coding.nix`
installs Nix zsh, chezmoi, gh, ripgrep, Starship, shell plugins and Claude Code.
Git, curl and jq are already shared host tools. The Mini does not import this module.
The account's login shell and Rex's new terminal shell use Nix zsh. Updating Rex's
launch environment restarts its server, so finish any active remote tasks first.

The login is `vov` (UID 502); its existing home remains `/Users/coding` deliberately.
This preserves Claude's project paths, credentials and Rex state without moving files.
The dotfiles role remains named `coding`; prompts and remote connections use `vov`.

## Files and updates

`0x63616c/dotfiles` owns the shared shell files, the `coding` shell profile,
selected Claude settings and `~/.claude/CLAUDE.md`. Its coding profile ignores
personal GUI settings, SSH keys, Git signing configuration, Homebrew bootstrap
and every chezmoi script. Nix/Comin owns packages; chezmoi owns these home files.
Neither manages provider credentials or copies the personal Mac's private keys.

After the Nix deployment, as `vov`:

```sh
chezmoi init 0x63616c --promptString 'Shell profile=coding'
chezmoi diff
chezmoi apply
```

The profile is persisted by init. The account names `vov` and legacy `coding` also select it as
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

## Existing-account rename

The `coding` → `vov` login rename preserves UID 502, GeneratedUID, group memberships,
password/keychain and `/Users/coding`. Do not delete/recreate the account or move
its home. The shared shell profile is a role and remains `coding`.

On an existing MacBook, the operator must finish agent jobs and stop Rex and old
SSH sessions before the account cutover. From the separate `admin` account, pause
Comin only after confirming its transaction is idle, preserve the account identity,
rename its Directory Service RecordName and named group memberships, then resume
Comin against the checked deployment. The existing numeric-ID collision guard
refuses a new `vov` account while UID 502 still belongs to `coding`; it never adopts
an unrelated account. A new installation creates `vov` directly.

Apply the dotfiles update after the cutover, retaining `profile = "coding"`.
Verify `id vov`, an SSH login as `vov`, a fresh Rex terminal and Documents access.
The signed Rex Full Disk Access identity is unchanged. Reverting Nix alone does
not reverse the account rename: a rollback must restore RecordName/group names
before reactivating the old configuration. Keep `admin` SSH available throughout.
