# Configuration contract

Put [homelab.json](../examples/homelab.json) at the root of your configuration
repository on `main`. The wizard attaches using `owner/repository` and reads an
exact commit through your local GitHub CLI authentication.

| Field | Purpose |
| --- | --- |
| `schema` | Currently `1`; unknown fields and versions are rejected |
| `hosts` | Map of configuration names to administrator, SSH keys, readiness and services |
| `tailscale.tag` | Tag assigned to single-use enrollment keys |
| `tailscale.oauth` | 1Password vault/item references required for enrollment, never secret values |

Your Nix configuration must import the same host facts, not maintain a second
list. Export them from `lib.setupPlan.hosts` in the flake. The bootstrap compares
the fetched manifest and evaluated Nix host facts with what you reviewed.
Administrator UID, authorized keys, readiness and service assignments must agree.
Keep `activationReady: false` until secrets and host access are reviewed.

The configuration repository also supplies `flake.lock` and
`bootstrap/installer.json` (reviewed Determinate installer URL and SHA-256).
Enrollment creates `secrets/<host>.sops.yaml` in its PR; you do not prepare that
file manually.

The built system must supply:

- `homelab-host` for privileged installation and verification.
- `homelab-health`, which exits successfully only when the configured services
  are healthy, and the `tailscale` CLI for node verification.
- Comin, its `com.github.nlewo.comin` launchd job and `/run/comin-grpc.sock` status socket, configured
  to reconcile this repository's `main` branch after enrollment releases its hold.
- `etc/homelab/revision.json` with the exact `repository`, `host` and `revision`
  of the built system. Completion checks this against Comin's actual deployment.

Comin is required by this flow. This is a macOS/Nix contract, not a runner for
arbitrary setup scripts. The [synthetic VM flake](../tests/fixtures/vm-config/flake.nix)
shows the integration contract; its test credentials and health checks must not
be used for production.

## Credentials

The 1Password OAuth item needs `client-id` and a **concealed**
`client-secret` field. Grant only Tailscale Auth Keys Write for the configured tag.
The CLI requests a one-day, single-use, non-ephemeral enrollment key. It stores the
key inside host ciphertext; the reusable OAuth credential stays on the operator.
Enrollment requires this item; the wizard does not ask you to paste tokens.

1Password and Tailscale are the supported setup. Internal test boundaries allow
synthetic providers and local issuer fixtures without accessing real accounts.
There is no dynamic plugin loader or provider-selection workflow.

## Local state

Repository binding lives beside the private inventory in `repository.json`.
It refuses to switch repositories silently. Existing connection profiles,
SSH-agent identities and preparation files survive upgrades. If moving to a
second repository, migrate that state deliberately rather than reusing keys
by matching host name alone.
