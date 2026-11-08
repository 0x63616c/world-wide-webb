# Simple Mac enrollment

Status: implementation authorized on 2026-11-06; deployment to real Macs is not.
This supersedes older CLI UX proposals, not the existing operational configuration.

## Outcome

`homelab` sets up a Mac, proves it works, then exits. Git manages it afterwards.
No fleet dashboard, workload controls, runner scheduler or new node agent.
Runner platform and Git reconciler selection remain separate decisions.

## The user journey

1. Complete Apple setup, connect power/network, and enable Remote Login on the Mac.
2. Open the CLI on the personal laptop. Enter the target and configuration repository
   once. Reuse SSH-agent keys; guide password-based public-key installation if needed.
   Explicitly approve first SSH trust; never silently replace a changed host key.
3. Match the host configuration when unambiguous. Review the actual planned changes
   once, including restart and any FileVault unlock requirement.
4. Unlock/approve 1Password and GitHub authentication if needed. The CLI handles
   secret backups, encryption and the configuration PR. No manual file copying.
5. Wait for the repository's approval/check requirements; then install the exact
   approved revision on the target. No Nix installation on the personal laptop.
6. Check Tailscale, configured services and Git reconciliation, restart, reconnect,
   and repeat checks. Say Ready only when required checks pass.

One progress screen, one consistent footer, focused prompts only when input is
needed. Cancel preserves recoverable progress. Resume checks the target journal
before retrying; disconnection does not prove installation stopped.
Unknown installation/key/activation outcomes need targeted checks; if safety cannot
be established, show a specific intervention instead of promising automatic resume.
Cancel does not delete backups or revoke credentials a running install may need.
Forgetting local attempt metadata is not remote decommissioning.

## Repository boundaries

- Public `homelab-cli`: generic enrollment engine/UI, provider adapter, tests and
  releases. No personal hosts, vault IDs, credentials or workload definitions.
- Private `homelab`: host recipes, shared Nix modules, service deployments,
  encrypted secrets, public age recipients, setup manifest and recovery docs.
- Application repos: source, tests, image publishing and app-specific cloud resources.
  Keep existing shared DNS/Cloudflare ownership initially; never duplicate an owner.
- Homebrew tap: release distribution only.

## Secrets: automatic, with verifiable recovery

Use the personal laptop's 1Password session and a dedicated homelab vault. Nodes
receive no 1Password application, vault access or provisioning authority.

1. Bind the attempt to repository, host and stable vault/item IDs. Reuse existing
   identities; reject mismatches. A display name alone is not identity.
   Record an attempt identifier before vault writes. If creation times out, reconcile
   that identifier (the returned item ID may be unavailable) before
   creating another item. Never guess between conflicting backups.
2. Create/reuse a recovery age identity and a distinct host identity. Save missing
   backups to 1Password, read them back and verify their public recipients before
   deployment. Verify encryption/decryption separately with each identity.
3. Retrieve the dedicated, tag-scoped Tailscale provisioning credential on the client.
   Obtain a short-lived, single-use enrollment key. Never transfer the provisioning
   credential. Check expiry after PR waits; renew ciphertext through the same Git
   process if needed. Do not use expired/consumed keys on retries.
   Preserve issuance/revocation identifiers. If issuance has an unknown outcome,
   reconcile it before requesting another key; stop with a specific recovery action
   when provider permissions cannot establish the result. Revoke known unused keys
   when abandoning an attempt only after proving no operation uses them, without
   revoking an enrolled device.
4. Generate a unique SSH deploy key on each target. Register only its public key on
   the configuration repository through the client's GitHub authentication, explicitly
   read-only. Reconcile fingerprint and registration ID before retrying. The private
   key remains on the node; it needs no vault backup because replacement enrollment
   can issue a new one. Pin GitHub SSH host identity using independently trusted
   published fingerprints, never an unverified keyscan. Operator authentication stays
   on the client and handles PRs and deploy-key administration only.
5. Encrypt host values with SOPS for that host and recovery recipients only. Commit
   ciphertext and public metadata; never plaintext secrets. Check the PR's exact paths
   and recipients and bind installation to the approved commit.
