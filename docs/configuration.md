# Configuration contract

Put [homelab.json](../examples/homelab.json) at the root of your configuration
repository on `main`. The wizard attaches using `owner/repository` and reads an
exact commit through your local GitHub CLI authentication.

| Field | Purpose |
| --- | --- |
| `schema` | Currently `1`; unknown fields and versions are rejected |
| `hosts` | Map of configuration names to administrator, SSH keys, readiness and services |
| `tailscale.tag` | Tag assigned to single-use enrollment keys |
| `tailscale.oauth` | Optional 1Password vault/item references, never secret values |

Your Nix configuration must import the same host facts, not maintain a second
list. Export them from `lib.setupPlan.hosts` in the flake. The bootstrap compares
the fetched manifest and evaluated Nix host facts with what you reviewed.
Administrator UID, authorized keys, readiness and service assignments must agree.
Keep `activationReady: false` until secrets and host access are reviewed.

The configuration repository also supplies `flake.lock`,
`bootstrap/installer.json` (reviewed Determinate installer URL and SHA-256), and
`secrets/<host>.sops.yaml`. It must build a system containing `homelab-host` for
privileged installation and verification. This is a macOS/Nix contract, not a
runner for arbitrary setup scripts.

## Credentials

The optional 1Password OAuth item needs `client-id` and a **concealed**
`client-secret` field. Grant only Tailscale Auth Keys Write for the configured tag.
The CLI requests a one-day, single-use, non-ephemeral enrollment key. It stores the
key inside host ciphertext; the reusable OAuth credential stays on the operator.
Manual hidden input remains available.

The credential-source interface separates the wizard from 1Password. Tests use
synthetic providers and local issuer fixtures. There is no dynamic plugin loader.

## Local state

Repository binding lives beside the private inventory in `repository.json`.
It refuses to switch repositories silently. Existing connection profiles,
SSH-agent identities and preparation files survive upgrades. If moving to a
second repository, migrate that state deliberately rather than reusing keys
by matching host name alone.
