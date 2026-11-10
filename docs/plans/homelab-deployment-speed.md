# Faster homelab deployment

Status: implementation started locally, November 9, 2026. No production deployment
has occurred. Baseline source: `9fdbbe36cacdaf6ab50f553c06da5c9e298c6569`.
Independent review and its disposition are recorded below.

## Outcome

Make a small change affect only the services it needs to affect. Remove NAS transfer
from ordinary activation latency, overlap safe independent work, and measure host
acceptance rather than treating Git promotion as deployment completion. Extend the
current Nix metadata, Python transaction, backup driver and Compose handlers; do not
introduce a second deployer, generic scheduler, service registry or new queue service.

Success means a monitor-agent change does not cold-snapshot application services;
a Control Center image change backs up and reconciles Control Center only; and a
shared services-VM/storage change still protects all affected applications. Existing
daily full backups, hourly photo/database history, identities and recovery remain.

## Baseline and uncertainty

Current `stateful-activation.py` compares host/service assignment but not effective
service inputs. Any previously assigned service causes the previous generation's
`homelab-backup-now` to run with default `full` scope before activation. The backup
holds the operation lock through all snapshots, recovery packaging, sequential NAS
upload/read-back and final health. Reconciliation visits HA then every container.
The container wrapper and outer reconciliation both run full health checks.

