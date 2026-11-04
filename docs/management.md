# Guided setup and consistent management

The initial `client/` implementation opens a terminal menu, guides local
connection-profile creation and offers read-only SSH inspection through shared
operation code. Profile creation stores no credentials. The setup wizard now
uses the same target bootstrap with an evaluated CI plan and explicit approval;
subsequent management actions remain unfinished. Existing operational scripts are
implementation internals, not the intended everyday user interface.

Build each operation when it is needed for setup, migration or routine upkeep.
The command vocabulary below describes direction, not a requirement to implement
every action now. Do not add a plugin system, generic workflow engine, browser
administration service or publishing automation for hypothetical future use.
Keep future VM roles disabled until their concrete workload and isolation tests
justify implementing them.

## One entry point

The management client now uses Rust for host profiles, SSH inspection, the menu,
result states and errors. The Python prototype has been removed after replacing
its tests with filesystem, executable-fixture and real terminal journeys. Keep shell
limited to small platform/bootstrap adapters, formatted and reviewed separately.

Public Homebrew distribution should provide the compiled operator binary, without
requiring Python or Nix on the personal Mac. Nix builds and pins the managed-host
tools. Existing Python backup/update utilities still need migration with
equivalent failure/recovery coverage; their current tests do not validate a Rust
replacement until the replacement actually exists and passes its own tests.

Use a single `homelab` entry point. With no arguments it opens the TUI; users
choose a host and an action without remembering subcommands. Arrow keys, Enter
and visible navigation help should suffice. Command options remain available
for automation and use the same operation code. Nix supplies the client for
development; a Homebrew release is planned for the personal operator Mac. Keep
one typed Rust implementation behind it, a shared configuration model, common error and
output handling, and thin launchd wrappers that call the same operation code.
Nix declares machine configuration and packages; Rust coordinates operations;
Compose declares containers. Rust also owns target-side bootstrap; shell only
launches its standalone helper. No parallel mise/uv environment or alternative deployer.

The intended command vocabulary behind the menu is (`inspect` and interactive `setup` are implemented):

- `homelab setup`: guided first setup, starting on the personal operator Mac.
- `homelab status`: read-only host, revision, service, backup and runner status.
- `homelab update plan` / `homelab update apply`: inspect and execute a specific
  eligible configuration through the shared deployment transaction.
- `homelab backup create` / `homelab backup verify`: consistent snapshot and
  read-only verification of a selected backup set.
- `homelab restore plan` / `homelab restore apply`: show the selected backup,
  target and affected state, then restore through the recovery workflow.

Scheduled operations use the same code and checks as interactive operations.
They must not become a separate implementation with different safety behavior.

## Setup is a guided workflow

The personal operator Mac is the normal control point for initial setup and
ongoing operation. Commands accept a named host and connect through SSH over
Tailscale after enrollment. First setup can use authenticated SSH on the local
LAN before Tailscale is installed. No WAN SSH port forward is required.

