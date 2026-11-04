# Implementation status

Repo: https://github.com/0x63616c/homelab (private).
Initial implementation PR (merged): https://github.com/0x63616c/homelab/pull/1.
Public operator source: https://github.com/0x63616c/homelab-cli (0.2.0).
This repository remains private. The operator and portable bootstrap helper now
have fresh public history; private health/restore code lives in `host/`.
`host/Cargo.toml` pins one public commit used by both private Rust and Nix.
See [setup](setup.md) and the [reviewed extraction plan](cli-extraction-plan.md).

The client no longer needs Nix or a locally built bootstrap package. It reads
the private `homelab.json` and ships its native helper; the target checks the
fetched manifest and evaluated Nix facts before activation. Credential sources
are testable adapters, OAuth issuance is scoped and interruption-safe, and local
preparation is bound to a repository. Synthetic macOS/PTY tests are automated;
full clean-install/reboot rehearsal remains unfinished. No host was deployed.

Local private extraction checks: 12 Rust tests and 102 Python tests passed,
plus Clippy and formatting. The actual-container rehearsal was not run. The
changed private Nix configuration has not been evaluated on this client; keep
activation disabled until that validation is completed.

For the earlier 0.1.4 redesign on November 4, both hosted checks stopped before running
because GitHub reported failed recent account payments or a spending limit.
Local tests, independent source/visual review and isolated packaging checks
passed. The owner approved publishing with local validation while keeping the
repository private. Hosted Nix/bootstrap/recovery checks remain unrun for this
release; local CLI validation does not establish host bootstrap readiness.
No billing settings were changed and no machines were deployed.

Authoritative scope: build the repo/PR; do not deploy. Owner confirmed roughly
500 GB MacBook storage and existing administrator `admin`. Mini uses `calum`.
The earlier storage gate is satisfied for implementation, not authorization
for machine activation, service removal, or erasure.

Implemented so far:

- Both Darwin configurations; Determinate integration; locked Nix inputs.
- Explicit service users/groups and UID/GID collision checks; existing human
  account is not in knownUsers. No vov deletion code.
- Key-only OpenSSH settings, AC power job, Nix Tailscale daemon and enrollment.
  The AC job now invokes a Rust executable directly, with seven fixture tests
  covering capability checks, battery preservation, idempotency and verification,
  plus three subprocess tests. Local tests, Clippy and the hosted Nix package
  build pass. No real power settings were changed.
  Tailscale enrollment also invokes Rust directly, with eight fixture tests.
  Already-running nodes reconcile without the enrollment key; first login uses
  a private SOPS file reference and checks for Running afterward. Launchd retries
  unavailable daemon states rather than an embedded shell loop.
- Host-scoped SOPS integration with real-secret absence blocking activation.
- Conditional service secret declarations and `docs/secrets.md` catalog, using
  the seven verified Control Center filenames without reading their values.
  Service-only projection and rotation retries are implemented with six synthetic
  tests; VM mount/rotation behavior still needs target validation.
  No plaintext or fake ciphertext added.
- Disabled general Colima service module; pinned current service imports for
  Bambuddy, HA, Control Center, cloudflared, and reconstructed Hindsight Compose.
- Bind mounts reject missing host paths. A daemon-free Compose check now parses
  every model with synthetic settings, checks image digests/external state
  volumes/amd64 slicer/HA host networking, and rejects missing required settings.
  This check runs through the locked Nix Docker Compose package in CI.
- Disabled HA module preserves the bridged Colima container: separate Colima
  home, root socket_vmnet helper, `_containers` VM/Compose daemons, explicit
  physical interface, socket-connect readiness and required restored `ha_config`.
  Enabled-module CI now compiles this path too; headless runtime remains untested.
- Typed Rust bootstrap with an exact reviewed commit and matching standalone
  artifact, private credential inputs, host-only decryption and atomic no-replace
  key installation. The shell launcher only starts the helper. Password-manager
  access remains on the personal operator Mac.
- Synthetic bootstrap journeys exercise identity, readiness, credential and
  revision gates, failure ordering and persisted interruption holds. A private
  journal excludes concurrent attempts. Uncertain privileged phases require
  manual inspection; automatic repair is deliberately absent. Privileged child
  processes have root-owned bounded supervision. No real bootstrap has run.
- Private CI builds the standalone artifact with pinned native Rust because
  Nix-built binaries link to a Nix-store library. A separate no-Nix smoke job
  verifies the artifact can launch before installation.
- Remote setup wizard verifies the CI-evaluated host plan and artifacts, inspects
  SSH, obtains explicit approval, transfers private snapshots, hands the terminal
  to SSH/sudo, cleans staging and verifies the selected SSH route. Eight fixture
  journeys cover failure and interruption paths; real terminal tests cover
  cancellation and restoration. New Tailscale-route verification and on-target
  validation remain pending. The existing public Homebrew tap packages only the
  operator CLI using authenticated private source; no private source or assets
  are published. Full authenticated Homebrew installation remains untested.
