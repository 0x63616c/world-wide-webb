# homelab

Private configuration for the macOS homelab. **Deployment is still disabled.**
The existing Mac mini remains the production system; nothing is wiped or migrated
by merging this repository.

## Start here

Install the public [homelab CLI](https://github.com/0x63616c/homelab-cli), open
`homelab`, and attach **`0x63616c/homelab`** when asked.

1. On the target Mac, create its administrator and enable Remote Login.
2. In the CLI, select the Mac, attach this repository and review setup.
3. The wizard backs up keys, prepares encrypted secrets and opens an enrollment PR.
4. Review and merge that PR; the wizard installs, reboots and verifies the Mac.

This is the upcoming enrollment flow; wait for the CLI release before starting.

The CLI ships its bootstrap helper. Your personal laptop needs neither Nix nor a local
bootstrap build. Nix is installed and runs on the target only after approval.
See the short [setup guide](docs/setup.md).

## Architecture

```mermaid
flowchart TB
  Public[Public homelab-cli: tool and installer] --> Laptop[Personal laptop]
  Vault[1Password: credentials and recovery] --> Laptop
  Config[Private homelab: manifest, Nix, encrypted secrets] --> Laptop
  Laptop -->|Reviewed SSH setup| Book[MacBook: first migration destination]
  Laptop -->|Later approved rebuild| Mini[Mac mini: current production]
  Config -->|Exact approved commit| Book
  Config -->|Exact approved commit| Mini
  App[world-wide-webb: app and Cloudflare ownership] --> Images[Pinned application images]
  Images --> Book
  Book --> Backup[Verified recovery copies]
```

| Component | Responsibility |
| --- | --- |
| Public CLI | Guided setup, SSH, credential adapters, portable bootstrap |
| This repository | Desired host state, services, encrypted secrets, private health/restore checks |
| `homelab.json` | Host facts shared by the CLI and Nix; no duplicate host lists |
| 1Password | Operator credentials and recovery keys; never installed on nodes |
| SOPS + age | Encrypted Git secrets; each node gets only its own key |
| Comin | Pull and apply reviewed changes from `main` after enrollment |
| launchd | Start services at boot, including Comin |

## Hosts

| Host | Hardware | Administrator | Intended first role |
| --- | --- | --- | --- |
| `homelab-macbook` | M2, 32 GB, about 500 GB | `admin` | Safe migration destination; one runner later |
| `homelab-mac-mini` | M2, 8 GB | `calum` | Keep production running until verified cutover |

## What a merge does

After a Mac completes enrollment, Comin checks `main` every five minutes and applies
changes automatically. The interval is declared as `poller.period = 300` in
[`modules/updates.nix`](modules/updates.nix). Review and
test before merging; the node uses a read-only deploy key and needs no Actions token.
The wizard holds its approved commit through setup and reboot, then verifies the
handover to Comin. See [how updates work](docs/updates.md).

No real Mac has received this configuration. Host readiness remains false until
its enrollment PR is approved; application services and runners remain disabled.
Private Nix checks and the full disposable enrollment/reboot/Comin replay passed.
The separate scheduled-update test and final artifact/release validation remain
pending. See [VM evidence](docs/vm-validation.md) for exact revisions and limits.
Private Actions workflows are manual-only until self-hosted runners are ready;
routine validation runs in the disposable Mac VM without paid private CI minutes.

## Find the details

- [Setup and adding a host](docs/setup.md)
- [CLI separation plan](docs/cli-extraction-plan.md)
- [Disposable VM validation](docs/vm-validation.md)
- [Current-state research](docs/current-state.md)
- [Migration plan](docs/plan.md) · [Implementation status](docs/implementation-status.md)
- [Secrets](docs/secrets.md) · [Updates](docs/updates.md) · [Operations](docs/operations.md)
- [Application ownership](docs/releases.md) · [Recovery rehearsal](docs/restore-rehearsal.md)

`world-wide-webb` keeps application source and current Cloudflare management.
Only the tunnel process transfers at an explicitly reviewed service cutover.
