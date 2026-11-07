# Show available commands without starting a build.
default:
    @just --list

# Install development launchers; source changes rebuild automatically on launch.
dev:
    sh scripts/dev --version
    mkdir -p "$HOME/.local/bin"
    rm -f "$HOME/.local/bin/homelab-dev"
    printf '#!/bin/sh\nexec sh "%s/scripts/dev" "$@"\n' "$PWD" > "$HOME/.local/bin/homelab-dev"
    chmod +x "$HOME/.local/bin/homelab-dev"
    ln -sfn homelab-dev "$HOME/.local/bin/hl-dev"

# Build and explore synthetic screens without credentials or a target Mac.
preview: dev
    target/dev/debug/homelab preview

# Run local logic, adapter and terminal tests; VM operations stay disabled.
test:
    cargo test --locked

# Run pseudo-terminal input and terminal restoration tests.
test-terminal:
    cargo test --locked --test terminal

# Check formatting and Rust lint warnings.
check:
    cargo fmt --check
    cargo clippy --locked --all-targets -- -D warnings

# Enroll an explicitly configured disposable VM (private fixture required).
test-vm fixture:
    cargo test --locked --test vm_enrollment -- --run {{quote(fixture)}}