- Guided first access precedes bootstrap: explicit first-use trust, existing-key
  checks, reviewed public-key installation through native SSH authentication,
  and read-only inspection. The operator can finish here without secrets or
  activation. Fixtures exercise changed-host refusal, key preservation and
  interrupted installation; terminal tests cover cancellation before connection.
  The owner subsequently supplied a CLI screenshot confirming SSH access to
  `admin@homelab-macbook.local`: macOS 27.2, arm64, UID 501, 422.0 GiB free.
  This is owner-observed access verification, not evidence of bootstrap,
  headless reboot, or service migration.
  First-access diagnostics now distinguish known SSH failure classes without
  exposing raw banners. Short, styled screens select an explicit next action;
  native password-install failures remain visible before returning to the menu.
  The operator can choose a public key from the local 1Password/SSH agent and
  remember that identity per connection. Inspection and every setup SSH/SCP
  route reuse the selected key; no private key or password-manager client reaches
  the host. Tests use disposable synthetic agents and fixture hosts, not the
  owner's real agent. Enter opens guided connection; inspection is a separate
  action, and screens share consistent footer/navigation hints.
- Update-agent draft with authenticated private Git fetch, exact-main CI gating,
  bounded subprocess calls, GC-rooted candidate, rollback and interruption holds.
  Twelve passing local tests cover eligibility, credential-helper behavior,
  health timeout, rollback failure and interrupted activation.
- Imported existing NAS uploader with certificate pinning and checksum/size
  read-back checks; separate host namespaces and six protocol-safety tests.
  Disabled 04:15 backup job now selects assigned services, takes snapshots,
  bundles recovery files, verifies NAS payloads/manifest and retains seven
  completed local sets. Six completion/retention tests cover the driver.
- Read-only downloaded-set verifier checks hashes, byte counts, service payload
  completeness, image inventories and required recovery configuration/credentials.
  It rejects empty payloads and unsafe or duplicate recovery-archive paths.
  Backup completion publication invokes it and the shared Rust health gate;
  failed readiness cannot publish a completed NAS set. The 15 verifier tests
  and 11 backup tests cover corruption, omission and publication rejection.
  The [restore rehearsal](restore-rehearsal.md) records service-specific steps
  and exact-image Hindsight research. Production-data restore remains untested.
