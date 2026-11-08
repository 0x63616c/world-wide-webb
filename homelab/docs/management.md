# Managing the homelab

Use the public [homelab CLI](https://github.com/0x63616c/homelab-cli) from your
personal Mac. This private repository contains configuration and host operations,
not a second copy of the operator application.

## Start or resume enrollment

Run `homelab`, choose a saved connection and press **Enter**. The wizard handles
first SSH access, remembers the selected identity and repository binding, and
leads through enrollment. `homelab setup --host NAME` opens the same flow for a
saved connection. This is an enrollment interface, not a general management
dashboard. See [setup](setup.md) for target prerequisites.

The operator needs no local Nix or compiler. Review configuration offline with
`homelab config validate homelab.json`. Schema 2 explicitly names the backup vault
in `onePassword.backupVault`; the separate `tailscale.oauth` references locate the
issuer credential. Neither field contains secret values.

## Credentials and approval

| Connection or purpose | Credential |
| --- | --- |
| Operator → GitHub | Existing local GitHub CLI authentication |
| Operator → target | Selected SSH key, including a local 1Password agent identity |
| Recovery | Host and recovery age identities backed up and read back through client-side 1Password |
| Tailscale enrollment | Single-use auth key issued through the configured OAuth item |
| Target → GitHub | Target-generated, repository-scoped read-only SSH deploy key |
| Target secret decryption | Host-specific age identity; recovery identity stays off the target |

The wizard does not ask for manually pasted tokens. Password-manager access and
reusable OAuth credentials stay on the operator. Private SSH keys are not copied
from the operator to the target. Native SSH handles any administrator password
prompt directly.

After approval, the wizard verifies key backups, prepares host ciphertext and
opens a configuration PR containing public recipients, the selected public SSH
key and encrypted secrets. Review and merge that PR. The wizard verifies the
merged configuration, installs its exact revision, reboots and checks the deployed
system, services, SSH and configured Tailscale route before reporting completion.
An approval is for that target and configuration, not a production-service cutover.

## Git updates after enrollment

The first-enrollment hold preserves the approved revision through reboot.
Completion records verified enrollment and releases Comin, then checks its real
Git fetch and deployed generation. Comin owns subsequent reconciliation of this
repository's `main` branch using the target's deploy key and pinned GitHub host
keys. Protecting and reviewing `main` is therefore the update authorization
boundary; an Actions result is not a separate runtime deployment gate.

Current Comin integration supports base hosts only. The Nix module rejects
combining it with the stateful container or Home Assistant runtimes until their
backup and deployment workflow is reviewed. It does not promise application-data
rollback or recovery.

## Interrupted setup and migration

Preserve operator state, target journals and receipts after a failure. Changed
SSH host keys are blocked; uncertain privileged phases cannot restart blindly.
A completed attempt can recheck its saved installation without choosing a new
revision. Historical preparation without verified backups requires an explicit
schema-2 migration using the intended backup vault; do not delete state to bypass
that check.

The current disposable rehearsal is still being validated; see
[implementation status](implementation-status.md) and [VM evidence](vm-validation.md).
Production provisioning, service restoration and cutover need their own evidence
and approval. Wiping either physical Mac always needs separate approval.