6. Transfer the host age private identity over trusted SSH. Use the target's deploy
   key for repository access. Install protected files atomically. Never overwrite an
   unexpected existing key.
   Runtime secrets stay out of Nix derivations/store, logs, argv and build artifacts.
7. Verify installation and recovery backup before deleting temporary client exports
   and remote staging. Preserve uncertain in-progress state until reconciled.

Prefer memory/pipes for secret handling. Where tools require files, use owner-only
directories/files, bounded lifetime and explicit cleanup. Do not promise secure disk
erasure. Journals contain references and phases, not secret values. Do not put secret
values in environment variables or error output. Existing local plaintext preparation
files require verified migration, not wholesale deletion.

Use one small secret-store interface with a 1Password implementation and a synthetic
test implementation. No plugin framework. 1Password account recovery remains external;
this is credential backup, not backup of databases or service data.

## Existing CLI: keep, simplify, delete

Keep and reuse:
- `first_access`, `ssh*`, `host_key`: connection, agent support and trust checks.
- `bootstrap*`, `remote_setup`, `secrets`: privileged boundaries, secure transfer,
  exact-revision validation and interruption handling.
- `config`, `package`, `provisioning`, `tailscale_oauth`: useful mechanics behind the
  new single flow; review interfaces rather than rewrite their security logic.
- Existing meaningful unit/integration/VM tests; adapt entry points, retain regressions.

Replace the UX, then delete obsolete paths:
- `tui` fleet menu and public Inspect command. Keep inspection as internal checks.
- Required `inventory` CRUD as a product feature. Migrate useful existing connection
  and repository bindings into a small enrollment journal before removing the schema.
  Extract the connection type used by SSH/setup first; keep data migration explicit.
- Separate `provision_wizard` and `setup_wizard` user journeys: one orchestrator.
- Manual artifact/key/token path forms and repeated configuration questions.
- Manual backup checkbox, only after verified secret-store backup replaces it.

Do not blindly delete `homelab-host`: bootstrap uses it, and private Nix currently
calls its Power/Tailscale/InstallSshKeys operations. Keep compatibility until those responsibilities
are explicitly relocated or replaced. Power policy belongs in private Git configuration.
Preserve matching-version package validation and secure host-secret verification.
Existing `src/tui.rs` local edits must be preserved and reconciled, not overwritten.

## Build order and proof

1. Implement narrow provider contracts: 1Password save/read-back and deploy-key
   registration/reconciliation. Prove them with synthetic credentials first; report
   missing client GitHub administration permission as an actionable authentication step.
2. Implement one enrollment state machine around existing mechanics; migrate old local
   state without losing keys. Add verified backups and automated encrypted PR creation.
3. Add post-install/reboot checks and adapt the terminal UI. Remove superseded UI only
   once the replacement passes tests.
   Coordinate enrollment with the Git updater: hold the approved revision through
   reboot verification, then release the hold and verify normal reconciliation.
   Interrupted setup must have an explicit, recoverable hold state.
4. Test end-to-end on disposable Mac VMs with synthetic secrets: first setup, every
   interrupted phase, repeated resume, locked vault, failed backup, wrong recipient,
   expired enrollment key, delayed PR, changed SSH identity and failed reboot/service.
   Assert secrets never appear in logs, journals, artifacts or command arguments.
5. Separately test real provider integration with dedicated test items/credentials.
   VM success cannot prove physical clamshell, Wi-Fi or FileVault restart behaviour.
   Real-machine deployment and those hardware checks require later authorization.

## Decisions before implementation

- Deploy keys are selected: one read-only key per target for the configuration repo.
  They do not authenticate runner registration or private container-image pulls.
  Nodes deploy main without querying Actions APIs; repository merge policy authorizes
  deployment. Remove the old node Actions gate and token dependency together. Do not
  claim required GitHub checks are enforced unless actual repository rules prove it.
- Git reconciler and its readiness/health contract (no custom controller by default).
- PR policy: existing required reviews may remain a human approval; don't bypass them.
- Power baseline: AC sleep prevention; closed-lid headless operation is not yet proven.

## Independent review

Reviewed by a separate agent against the existing CLI and private Nix callers.
Its corrections are incorporated: uncertain provider-write reconciliation, revision
coordination with the updater, non-destructive cancellation, SSH-helper compatibility,
connection-data migration and honest handling of uncertain bootstrap outcomes.
The subsequent deploy-key decision resolves the Git credential design question;
implementation and testing remain required. This review is not a production security
audit or authorization to deploy.