In [CI 42639698454](https://github.com/0x63616c/world-wide-webb/actions/runs/42639698454),
main verification took 12m29s; the Nix flake step took 10m40s, operations tests about
8s, and the Linux controller job 69s. The subsequent
[source promotion](https://github.com/0x63616c/world-wide-webb/actions/runs/42641810366)
took 16s. Another Nix step took 18m36s. These are samples, not percentiles. Queueing
and workflow attempts contribute separately to total wall time.

Host build, snapshots, NAS bytes/throughput, activation and reconciliation are not
yet timed by this investigation. Trusted host-key verification prevented live log
inspection. Verify installed source/owner before implementation rollout: the source
promotion ref is not a host acceptance receipt. Current automatic image promotion is
disabled/absent and must not be enabled as a side effect of this work.

## Preserve these invariants

- Keep one host-wide mutation owner and durable transaction/recovery records.
  Parallel children inherit ownership; unrelated launchd jobs cannot mutate alongside
  the transaction. No automatic replay of ambiguous physical actions or data restore.
- Back up the old service state/configuration before its update. A Nix rollback does
  not reverse schema migrations. Service removal/movement remains explicit retirement.
- Keep SQLite and WAL operations in Linux and preserve database/media consistency.
  Keep HA automations, tunnel routes, printer/Tailscale identities and photo files.
- Immutable source/image provenance, encrypted secrets and private local recovery
  sets remain mandatory. No secret values or plaintext-secret fingerprints in Nix,
  logs, Git, CI artifacts or public metadata.
- An incomplete backup, missing volume, unknown metadata or interrupted operation
  never means permission to skip protection or seed empty production storage.

## 1. Add phase timing before optimizing

Extend the existing transaction record and `last-success.json` with sanitized phase
start/end timestamps, monotonic durations and per-service results. Include source,
candidate, changed services, backup reasons, local capture, NAS publication, activation,
reconcile and health. Backup payload names/byte counts are safe; contents and raw
command output are not. Preserve the current journal on failure.

Measure host fetch/build from existing Comin status/log timestamps where available;
do not wrap it in another updater. Record promotion time separately. A post-promotion
read-only observation should report accepted, pending or failed with the installed
source, current/boot profile agreement and final transaction receipt. Do not run
backups/restores merely to obtain a baseline; use normal scheduled/deployment work.

## Development loop

Implement the pure deployment planner and fixture harness before adding Nix input
generation. Most scope decisions should be verifiable locally without Nix, SSH,
Docker or NAS access. Keep I/O in the existing transaction and service handlers.

Extend `scripts/dev` with a focused homelab test command. Explicit test selection is
sufficient for the first slice; reuse existing repository selection for broad
verification rather than building another changed-file classifier. Print a compact
success result, fail with the useful test diagnostics, and retain verbose logs in
private temporary storage. A narrow local pass is not a substitute for required CI.

Run planner/activation tests while editing those decisions; run backup/verifier tests
when touching capture/publication. At a coherent batch boundary run relevant existing
integration, lint and Nix checks. Reuse passing checks until affected inputs change
or a concrete failure calls them into question. Reserve live verification for rollout
and isolated restores for changes to the recovery mechanism.

Use the progress section below as the short working note. Read only the source and
instructions needed for the next slice; keep long logs and raw results outside chat.
If another review is requested, provide the coherent diff and affected invariants,
then resolve specific findings without repeating the entire repository investigation.
Measure local iteration duration/output and host deployment duration separately. The
10x token reduction is a target, not an established result or reason to skip checks.

## 2. Generate effective service metadata and compute one deployment plan

Extend `/etc/homelab/deployment.json` in `homelab/modules/operations.nix`, retaining
host/service/backup fields. Nix generates versioned per-service descriptors from the
same evaluated inputs used to build the service commands. Compare old and candidate
descriptors inside the existing transaction, before any mutation.

Each descriptor covers its Compose and extra configuration bytes, immutable image,
non-secret environment/settings, mount/storage layout, relevant execution logic and
secret ownership/mapping. Shared descriptors cover services VM, HA VM/networking,
operation/backup implementation and storage/identity configuration. Monitoring-agent
and backup-schedule-only settings remain distinguishable from application inputs.

Do not hash the whole flake, top-level Nix store path, source revision or entire
services directory as a service identity. Nix source closures currently include
shared directories such as `${../scripts}` and the common services tree. First trace
which of those paths affect actual launchd definitions and restart behavior. Use
per-service file selections or filtered existing package sources where required so
an unrelated edit does not change every service's execution identity. This is a
small source-input refinement, not a module-system rewrite. Shared script changes
must explicitly invalidate all actual consumers, not be excluded to force cache hits.

For secrets, compare scoped encrypted field representations and mappings where
available, never plaintext hashes. A ciphertext/key rotation or shared `containers-env`
change may conservatively select all its consumers. If reliable field scoping is
unavailable, select all services consuming that host ciphertext. Precision can improve
later without weakening protection. Account for runtime secret drift through the
existing private reconciler; build metadata alone is not proof of current state.

The planner returns a small private document: old/candidate identity, backup service
list and reason, reconcile list, required readiness dependencies, and local-versus-
off-host recovery requirement. No generic user-authored dependency DSL is needed.

Rules:

- Image, application configuration, credentials or application storage changes select
  the affected service for backup and reconcile. Keep this conservative initially:
  even a Beszel inventory edit can remove history and therefore deserves a Beszel
  recovery point. A host monitoring-agent-only edit needs no application backup.
- Shared services VM/runtime/storage changes select every service in that VM. HA VM
  and network changes select HA and require dependent readiness checks. A dependency
  probe does not automatically imply another app needs a data backup/restart.
- Backup/operation/activation safety implementation changes or unknown metadata take
  the full existing protection path. Missing old descriptors require one full
  transition backup; a first optimized release cannot infer historical equivalence.
- Service removal continues to refuse automatic activation. New services require the
  existing provisioning/restore checks; they are not silently created by the planner.
- No changed app descriptors means no application snapshot, provided generated
  activation/launchd changes cannot nevertheless disturb their runtime or storage.
  Unknown host changes use the broader path until classified.

Compute against the installed accepted generation, not a Git commit diff or the
last promoted source. Persist the chosen plan under the lock so recovery uses the
same decision. Revalidate current/profile identity before proceeding.

## 3. Generalize selected backup and reconciliation

Extend existing backup arguments to accept an explicit validated subset of assigned
services for transaction use. Keep current scheduled scope names and retention
semantics. Update recovery metadata and `verify-backup.py` together so a scoped set
is complete for its declared services without masquerading as a full-host backup.
Use old-generation images, Compose, credentials and backup tools when capturing old
state. If that generation cannot accept the new interface, use its existing full
backup behavior for the transition rather than invoking candidate code on old state.

Put deployment-scoped sets in a distinct namespace with explicit capture-purpose and
service-subset metadata. They must never count toward or evict the seven retained
verified full sets, hourly history or Penpot scheduled history. Define bounded local
and remote retention for verified deployment sets, preserving pending sets and any
point pinned by an active/interrupted transaction. Reject a scoped set when a caller
requests full-host recovery. Keep previous complete recovery formats readable.

Extend the existing reconcile handlers to accept the transaction's selected list.
Preserve ordinary scheduled full reconciliation for drift detection. Avoid duplicate
full health passes by assigning final acceptance to one owner; retain per-service
post-snapshot health and pre/post-activation checks needed to catch actual failures.
Do not change system-wide activation to skip required Nix/SOPS/launchd work.

## 4. Separate durable local capture from NAS publication

Refactor `backup.py` into local capture/verify and publish-pending operations within
the same driver. After snapshot/recovery packaging, validate service recovery, exact
payload hashes/sizes, archive structure and database/media requirements; fsync files
and directories and atomically publish a private local-complete manifest/receipt.
Local acceptance must not depend on contacting or authenticating to the NAS.

Keep local completion separate from remote `COMPLETE.json` and `NAS_VERIFIED`.
NAS failure must not produce a remote completion claim. Reuse a completed immutable
local set; never recapture changing state merely to retry a transfer. Pending sets
are durable filesystem state, not a new queue service.

Move snapshot-time service-health evaluation out of `verified_copy`: it belongs in
local completion before activation. The asynchronous publisher validates the frozen
set and capture-time receipt, not current service health against an older generation's
images. Current live health remains a separate deployment/monitoring signal.

Ordinary app/config changes may activate after a valid local recovery point. Shared
storage/VM migration or recovery changes that could make the local point inaccessible
must still wait for a verified off-host copy. Keep this a planner-owned policy with
an explicit reason, not an operator bypass flag. Missing/unknown policy fails broad.

Use one launchd publisher, owned by the backup module, to drain immutable pending
sets after capture and on a bounded retry schedule. It uses a separate kernel-held
publisher lock, not the mutation lock during network work. It must not read live
volumes, project secrets, stop/restart services or accept generations. Retention must
not remove a set in publication; coordinate short metadata/retention operations or
hold set ownership throughout publication. All consumers share the same manifest
and lock contract. Do not duplicate existing hourly/Penpot/full upload owners.

Pending-set format, checksums, upload progress and destination are self-contained
across generation switches and reboots. The current publisher accepts supported older
formats and obtains NAS credentials through its service-owned secret projection; it
does not depend on an old Nix executable remaining uncollected. Upgrade and rollback
must either retain compatible publication support or refuse before changing ownership.
Reconcile remote progress after restart by checking expected immutable bytes.

Keep every unreplicated set protected. Reserve disk space for pending data plus new
capture workspace; if capacity is insufficient, defer activation visibly rather than
discarding pending recovery points. Bound publisher runtime/backlog handling and
expose oldest-pending age, last success and failure. Preserve existing remote history
and retention namespaces; old accepted backup formats remain readable.

Publication retries verify already-present remote files before resuming an immutable
set, rather than overwriting them. Preserve certificate pinning and bounded session
refresh. Ambiguous writes are reconciled by read-only inspection before retry; the
existing uploader's refusal to blindly replay unknown network errors remains.

## 5. Add bounded parallelism at existing seams

Start with two concurrent I/O children as a fixed conservative implementation limit;
do not expose a tuning UI or claim that two is benchmark-optimal. Retain current CPU,
RAM, disk and CI-runner admission limits.

Admit overlap only after checking both macOS capture/staging space and free space
inside the services VM for compressed image downloads, expanded layers and snapshot
scratch. Reserve their combined peak workspace; the current host-only 30 GiB check
does not establish VM headroom. If conservative combined admission cannot be proved,
pull and capture sequentially. Publisher transfers use already-compressed immutable
payloads; new capture/compression and host builds take priority over background work.
Bound or defer background work when measured host load/available space makes overlap
unsafe; do not add a general resource scheduler for this policy.

1. Pre-pull changed pinned images while local capture runs, after identity/volume
   checks and under transaction supervision. Pulls do not start containers or write
   application data. Join both tasks before activation. Backup failure or pull failure
   prevents activation; complete and reap the other child safely. Explicitly pass
   inherited lock ownership where required; never launch a second transaction.
2. After shared runtime/secrets are ready, reconcile independent Compose projects in
   bounded groups. HA readiness precedes dependent Control Center acceptance. Keep
   each multi-container project's internal Compose dependencies and secret dirty
   marker behavior. Scheduled launchd reconcilers must defer while the transaction
   owns mutation; they cannot duplicate its children after daemon reload.
3. Run independent final health probes concurrently, collecting every required result
   into one final acceptance decision. Dependency-aware checks still wait for their
   prerequisite. A probe failure does not automatically replay mutations.
4. Within the background publisher, allow two independent payload upload/read-back
   tasks. Use independent authenticated client/session objects unless the NAS client
   is proven thread-safe; joining one failed upload must not logout another live
   request. Only publish completion after every payload is verified. Bound network
   concurrency across all backup scopes through the one publisher.

Keep cold snapshots sequential initially. Stop/copy/start ordering within Penpot,
Bambuddy and database/media recovery units is required. Do not simultaneously cold-
stop unrelated household applications or compress multiple large dumps on the 8 GiB
mini without measured evidence that it improves latency and service availability.

Cancellation/failure must stop new launches, join/reap already-running children,
preserve per-service outcomes and restart-required markers, and retain the host lock
until mutation children finish. Killing the parent must not orphan an unowned writer.
Reuse `service-child.py` and current process-group supervision rather than inventing
a general job runner. Failed activation retains explicit recovery; no automatic data
rollback or stale generation restart is added.

## 6. Reduce CI/build cost after host scope is correct

Defer additional Nix binary-cache publication until a bounded implementation shows
a net end-to-end benefit. The initial GitHub cache integration encountered throttling
and spent nearly 15 minutes in its post-step after checks passed; remove that integration
from this rollout. Native Nix local/upstream substitution remains. Future output reuse must be tied to derivations,
trusted signatures and existing secret-free package inputs; preserve an independent
off-host recovery build route. No cache credential goes to a disposable guest that
does not need it, or into a Nix derivation. Do not equate a successful cache upload
with a deployed host.

Then split broad flake validation into existing named checks and affected host/package
selection, retaining full flake checks for shared evaluator/lock/toolchain changes.
Do not weaken the required Homelab gate. Prefer built closures over repeatedly building
the same inputs on PR, main and hosts. Exact-input evidence reuse requires validation
of source/derivation, workflow attempt and trust context; it must not accept stale
checks merely because paths look similar. Optimize queue delay separately from build
execution. No new CI capacity/runner resource changes are part of this plan.

## Delivery order and verification

Implement coherent slices in this order: fast fixture harness and planner with timing;
Nix descriptors and transaction wiring; scoped capture
and reconcile; durable local acceptance/publisher; safe parallelism; cache/CI narrowing.
Each slice stays compatible with the previous installed generation. Keep repository
implementation/review/checks local until its candidate is reviewed, then use required
CI and normal source promotion. Do not enable disabled product/infra writers.

Use focused existing suites in `homelab/tests` for transaction, locks, snapshots,
backup scopes/verifier, reconciliation and NAS behavior. Add tests only for new
decisions and failure boundaries: unchanged service despite unrelated edit; app-only
change; shared VM change; conservative secret rotation; old metadata transition;
scoped-set completeness; NAS unavailable after local acceptance; pending-set retention;
concurrent child failure/reaping and no premature remote completion. Existing
assignment/removal, storage, interrupted-transaction and duplicate-owner tests remain.
Specifically verify that repeated scoped captures cannot evict full/hourly/Penpot
sets; insufficient host or VM workspace refuses both overlapping children before
either begins; and a pending set still publishes after its source generation is
unavailable and current services are unhealthy.
Run relevant Python/Rust/workflow checks and Nix builds without activation.

For rollout, inspect actual owner/revision and existing pending recovery state first.
Use a disposable transaction fixture for crash/transfer failures and one downloaded
new-format scoped-set restore in isolation because this changes the backup mechanism.
Do not repeat all-service restore/reboot rehearsals for every later ordinary change.
Verify one monitoring-agent update and one Control Center image update through the
normal owner, checking accepted source, intended affected services, unrelated container
continuity, retained workers, local recovery point and subsequent NAS verification.
Use the existing real shared-runtime validation evidence where compatible; exercising
a disruptive shared VM change solely for timing is not required.

Acceptance records compare merge-to-host-accepted time, CI queue/build time, lock
duration, per-service interruption, local/NAS bytes and oldest unreplicated recovery
age. Required behavioral wins are zero app snapshots for monitoring-agent-only
changes and zero unrelated app snapshots/restarts for an ordinary app image change.
Numeric latency targets follow measured host baselines; this plan claims no measured
speedup percentage. Document the final ordering and completion semantics only after
the implemented behavior works.

## Review

An independent review agent inspected this plan against the current transaction,
backup/retention, verifier, Nix and reconciliation source. It judged the approach
compatible with the existing architecture and requested three fixes:

1. **P1: independent retention for scoped deployment sets.** Added a separate namespace,
   explicit coverage/purpose, protection for transaction-pinned and pending sets, and
   a regression ensuring scoped deployments cannot evict full or other scheduled sets.
2. **P2: dual-domain storage admission for overlapping pulls/capture.** Added host plus
   services-VM checks and combined peak-workspace reservation, with sequential fallback
   and refusal before either task starts when admission cannot be satisfied.
3. **P2: publication independent of current generation health/configuration.** Moved
   service recovery health to durable local acceptance; publication reads immutable
   capture evidence only, with versioned pending sets surviving switches/reboots and
   a regression for an unavailable source generation/unhealthy current service.

The same reviewer checked the revisions, confirmed all three findings addressed and
reported no remaining actionable plan gaps. That review covered the design before
the development-loop addition; implementation remains subject to local verification.

## Implementation working note

- Implemented in #973: pure generation planner and fixtures; evaluated per-service
  inputs with filename/content identity; old-generation fallback; scoped local capture
  and retention; independent NAS publisher; two-child reconciliation/probes/uploads;
  sequential admitted image pre-pulls; transaction/capture/publication timings;
  focused developer command and service-only CI build selection.
- The fast entrypoint is `bash scripts/dev homelab [planner|activation|backup|all]`.
  Full local homelab tests currently finish in under a second. Automation tests run
  separately through existing `scripts/homelab` discovery. Full required CI remains.
- Image pulls deliberately stay sequential with snapshots because combined peak disk
  demand is not established; host and VM reserve checks run before each pull.
- The optional GitHub Nix cache is removed following a post-step taking about
  14 minutes 35 seconds in run 42672720821. The pinned action awaits its finish request without
  an HTTP timeout before reaching its daemon shutdown timeout. No CI speedup is claimed.
  Hosts keep native local/upstream substitution and independent build recovery.
  Service-only CI evaluates the full flake and builds both actual host outputs
  plus the descriptor isolation check. Shared changes build the full check set.
- Independent final code review found a missing inherited descriptor on scoped capture
  health and a filename omission in fingerprints. Both are fixed. A real subprocess
  regression covers descriptor inheritance. Preflight failure timing and safe pin
  cleanup were also addressed. The reviewer confirmed no actionable findings remain.
- Compatibility: the no-argument backup command captures locally and then waits
  for all pending NAS publication, preserving older executor/rollback semantics.
  New scheduled and scoped activation calls explicitly select local-only capture.
- Local verification: complete homelab Python/automation suites, targeted Python lint,
  workflow syntax, and a real Nix mini-system/descriptor build in private staging.
  These are local/pre-publication observations, not production delivery evidence.
- Production: both hosts accepted #973 at `3a48163d`. The transition's full backup
  took 392.28 seconds, activation 4.47 seconds and reconciliation 7.29 seconds.
  A Control Center-only capture took 16.38 seconds for 564,537,075 bytes. After the
  NAS protocol correction in #977, publication/read-back took 21.98 seconds; an
  independent NAS download passed SQLite integrity/foreign keys and all 136 photo
  references matched media. These different scopes are not a matched speed benchmark.
- Protocol lesson: test both whole-request and per-item errors in batch transport
  fixtures. DSM can return outer success with nested file-absence error 408; that
  must permit upload while other errors and mismatched existing bytes fail closed.
- Remaining: pass the corrected main CI and accept its exact source on both hosts.
  Required PR CI passed; later main runs encountered GitHub internal orchestration
  failures and the cache post-step stall. Keep writer flags and recovery generations.

## CI efficiency follow-up — November 9, 2026

The earlier deployment work reached both hosts at `bb5f12f`; its final evidence is in #981.
The next candidate narrows verification through the existing repository selector, maps workflow
consumers, separates operations/controller/Nix checks and Rust/contract/native checks, advances
compiler snapshots, explicitly persists Docker Cargo mounts and bounds signed Nix output reuse.
Host operations now consume a small shared process crate instead of the entire interactive CLI.
The CLI itself is installed on hosts, so a shipped CLI edit still legitimately changes host outputs.

Baseline job evidence: run 42686330040 took 21:05 for Darwin (18:25 Nix), 0:27 for operations
and 1:09 for Linux controller verification. A release.json-only PR/merge took 18:29/11:59 for
Darwin in runs 42711463457/42711554105. These are samples, not controlled before/after results.
Expected savings are hypotheses: avoid platform jobs for test-only edits; reuse unchanged package
outputs for service edits. The candidate adds an explicit same-path before/after replay and
per-cache receipts. PR #991 records final hosted measurements, independent reviews and exact-source
CI/merge evidence. A local paired cold-target host test/build took 18.307s before and 5.541s
after the process extraction (Cargo 1.99.1, four build jobs, pre-downloaded registry, same Mac);
locked packages fell from 171 to 43. This is a package-level sample, not overall CI latency.
Optional previews now follow actual UI/capture inputs rather than broad verification fan-out.

The same-path hosted replay in run 42734665801 compared `de2417085` with `509d84133`:
the first baseline Darwin handler took 1113.939s, while the candidate selected only operations
at 32.248s. Local-warm handler maxima were 33.332s and 30.916s respectively. These are real
per-check timings on equivalent hosted Mac images; the maximum is calculated from sequential
handler runs, not a measured distributed critical path. Runner queues/setup are excluded.

First-fill versus next-run measurements with unchanged Rust/container inputs in runs
42734649922/42736105713 were 65s/37s for typecheck, 77s/38s for Rust tests and 195s/113s for
the complete image job. Docker extraction still cost about 40s, included in those totals.
This demonstrates warm reuse, not a guaranteed speedup for dependency changes or every CI run.

Broader verification exposed two fixture assumptions. Folding's late-insertion test now seeds
through ingestion so retained observations and week/month scores agree at calendar boundaries;
its original assertions pass without mutation retries or production changes. The runner lease
test explicitly models a descendant retaining stdin after `set` exits and waits for bounded
quiescence, retaining held-lease, command-order and cleanup assertions. Focused reproductions
failed before these corrections; all 30 runtime and 123 runner unit tests passed afterward.
