# Show available commands without starting a build.
default:
    @just --list

# Build the local CLI and matching helper, and link hl-dev / homelab-dev.
dev:
    HOMELAB_DEV_REVISION="$(git rev-parse --short=8 HEAD)$(git diff --quiet HEAD -- || printf '%s' '-dirty')" cargo build --locked --features local-dev --bins --target-dir target/dev
    mkdir -p "$HOME/.local/bin"
    ln -sfn "$PWD/target/dev/debug/homelab" "$HOME/.local/bin/homelab-dev"
    ln -sfn "$PWD/target/dev/debug/homelab" "$HOME/.local/bin/hl-dev"

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
