# Homelab

The MacBook and Mac mini are configured from this repository. Host modules,
services, disposable runners and the setup CLI live under `projects/homelab/`. Checked
changes move from authoring `main` to `deploy/homelab`; Comin follows that
promotion branch. Read [current state](docs/current-state.md) before a live
host or service change.

## Source and checks

The Nix flake and lockfile live at `projects/homelab/flake.nix` and
`projects/homelab/flake.lock`. The host manifest (`homelab.json`), installer pin
(`bootstrap/installer.json`) and encrypted host files (`secrets/`) live beside it.
The CLI reads the project paths for new setup and retains approved old revisions for recovery. Comin is
configured to read the `projects/homelab` subdirectory of the promoted repository.

From the repository root:

```sh
nix flake check ./projects/homelab --no-update-lock-file --print-build-logs
nix develop ./projects/homelab --command python3 -m unittest discover -s projects/homelab/tests
cargo test --locked --manifest-path projects/homelab/cli/Cargo.toml
cargo test --locked --manifest-path projects/homelab/host/Cargo.toml
cargo test --locked --manifest-path projects/homelab/runner/Cargo.toml
```

These checks do not activate a host. `scripts/dev homelab <area>` runs focused
local checks. CI selects configuration, host, runner and CLI checks separately.
The [setup CLI](cli/README.md) builds from filtered local Nix sources; unrelated
apps are not included in its package input.

## Enrollment and updates

Install the public CLI with `brew install 0x63616c/tap/homelab`, run `homelab`
and attach `0x63616c/world-wide-webb`. It reads this project's `homelab.json`, prepares
per-host encrypted configuration and verifies the approved install after reboot.
See [setup](docs/setup.md) for prerequisites and recovery.

After enrollment, Comin checks `deploy/homelab` every 30 seconds with a read-only
Git deploy key. Homelab CI and the promotion workflow control that ref after
successful selected main runs. The existing stateful transaction owns backup,
activation, reconciliation and health. A main merge alone is not a host
activation. See [updates](docs/updates.md) and [releases](docs/releases.md).

| Host | Current role |
| --- | --- |
| `homelab-macbook` | Disposable macOS and Linux runner guests; non-admin `coding` account. |
| `homelab-mac-mini` | Production application services, including Control Center and monitoring. |

The runner controller admits four jobs in total and at most two macOS guests.
Jobs run in disposable guests; the host keeps the GitHub App key. See
[runner validation](docs/research/runner-validation.md) and
[Linux runners](docs/linux-runners.md). Host identities, encrypted secrets and
service data stay outside generated images and Git plaintext.

## Operations

- [Current state](docs/current-state.md), [operations](docs/operations.md) and [secrets](docs/secrets.md)
- [Service updates](docs/updates.md), [backup and recovery](docs/restore-rehearsal.md)
- [Golink](docs/golink.md), [monitoring](docs/beszel-plan.md) and [Control Center deployment](docs/releases.md)
- [Setup CLI](cli/README.md) and [configuration contract](cli/docs/configuration.md)

Historical plans and migration receipts remain under `docs/`; use current code,
runbooks and live readback for operational decisions.
