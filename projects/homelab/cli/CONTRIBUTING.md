# Contributing

Keep the project focused: one guided enrollment flow for macOS, GitHub,
1Password and Tailscale. Ongoing infrastructure belongs in the configuration
repository. Prefer fewer steps and clear recovery over more options.

## Develop

Use an Apple silicon Mac with Apple's Command Line Tools, Rust 1.89 or newer,
and `just`, `age`, `sops` and `shellcheck` available on PATH.

```sh
just             # List commands
just dev         # Build homelab-dev / hl-dev and the matching helper
hl-dev preview   # Browse synthetic screens without accounts or a target
just check
just test
```

Public CI also checks the small SSH transport scripts and tests release binaries
on a fresh macOS runner without Nix. See [testing](docs/testing.md) for the exact
coverage and opt-in VM procedure. Normal tests must not contact real hosts,
vaults or tailnets.

The UI uses Ratatui with a shared frame, theme and persistent terminal buffer.
Keep rendering free of setup side effects. Use the existing provider and transport
boundaries for tests; do not add a second workflow or a generic plugin framework.
See [testing](docs/testing.md) for screen dumps, terminal tests and fixture coverage.

Keep screens consistent through the shared UI components:

- Fix the brand header and footer in place. Center questions and messages; center lists as an aligned group.
- Ask a question when a choice is required. Use descriptive titles for results and errors.
- Use ongoing wording and an animated spinner during work, past tense after success, and an honest failure or unknown state when verification fails.
- Keep loading and destination headings in the same position. Do not add intermediate screens for implementation steps.
- Highlight only the selected name; leave its marker unhighlighted. Mark unselected options with a hollow circle. Put the selected host’s muted status below the list, without right-hand icons.
- Use `ui::actions::Action` for footer shortcuts and matching input handlers. Status messages belong in the content; navigation appears only for choices or overflowing content. Put `? Help` last and the version at the right.
- Reuse `ui::components` for lists, fields, input and progress states. Keep values neutral, controls blue, and success/failure colors tied to actual state.
- Keep the repository link gray and underlined, without a label prefix.
- Update the synthetic preview with each presentation change; verify 40×12 as well as larger terminals.

## Propose a change

Open an issue to discuss changes to the setup flow or security model before a
large implementation. For a pull request, explain the user-visible problem,
the resulting behavior and how you verified it.

- Keep orchestration typed and errors actionable. Avoid inline shell for policy.
- Preserve existing user state, host trust and interrupted-operation recovery.
- Keep secrets out of logs, command arguments, fixtures and Git history.
- Test meaningful failure boundaries with synthetic credentials. Live VM tests
  require an explicitly designated disposable guest.
- Update user documentation when the flow or prerequisites change.

Do not post credentials, private keys, unredacted state files or sensitive host
logs in issues. Report ordinary bugs with the CLI version, macOS version,
expected behavior and a redacted error message.