- A narrow Rust Hindsight rehearsal operation initializes fresh embedded
  PostgreSQL, restores a custom-format dump and requires clean shutdown. Three
  local tests cover input/destination/metadata guards. A separate hosted ARM64
  workflow runs the pinned image with synthetic data and networking disabled.
  [Run 41791613360](https://github.com/0x63616c/homelab/actions/runs/41791613360)
  passed the actual dump/restore, vector/Unicode/sequence checks, restart
  persistence and corrupt-dump shutdown at `a6aa0ed`. Docker `--init` reaps
  detached database processes so shutdown can be confirmed.
  It does not restore production data, extract archives or prove app readiness.
- Snapshot primitives now preserve Control Center, HA, Bambuddy and Hindsight
  state with restart markers and health checks. Hindsight credentials stay
  inside its container. Five failure-path tests pass; verified restore
  procedures remain unfinished. Sunday Hindsight bank exports and eight-set
  export-only retention are implemented with four tests; target validation is
  pending.
- Shared operation lock/maintenance hold wraps general service and HA
  reconciliation. Ten tests include cross-process exclusion and validated
  inherited-descriptor handoff. Backup joins the wrapper; updater transaction
  integration now runs backup → activation → reconciliation → health under
  one lock with privilege-separated children. Four transaction tests cover
  ordering, backup failure and ownership/backup prerequisites. Automatic-update
  timer is now defined but disabled on both hosts. Application failures hold
  rather than activate an old app against possibly migrated data; persistent
  transaction markers block scheduled jobs after interruptions. macOS runtime
  behavior and actual data recovery remain unvalidated. See `docs/operations.md`.
- Runner admission/launch-argument policy with five tests; controller and
  broker remain pending. Selected Softnet 0.25.0 requires macOS 26; MacBook OS
  version is reported as 27.2, with exact-version runtime validation pending.
  See `docs/runner-implementation.md`.
- Git-tracked Control Center release manifest records observed live digests and
  source label. Reconciler enforces these over environment image overrides; a
  local promotion helper and five tests cover allowed edits. Cross-repo PR
  automation and application-aware deployment transactions remain pending.
- Typed Rust service health gate replaces the Python implementation. It requires
  actual Docker health results where declared, exact Control Center images/source,
  database/lifecycle/worker state, native tunnel readiness and online Tailscale
  sidecar state. Nine fixture tests cover deadlines, failures and sanitized probe
  output. The shared Nix service assignment excludes disabled runtimes from
  health, backup, deployment metadata and setup plans. Host access and deeper
  service integration checks remain pending; update timers stay disabled.
- Hosted ARM64 build-only CI. No Nix installation on either home machine or
  the authoring computer. Lockfile generated by the first CI run and committed.

Not complete / do not deploy:

This list includes later milestones, not just first-migration blockers. The first
migration needs validated setup/access, consistent backups and real restore
rehearsals, service health and explicit deployment ownership. Runner lifecycle,
automated image promotion, public binary releases and additional management
screens are deferred. Keep automatic updates disabled until recovery and
ownership transfer are proven. The intended implementation language for our
operational code is Rust. Fourteen Python scripts remain from the earlier
implementation, including backup, update and reconciliation operations; this
does not yet meet that direction. Replace required operations with tested Rust
and delete unused helpers in a separate change. The owner explicitly deferred
that conversion to a separate change.

1. Finish and test updater integration, maintenance/backup locks, self-update
   supervision, real service health probes and end-to-end failure recovery.
   `modules/updates.nix` now defines the stable ten-minute daemon, but both hosts
   leave it disabled. Do not run the script manually to bypass rollout gates.
2. Implement disposable VM runner lifecycle, GitHub registration broker,
   networking restrictions, single global slot, cleanup/restart recovery and
   disk limits. `modules/runners.nix` rejects enablement. No bare-host runner.
3. Validate the new HA module against the pinned Colima runtime and actual target
   interface, socket permissions, DHCP/address handoff, multicast discovery,
   cold start and restore. Add backup/update coordination before activation.
   HA OS remains a future disabled stub. No general-runtime HA substitute.
4. Port existing backup/recovery/release safeguards, including consistent data
   snapshots and NAS certificate/read-back checks. Integrate image promotion
   and explicit transfer of deployment ownership from world-wide-webb.
5. Supply real public SSH keys and age recipients, then encrypted host files.
   Do not fabricate ciphertext, recipients or service credentials. Complete
   on-target mounted-file delivery/rotation validation for the documented catalog.
6. Verify the added enabled-module and Compose checks in CI, and complete
   bootstrap readiness/decryption preflight and failure-path coverage. The local
   Python suite has 102 host-operation tests after replacing client, bootstrap
   and health tests with Rust coverage. Disabled configs alone do not prove the
   container/runner runtime paths. README now documents bootstrap/add-host steps
   and current readiness limits. A new locked-Nix check generates disposable
   age identities and checks isolated host-key decryption, including rejection
   of a wrong host key despite valid operator recovery credentials; its CI
   result passed at `3fab3df`. Full bootstrap activation remains untested.
7. Verify each new head in CI, inspect the resulting PR for correctness, and keep it draft
   until implementation is reviewable. Passing builds alone do not prove live
   headless startup, network isolation, migration or recovery.
8. Complete the [guided management interface](management.md). The initial
   Rust terminal menu, read-only SSH inspection and private connection-profile
   creation replace the Python prototype. Filesystem and fixture tests cover
   add/load/inspect, privacy and locking, SSH identity checks and safe errors.
   A real pseudo-terminal test adds a profile, quits, reopens it and verifies
   terminal restoration. No live host connection was used. Guided setup now reuses the guarded
   target operation. Inventory import and subsequent management actions remain
   unfinished. The target is one public
   command, shared operation implementations, consistent plan/apply behavior,
   actionable errors and resumable setup. Current low-level scripts are not the
   finished user experience.

Both default host configurations, the enabled service/HA/backup/update variant,
Compose checks, real disposable SOPS identity checks, 115 Rust / 92 Python tests,
and the fresh-Mac standalone bootstrap smoke passed
[run 41788691179](https://github.com/0x63616c/homelab/actions/runs/41788691179) at
`66b6b7e`. The backup completeness fixes bring the local Python suite to 102
tests. The [PR checks](https://github.com/0x63616c/homelab/pull/1/checks)
record each current complete result, including the assignment contract and
fresh-Mac smoke. These are build checks, not runtime validation. No live
activation has run.

## Later: repeated clean-install validation

After migration backups and restoration have been verified, repeat the full
fresh-Mac setup several times on a host whose data can safely be erased. Each
wipe requires a separate explicit approval; this plan does not authorize one.
Keep the live mini until its replacement is independently verified.

For each run, record the reviewed commit, hardware/macOS version and any manual
steps. Start from Setup Assistant and enabling Remote Login, then use the CLI
for SSH access, host binding, credentials and reviewed bootstrap. Verify reboot,
remote access without a human login, launchd service startup, secret decryption,
and any services enabled for that migration stage. Test interruption and resume
before declaring setup repeatable. Resolve changed SSH host keys through an
explicit identity review; do not bypass trust checks or silently reuse a consumed
single-use enrollment key. The intended outcome is a documented, repeatable
workflow, not merely a passing build.
