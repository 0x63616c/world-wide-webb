# Testing

## Automatic checks

Public CI uses disposable standard GitHub-hosted macOS runners. It checks Rust
formatting, Clippy, native compilation and tests. Test credentials, SSH tools and
issuer endpoints are synthetic; CI cannot access an operator's vault or tailnet.

| Layer | Evidence |
| --- | --- |
| Pure logic | Manifest validation, host binding, lifecycle and failure cases |
| Adapters | Fixture executables and local HTTP servers; no real accounts |
| Terminal | Pseudo-terminal keyboard input, secret non-echo and terminal restoration |
| Packaging | Native ARM64 binaries, macOS-only dynamic dependencies, fresh-runner help smoke |

Run locally with `cargo test --locked`, `cargo fmt --check` and
`cargo clippy --locked --all-targets -- -D warnings`.

## Full machine rehearsal

A successful CI suite does **not** prove a fresh install and reboot work end to end.
Use a disposable Apple-silicon Mac VM or a dedicated test Mac for that layer:

1. Restore a clean macOS snapshot with a synthetic admin and SSH access.
2. Drive the same CLI with fixture credentials and an isolated configuration.
3. Install Nix and activate only test services.
4. Reboot; verify SSH, launchd startup, secret permissions and idempotent retry.
5. Repeat with interrupted downloads, interrupted builds and failed health checks.
6. Restore the snapshot before the next run.

This full-machine harness is a follow-up, not a check claimed by this release.
Production Macs are never automatic test fixtures. Real 1Password authorization
is a separate adapter smoke test; unlocking a vault is not bypassed by automation.