## Implementation evidence (in progress)

2026-11-06: deploy-key custody/registration and bootstrap SSH transport are implemented
on the CLI working branch. Bootstrap, remote-transfer and updater regression tests pass;
the private updater no longer needs a GitHub Actions API credential. Private helper pins
still need updating to the final reviewed CLI commit before Nix validation/release.

Automatic backup now saves and verifies concealed identities, reconciles uncertain saves,
and discovers repository/role backups before generating identities on a replacement client.
Real age/SOPS tests and eight secret-store regressions pass. A separate opt-in test passed
against 1Password CLI 2.42.0 using a synthetic item: create, exact multiline read-back,
reuse and deletion. The working provider uses an owner-only temporary JSON template,
removed after the command; the installed CLI did not reliably consume the earlier stdin
template approach. Existing credential items were not changed.

Configuration PR support now preserves a private immutable proposal before publication,
reconciles lost branch/PR responses and verifies the merged host settings, ciphertext and
recipient rule. Seven synthetic regressions cover state tampering, unrelated host changes,
oversized journals and resuming after GitHub deletes a merged branch.

Target Git identity preparation now stages only the public helper and returns only the
public key and target-local path. Keys are bound to the repository and reused on retry.
A private, locked registration receipt records intent before GitHub writes and reconciles
unknown results without blindly creating another key. Ten deploy-identity/registration
tests and ten remote-transfer tests pass using local fixtures; no real Mac was contacted.
The target records its established public identity so loss of its private key cannot
silently rotate it. The client checks the repository-bound response path. Definite
GitHub policy/permission rejection can retry after correction; ambiguous writes remain
reconciliation-only. The independent review's corrections have regression coverage.

The first integrated setup path now runs automatic credential preparation, target deploy-key
registration, saved proposal publication, merge waiting and exact-revision bootstrap. The
manual token-entry wizard and artifact/key/token path form have been removed. The
credential ordering test uses an in-memory store and synthetic issuer with real age/SOPS:
failed backup prevents issuance and completed preparation does not issue another key.
Existing SSH trust and terminal cancellation tests remain. This is working-branch code,
not a released or end-to-end-validated enrollment flow; it does not report a complete
enrollment after activation alone.
The ordinary all-targets Rust suite passed after this first integration (the real
1Password test and disposable-VM execution remain explicit opt-ins). The follow-up
review found cancellation and route-change ordering issues: queued cancellation is
now checked after merge detection and before installation, and the final selected
SSH route is inspected before review or provider writes. Administrator membership
and Command Line Tools are also probed read-only before issuing credentials. The
full delayed-merge/cancel regression and VM lifecycle rehearsal are still outstanding.

Bootstrap now selects safe resume automatically. Interrupted identity publication can
reuse an exact matching protected key without overwriting it; it rebuilds/verifies the
original revision and refuses a different store output. Failed rebuilds preserve the
in-flight key-installation journal. Root activation records completion separately from
the client journal and only confirms it while both active profile paths still resolve
to that exact system. A lost activation acknowledgement can therefore resume without
reinstallation. An unconfirmed root activation or Nix installer remains blocked for
inspection. These paths have synthetic/temporary-filesystem regression evidence;
privileged completion and reboot still need the disposable VM rehearsal.

The interactive entry point now offers setup and saved connections without a separate
status action. Footers share one action line and wrap by action group. Terminal tests
cover adding a connection, reopening, cancellation and terminal restoration. The legacy
noninteractive inspect command remains until its automation consumers are migrated.

Renewal primitives now bind issuer expiry to the exact encrypted preparation, preserve
retired attempts, and permit a new PR to replace only the exact previous enrollment
ciphertext with the same recipients. Regression tests reject service-secret replacement
and changed base ciphertext. Host identity copies survive retirement independently of
the vault: tests reopen with unchanged host/recovery recipients even when the synthetic
vault has no items. The wizard now obtains target bootstrap status while preparing its
Git identity, renews only before bootstrap starts, resolves the exact prior PR before
retirement, and checks remaining lifetime again after merge. Replacement proposals
must match archived ciphertext before changing an existing encrypted file. Synthetic
tests cover retained started attempts and failed PR resolution preserving preparation;
the complete interrupted wizard/provider journey still needs rehearsal and review.

