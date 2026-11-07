# Contributing

Keep the project focused: one guided enrollment flow for macOS, GitHub,
1Password and Tailscale. Ongoing infrastructure belongs in the configuration
repository. Prefer fewer steps and clear recovery over more options.

## Develop

Use an Apple silicon Mac with Apple's Command Line Tools, Rust 1.89 or newer,
and `age`, `sops` and `shellcheck` available on PATH.

```sh
cargo build --locked --bins
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
```

Public CI also checks the small SSH transport scripts and tests release binaries
on a fresh macOS runner without Nix. See [testing](docs/testing.md) for the exact
coverage and opt-in VM procedure. Normal tests must not contact real hosts,
vaults or tailnets.

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
