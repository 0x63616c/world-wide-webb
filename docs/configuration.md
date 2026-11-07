# Configuration contract

Put [homelab.json](../examples/homelab.json) at the root of your configuration
repository on `main`. The wizard attaches using `owner/repository` and reads an
exact commit through your local GitHub CLI authentication.

| Field | Purpose |
| --- | --- |
| `$schema` | Optional editor hint; the CLI never fetches it |
| `schema` | Use `2` for new configuration; historical `1` remains readable |
| `onePassword.backupVault` | Explicit vault for host/recovery age-key backups; required in version 2 |
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
- Comin, its `com.github.nlewo.comin` launchd job and `/var/lib/homelab/comin.sock` status socket, configured
  to reconcile this repository's `main` branch after enrollment releases its hold.
- `etc/homelab/revision.json` with the exact `repository`, `host` and `revision`
  of the built system. Completion checks this against Comin's actual deployment.

Comin is required by this flow. This is a macOS/Nix contract, not a runner for
arbitrary setup scripts. The [synthetic VM flake](../tests/fixtures/vm-config/flake.nix)
shows the integration contract; its test credentials and health checks must not
be used for production.

On macOS, the updater must advance `/nix/var/nix/profiles/system` before native
activation. Completion requires that boot profile and the live `/etc/static`
tree to match `/run/current-system`; an updater status of "done" alone is not
sufficient. The fixture includes the required patch for its pinned Comin version.
Polling frequency belongs in your Nix configuration, not the CLI.

## Offline validation and editor support

Run `homelab config validate path/to/homelab.json` before publishing configuration.
It requires neither a terminal, a home directory, Nix nor network access. It reads
one regular JSON file up to 64 KiB and rejects unknown fields, unsupported versions
and invalid host, key and reference values. Errors contain fixed field paths;
unknown field names and invalid values are never copied into diagnostics.

The example points `$schema` at the committed
[version 2 JSON Schema](../schema/homelab-v2.schema.json). Editors may use that hint;
the CLI treats it as inert metadata. `homelab config schema` prints the same
Draft 2020-12 schema, generated from the Rust configuration types. CI checks for
schema drift and validates the example against both the schema and the authoritative
Rust semantic checks. The schema describes current authoring; it does not describe
all historical configuration the CLI can reconcile.

To migrate version 1, set `schema` to `2` and add an explicit
`onePassword: {"backupVault": "Homelab Recovery"}`. Choose the intended backup vault,
not a value inferred from the OAuth item. Existing version 1 files remain readable
for historical reconciliation. Fresh enrollment requires version 2; an existing
attempt must retain its verified key-backup state rather than silently choosing a
new vault. A historical attempt interrupted before verified backups fails closed.
Migrate it explicitly to version 2 with the same intended backup vault, preserving
local state so the existing keys and backup receipts can be recovered. Do not delete
state to bypass this check.

## Credentials

`onePassword.backupVault` receives verified backups of the host and recovery age
identities. `tailscale.oauth.vault` and `tailscale.oauth.item` locate the separate
OAuth issuer credential. These references may point to different vaults. They are
public configuration references, never passwords or tokens.

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