An independent reviewer identified inherited BSD lock descriptors as the likely cause
of an intermittent test failure. Provisioning now explicitly unlocks on scope exit;
a retained-descriptor regression proves release while preserving live-owner exclusion.

Target reservations now persist across SSH sessions, bind one client attempt and
approved revision, and prevent concurrent setup or credential renewal after bootstrap
starts. Cancellation before bootstrap can release only that attempt's reservation;
unknown outcomes retain state. Separate client locks prevent simultaneous wizards.

Activation now creates a persistent updater hold under the updater's existing lock.
Root verification checks the exact activated system, service health, Tailscale identity
and Git read access. Public root-owned reports bind each result to a fresh request ID;
the client cannot reuse an older successful report. Reboot intent is recorded durably
before shutdown and never replayed merely because SSH disconnected. The shared setup
binding covers repository, host and approved revision.

Independent review found and fixed report-directory creation under a restrictive
umask. A subprocess regression covers that case without loosening existing directory
permissions. Ordinary Rust tests passed; focused bootstrap, binding and report tests
and Clippy passed after the review fixes. Live provider and disposable VM tests have
not run for this implementation. Completion now holds the updater lock across final
verification, a durable completion receipt, and removal of only the matching hold.
Lost acknowledgements can finish from that receipt even after Git updates advance.
Verification also requires the updater launchd job to be loaded; hosts still need
their updater configuration enabled before the VM rehearsal and release.

The wizard now calls this lifecycle after activation: verify services/Git, verify
Tailscale SSH through its control-plane-verified client wrapper, request reboot once, wait for a changed
boot session, verify again and complete. Synthetic SSH tests cover lost reboot replies,
stale reports, unavailable Tailscale routes, an already rebooted host, and repeated
completion. Activation candidates resume the original revision before credential
preparation, so an expired enrollment token cannot strand an activated host. Root
receipts remain the authority; administrator journal state alone cannot complete setup.
The ordinary all-targets Rust suite and Clippy passed after this integration. Complete
wizard/provider interruption coverage and actual VM execution remain outstanding.
Normal administrator authentication may be required again after reboot;
no password is stored and no passwordless sudo grant is added.

Review caught that Tailscale SSH and macOS Remote Login have different SSH identities.
The client now keeps privileged operations on the original trusted connection and
reads nonce-bound reports over `tailscale ssh`, which verifies Tailscale-distributed
host keys. It does not reuse the LAN host key or disable strict checking on that
route. Browser check-mode requests remain visible. This requires the standalone
Tailscale client and an existing SSH policy grant; no tailnet policy is changed.
See [official wrapper behavior](https://tailscale.com/docs/reference/tailscale-cli#ssh).
Synthetic transport tests pass; the actual wrapper/version still needs a VM smoke test.
Ordinary reboot rejection now returns immediately instead of waiting ten minutes.

Saved installation detection now precedes current-main lookup. A subprocess regression
proves an approved revision can resume even when current main has removed its host.
Unclaimed attempts refresh main before preparing a new enrollment proposal; claimed
attempts retain their exact approved revision.

The independent review's credential fixes are implemented: issuer vault/item IDs are
bound across renewals, and a secret-free issuance receipt precedes encryption. Failed
encryption retains the issuance identifier and confirmed/unknown revocation outcome.
The all-targets Rust suite and Clippy pass after these fixes; the opt-in VM journey
is explicitly excluded from that result.

The disposable `homelab-validation` VM is reachable through Tart Guest Agent and
reports `VirtualMac2,1`. Comin's pinned input is now locked. Evaluation exposed an
upstream dependency on `nix.package` despite Determinate disabling nix-darwin's Nix
management; the launchd environment now uses the installed Determinate profile.
Full builds and the new enrollment/reboot journey remain release gates. The old VM
harness must be updated: it seeds legacy credentials and reboots outside the wizard.

Still outstanding: finish CLI cleanup, complete enrollment lifecycle tests,
complete renewal interruption/merge tests,
final lifecycle review, updater configuration, final docs,
disposable VM rehearsal, full independent review and release. No production activation.