On a freshly reset target, the operator still completes Setup Assistant,
connects networking/power, enables Remote Login for the intended administrator,
and establishes/verifies initial SSH access. Follow the README's
[first-access checklist](../README.md#first-access-to-a-fresh-mac) for the exact
Settings steps and the distinction between enabling SSH and installing a key.
The wizard offers explicit first-use host trust and, when needed, reviewed
public-key installation through the system SSH password prompt. Existing keys
are preserved; saved host-key mismatches are never bypassed. The private key
must already be available to the operator's SSH configuration or agent. The
guided picker can list public keys from the personal Mac's 1Password SSH agent;
it never exports private keys or accesses the vault. The approved public key and
agent socket are saved per connection and reused for SSH and SCP. Selected-agent
connections use the real hostname/IP directly on port 22, without custom SSH
configuration or agent forwarding.
Access verification can finish without bootstrap credentials or activation.
The wizard then inspects the host,
transfers the reviewed bootstrap and only host-specific credentials, obtains
explicit setup approval, installs/configures the host, and checks the new private
connection. Use an interactive SSH terminal for required administrator prompts;
do not grant blanket passwordless sudo or embed an admin password.

The setup session must tolerate a dropped connection: keep nonsecret progress on
the target, reconnect and inspect actual state, and resume only verified safe
steps. Changing SSH/Tailscale access requires checking the replacement connection
before discarding the working route. Host fingerprint changes require inspection,
never automatic known-host deletion or disabled host-key checking.

Examples of the intended remote interface are `homelab status --host
homelab-macbook` and `homelab setup --host homelab-macbook`. `setup` is implemented; `status` remains planned. Neither is authorization
to change the current machines. No target needs
the operator's password manager, GitHub login session or recovery identity.

A future browser view can show the same status model through private tailnet
access, potentially in the existing Control Center app. It must use the same
operation API and authorization rules; do not create a separate UI deployer or
permit dashboard edits to bypass Git review. The initial implementation remains
a guided CLI, avoiding a privileged web administration service during migration.

1. Explain the operator machine and target machine roles. The personal Mac holds
   password-manager access; the target receives only its own key and scoped token.
2. Detect OS, architecture, administrator/UID, disk space, network reachability
   and existing installation. Show what was detected and what remains unknown.
3. Select an existing host definition and exact reviewed commit. Show the host,
   service assignments, changes and readiness failures before installing anything.
4. Verify the target's SSH identity with local access and transfer credentials
   through a private channel. Do not print them or place them in command history.
5. Perform the approved setup in named steps with progress and concise results.
   Stop on errors, preserve recovery evidence and explain a concrete next action.
6. Report which checks passed, which require on-target validation and which
   services remain disabled. Setup completion is not migration completion.

The initial entry point must work before Nix exists on the target. Its final
bootstrap mechanism must be reviewed, versioned and small; it must not require
a user to assemble a sequence of undocumented shell commands. The shell launcher invokes the same typed target operation used by the wizard.
Automatic artifact retrieval, public client distribution and verification of a
new Tailscale route remain pending. The wizard verifies the selected SSH route
and preserves uncertainty after a dropped connection.

## Consistent behavior

Every command identifies the target before doing anything. Read-only inspection
is the default. Mutating operations show an exact plan including revision or
backup identity; applying must reject a stale plan when relevant state changes.
Confirm consequential changes once at the operation boundary. Never silently
wipe, rename an account, change ownership, rotate an identity or skip a failed
check. Mini erasure requires its own separately approved workflow.

Use one operation lock and maintenance/recovery state for service updates,
backups and restores. Runner jobs use their separate single-job slot. Persist
phase transitions before mutations. A restart resumes only a verified safe
step; uncertain state stops with a recovery instruction instead of guessing.

Use common result states: ready, running, healthy, needs-attention, blocked and
failed. Explain the reason and next action in plain language, with redacted
technical logs available separately. Machine-readable output should carry the
same facts and a stable error code. No success banner when required checks
remain incomplete. Cancellation must retain enough state to recover safely.

Tests must cover the user journey: first setup, already-configured host, wrong
host/account, missing credentials, insufficient disk, lost connectivity,
interrupted update and backup/restore failure. A command should not depend on
being launched from a particular working directory or interactive shell profile.

## Authentication and distribution

The personal Mac joins the tailnet and uses its existing SSH key to reach a
host; the client maintains no separate password database. Elevation for a
reviewed administrative operation uses an interactive remote sudo prompt, never
a persisted password or unrestricted passwordless sudo. GitHub authentication
on the personal Mac is separate from the scoped token provisioned to a host.

The existing public `0x63616c/homebrew-tap` can distribute the generic client
after a reviewed release. Keep host names, addresses, private configuration,
research documents and all credentials out of the public artifact. Host
inventory is supplied separately from the private repo. No formula, public
source repository or release artifact has been published in this task. Homebrew
on the operator Mac does not replace Nix as the managed hosts' system owner.
