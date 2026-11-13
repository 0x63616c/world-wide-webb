# Configuration contract

Put [homelab.json](../examples/homelab-v3.json) at the root of your configuration
repository on `main`. The wizard attaches using `owner/repository` and reads an
exact commit through your local GitHub CLI authentication. Version 3 discovers the deployment
policy on main, then reads the exact `deploy/homelab` commit. Missing or incompatible deployment
refs stop setup; authoring main is never a fallback. Historical versions 1 and 2 retain their
original main-branch behavior for existing recovery records.

| Field | Purpose |
| --- | --- |
| `$schema` | Optional editor hint; the CLI never fetches it |
| `schema` | Use `3`; historical `1` and `2` remain readable |
| `deployment` | Required in v3: matching `repository` and `branch: "deploy/homelab"` |
| `onePassword.backupVault` | Explicit vault for host/recovery age-key backups; required in versions 2 and 3 |
| `hosts` | Map of configuration names to administrator, SSH keys and services |
| `tailscale.tag` | Tag assigned to single-use enrollment keys |
| `tailscale.oauth` | 1Password vault/item references required for enrollment, never secret values |

Your Nix configuration must import the same host facts, not maintain a second
list. Export them from `lib.setupPlan.hosts` in the flake. The bootstrap compares
the fetched manifest and evaluated Nix host facts with what you reviewed.
Administrator UID, authorized keys and service assignments must agree.
Setup validates those prerequisites and encrypted secrets before installation;
there is no setup-progress flag in desired configuration. Historical manifests with
`activationReady` remain readable for saved-attempt compatibility, but new
configuration must omit it.

The Git host name is also the required macOS local hostname. The CLI derives
`adminUser@<host-name>.local`; there is no address override in Git or local settings.
Initial setup requires local-network reachability before Tailscale enrollment.

The configuration repository supplies a locked flake at its root or under
`homelab/`, plus `bootstrap/installer.json` (reviewed Determinate installer
URL and SHA-256). WWW uses `homelab/flake.nix` and `homelab/flake.lock`;
its host configuration, Comin and CLI all select that same subdirectory.
Enrollment creates `secrets/<host>.sops.yaml` and commits its encrypted contents
with the host configuration. A PR is used when review is required; you do not
prepare the file manually.

The built system must supply:

- `homelab-host` for privileged installation and verification.
- `homelab-health`, which exits successfully only when the configured services
  are healthy, and the `tailscale` CLI for node verification.
- Comin, its `com.github.nlewo.comin` launchd job and `/var/lib/homelab/comin.sock` status socket, configured
  to reconcile the configured deployment branch after enrollment releases its hold.
- `etc/homelab/revision.json` with the exact `repository`, `branch`, `host` and `revision`
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

The historical example retains its [version 2 JSON Schema](../schema/homelab-v2.schema.json).
Current authoring uses the packaged [version 3 JSON Schema](../schema/homelab-v3.schema.json).
Its `urn:homelab:configuration:v3` identifier needs no public source endpoint; configure an
editor's local schema mapping when needed. The CLI treats `$schema` as inert metadata.
`homelab config schema` prints the current
Draft 2020-12 schema, generated from the Rust configuration types. CI checks for
schema drift and validates the example against both the schema and the authoritative
Rust semantic checks. The schema describes current authoring; it does not describe
all historical configuration the CLI can reconcile.

To migrate version 1, set `schema` to `2` and add an explicit
`onePassword: {"backupVault": "Homelab Recovery"}`. Choose the intended backup vault,
not a value inferred from the OAuth item. Existing version 1 files remain readable
for historical reconciliation. Fresh enrollment requires version 2 or 3; an existing
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

Git's manifest defines hosts, administrator accounts, authorized keys and services.
The Nix configuration and encrypted secrets in the same repository define what each
Mac should run. Setup progress is recorded separately.

| Local path | Purpose |
| --- | --- |
| `~/.homelab/profiles/default/repository.json` | Selected `owner/repository` and format version |
| `~/.homelab/profiles/default/inventory.json` | Selected SSH public key/agent and legacy host-to-journal bindings; saved addresses do not control routing |
| `~/.homelab/profiles/default/inventory.json.lock` | Coordinates safe updates; not configuration |
| `~/.homelab/profiles/default/provisioning/` | Private age identities, verified backup receipts, encrypted preparation files and resumable setup journals |
| `~/.homelab/cache/release.json` | Historical release-check cache; preserved and ignored |

SSH host trust stays in the normal SSH known-hosts files. Private SSH keys stay
in your SSH agent; the connection cache stores only its selected public key and
agent socket reference. The provisioning directory does contain private age
identities, so preserve it when recovering interrupted setup.

`homelab`, `hl`, `homelab-dev` and `hl-dev` share this operator state. Do not run
two setup sessions for the same host concurrently. Existing aliases and SSH-agent
identities survive upgrades; ambiguous historical bindings stop for inspection.
Saved approved setups retain their pinned Git revision rather than substituting
`main`. A removed host remains available for recovery and is labeled accordingly.
A verified report from the Mac establishes setup completion; manifest fields and
saved progress alone do not prove that the device is currently set up.

Repository binding refuses to switch repositories silently. If moving to a
second repository, migrate that state deliberately rather than reusing keys
by matching host name alone.

On startup, legacy config, provisioning and cache files move automatically into
`~/.homelab/`. Migration preserves file contents and permissions and refuses to
overwrite conflicting state. Close older CLI sessions before upgrading. Use the
updated CLI after migration; older releases still use the previous locations.

Named profiles (`hl --profile demo`) use
`~/.homelab/profiles/demo/` and
`~/.homelab/profiles/demo/provisioning/` instead. They do not copy
or read the default profile's repository binding, key choice or setup journals.
`default` selects `~/.homelab/profiles/default/`. Names are limited to 32 lowercase letters,
digits, hyphens and underscores, beginning with a letter.

GitHub/1Password/Tailscale sign-ins, SSH known-hosts and the public release cache
remain shared. Profiles isolate local progress, not remote resources: enrolling
from a profile still changes the selected Git repository and target Mac. A new
profile can restore the same repository's recovery keys from its configured vault.

## Deployment handover

Version 3 declares `deployment: {"repository": "0x63616c/world-wide-webb", "branch": "deploy/homelab"}`.
Host metadata, Comin and the CLI use that same policy. All three observed Comin branch fields
must match the installed branch; source revision, live system and fresh successful fetch remain
required. Historical installed metadata without `branch` means main, never the new deployment ref.

This source contract does not establish a live cutover. Seed the deployment ref,
install the scoped host Git identity, implement promotion/enrollment coordination and explicitly
rebind preserved operator state before enabling the new writer. Enrollment proposals still target
authoring main; they need successful checks and coordinated promotion before installation.
Never delete old approved journals or substitute a newer commit to make an old receipt pass.
