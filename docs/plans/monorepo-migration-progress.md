# Monorepo migration progress

Execution authorized November 8, 2026. The accepted scope and acceptance criteria are in
[the migration plan](world-wide-webb-monorepo-2026-11-08.md).

## Current candidate

Local branch `codex/monorepo-consolidation`, created from WWW `242eb8f4a0c3dc1ca336c20682e610128f914ac9`.
Nothing published, no visibility or production changes. Original working copies remain untouched.

Non-squashed local history imports:

- Folding `ea966862c7e07e08bb7f046873b94d7c915977a3` into `apps/folding`.
- Callkeep `73bb6dde3dbc765756ff12f3751db5bfad9bc4de` into `apps/callkeep`.
- Apps `590d39abf0d483d232b3045d10446ef83895ae79` temporarily into `imports/apps`;
  staging contents have been moved to their product/tooling/site locations. No tracked `imports/` paths remain.

## Work remaining

- Finish target layout and product command/release adapters. Air Miles and 27 Matt Pocock skills imported; RDesign is Tendr-local.
- Verify selective CI and gate; connect actual product checks and release evidence.
- Implement and canary Apple delivery, private Homebrew artifacts and screenshot access.
- Refresh/import homelab and CLI only after their active source work lands; preserve setup state.
- Transfer scoped Cloudflare/home operations and verify state, login, data, backups and recovery.
- Complete documentation, templates and encrypted signing ownership.
- Independent final Astra review, grouped fixes, relevant checks and integrated verification.
- Make WWW private before pushing private history; publish, pass required checks, merge and verify delivery.
- Retire old authorities/archive eligible repos after replacement proofs. Preserve every exclusion.

## Dependencies and preservation

Homelab main advanced to `ae2b14e2df6575712802522a1d0ff1a01a0370a8` (Beszel merge).
Linux runners and CLI recovery still have active work. Main merges do not prove live activation.
Folding has uncommitted product/design changes; apps has Air Miles branch work and an untracked
Tendr requirements document. Do not silently discard or freeze these; refresh before handover.

## Local evidence so far

- Selective CI: 9 tests pass, including real Git rename/deletion inputs, product isolation,
  docs/tooling behavior and CLI verification without host activation. Not connected to live delivery yet.
- Tendr: 50 core tests, mocked release checks and private-site retention/publication tests pass.
- Air Miles: 8 core/import/enrichment tests pass. Its small dynamic-color helper is app-local.
- Non-squashed history ancestry includes apps main and Air Miles branch `9bf0c8a`.
  Branch Tendr changes were already integrated/superseded by main (#58/#64/#65/#66);
  retained main's native rail/export/control fixes rather than restoring obsolete sidebar behavior.
- Original untracked Tendr requirements document copied into candidate; source left unchanged.
- First local implementation commit passed encryption/privacy/secret/format hooks.

- Xcode 27.2: regenerated Tendr/Air Miles projects and built both for generic iOS
  Simulator successfully with signing disabled. This proves build compatibility locally,
  not unattended VM posture capture or signed distribution.

## Control Center relocation

The complete Swift/Rust/Docker/deploy/tooling root now lives under `apps/control-center`,
with product docs/instructions preserved. Shared root guidance maps all products.
The original check/setup entrypoints delegate to the moved product. Infrastructure source/state
and shared home ownership have not yet moved; root secrets stay encrypted in place.

- All 96 Control Center operations/tool tests pass from the new location.
- Eight product-CI tests and nine shared selection tests pass; unrelated app changes skip
  Control Center jobs and forced verification cannot upload a native build.
- All current root workflow files pass actionlint. Apple jobs now request the existing
  disposable homelab macOS label; image/toolchain canary and Linux migration remain pending.
- Rust fmt/clippy and 30 Rust tests pass; all 99 PanelKit tests pass. Real Swift/Rust integration and the production Apple checks are running. No production writes have occurred.

## Delivery preparation — approximately 15% overall

Percentages are rough estimates of total migration effort, including live cutover/verification,
not a count of moved files or passing tests. Current stage: private release and screenshot adapters.

- Control Center real Swift/Rust round trip and production iPad build/unit/iPhone policy checks pass.
- Callkeep updater/dependency/feed controls removed; native build plus 55 tests pass, with two
  existing downloaded-ASR/speaker-model smoke checks explicitly skipped. Playback harness passes.
- Folding Bun frozen install, Rust/Wasm build and all 29 workerd runtime tests pass. Its 17
  schemas/69 contract-example checks pass using the pinned Python 3.15 interpreter.
- Tendr release wait points at its actual workflow; private PR screenshot previews use authenticated
  Actions artifacts and run summaries, replacing anonymous raw links and screenshot branch writes.
- A notarized installed Callkeep bundle survived an isolated Git shallow-tag clone with strict
  signature/stapled-ticket verification. Actual Homebrew Git fetching also passes with strict signature/stapled-ticket verification, using an
  isolated temporary tap/cache/trust configuration; the temporary tap was cleaned up. Private
  GitHub authorization and a real install/upgrade remain unproved. Current Homebrew requires
  explicit cask/tap trust; document narrow trust in the installer instructions.

## Infrastructure source preparation — approximately 20% overall

Refreshed WWW main to `56acbffe5c3ceab90a6db04936b109d68f4acb11` and merged its
new Beszel route and positive remote-apply confirmation guard into the moved layout. The
monitoring chat reports live login, two reporting Macs and backup/restore acceptance; migration
handover still requires independent current-state verification. Linux runner work remains active.

Home HCL now lives at `infra/cloudflare/home`; Folding retains independent bootstrap/staging/
production roots and modules under `infra/cloudflare/folding`. State/resource addresses, remote
keys and credentials are unchanged. Shared home scripts/writers have not handed over yet.
Folding website source moved intact to `sites/folding`; both public asset builds succeed.

Home OpenTofu formatting/validation, two mocked route tests and the isolated encrypted-state/
exclusive-lock/wrong-key/backup-restore proof pass at the new path. All three Folding roots initialize with backends disabled and validate successfully using
fixture encryption inputs. No live infrastructure apply has been performed by this migration.

## Foundation review and private artifact preparation — approximately 24% overall

Astra independently reviewed committed foundation `ca1b9d134`. All six findings and the
additional source-path ownership gaps were addressed together: separate verified/image/apply
authority, updated Tendr RDesign test paths, independent native scaffold, infrastructure-helper
ownership, Folding formatter source path and accurate screenshot capture revision. Site/icon
workflow paths and Folding toolchain dependency ownership were updated too.

Validation: 15 Control Center CI/isolation tests, 9 shared selection tests, legacy real-Git
affected fixtures with new app-local package coverage, release-lane/wait tests and actionlint pass.
A freshly scaffolded independent sample app builds for iOS Simulator outside the repo.

The private-artifact preparer creates deterministic zero-parent Git commits containing only
prebuilt payloads and a source/byte/mode receipt. Three real-Git transport/validation tests pass.
A separate canary using the existing notarized installed app passes strict Developer ID/team,
Git round-trip and stapled-ticket verification. Its source identity is synthetic: this is transport
proof, not a signed release of the current migration source or a private GitHub auth/install proof.

Astra's foundation report is retained outside Git at `/tmp/monorepo-foundation-astra-review.md`.
The complete migration still requires its final independent review before publication.

## Folding delivery invariants — approximately 29% overall

Repeated same-marketing-version betas now use unique `folding/build-N` records with a shared
append-only allocator across staging/production and beta/store/local/CI. Four complete reservation
tests cover idempotent retries, shared monotonic numbering, CAS races and historical tag readers.
The complete pre-existing release suite plus these changes passes (15 tests / 505 assertions
before adding backend-input tests). All 113 core/storage tests pass.

Found and addressed a hidden source dependency: Apple build allowlists were Worker bindings.
A new explicit D1 published-build policy preserves the legacy allowlist and all cryptographic
checks, using the already-existing build header only to select a registered version. No new
HTTP admin endpoint or secret binding is added. The actual compiled Worker passes all 30 runtime
tests, including exact registered versions, wrong environment/app, unknown builds, forged signed
version/header mismatch and replay/body/counter protection. Three SQLite-backed registration
tests cover immutable identities, lost-response reconciliation and scoped keys.

Backend runtime-input hashes normalize original/imported paths and separate iOS/Xcode/docs
changes from actual Worker changes. Compatibility now requires the immutable verified deployment
receipt. CI evidence is tied to the named workflow/job, trusted main push and exact attempt.
Two real-Git/evidence tests pass. New policy/schema/deployment and the updated ledger destination
are local only: original release writers, records and services are unchanged.

GitHub settings discovery confirms current WWW has active required checks. The private Folding
ruleset API returns the explicit GitHub Pro upgrade requirement. Resolve private ruleset support
at the final cutover gate; no billing or visibility change has been made. Existing apps Pages
is live at its legacy URL, served from its `gh-pages` branch.

### Folding invariant review fixes

Both nested-product Git source fences now run tree enumeration from the repository root.
Backend receipts require the named trusted backend CI job, live 100% provider version and
matching app/environment/source/D1 bindings. Preview compatibility is rechecked for 1.x too.
The full release suite passes: 19 tests / 532 assertions. Four SQLite registration tests and
the real nested-Git migration fixture pass. Archive recovery now burns the old immutable build
tag and creates a separate replacement; retries follow the durable link. No live writer changed.

Received an outage report from the independent Control Center repair chat: installed devices
still use the retired `homelab` Tailnet identity; the rebuilt Mini has a different name and lacks
private HTTPS Serve. That chat owns the immediate endpoint repair. This migration must import
its resulting commit/route contract before cutover and must not overlap identity/Serve changes.
Linux runner work is still active; its latest report proves four overlapping Linux builds passed
with mixed Apple/Linux load validation remaining. Homelab authority handover remains pending.

## Selective product CI and screenshot automation — approximately 31% overall

Folding now has root workflows for independently selected contracts, backend, domain/storage,
localization and native checks, plus a fail-closed aggregate gate. Callkeep has its own native
CI and aggregate. Linux jobs target the pending homelab Linux route; Apple jobs use the existing
homelab Mac route. New workflows remain local, with no claim of live runner acceptance.

Every product has a registry manifest and explicit delivery handler. Standard iOS matrices and
Fastlane reject custom handlers; adding Folding/Control Center cannot accidentally feed them
through Tendr signing or upload logic. All standard-iOS products now wait for exact-source CI.
Ten shared selector tests pass, including test-only non-delivery; real Git impact fixtures pass
including custom-handler exclusion and cross-app moves. All workflows pass actionlint.

Folding has separate five-scene English outer-display PR previews and full ten-locale App Store
capture workflows. Previews have a distinct directory/purpose/manifest and cannot serve as full
listing evidence. A shared scoped native Device Hub process controller automates Open/Closed
requests; product XCTest still verifies native geometry. Controller build/sandbox and actual VM
capture acceptance are tracked separately; live capture proof remains outstanding.

Astra's final Folding invariant report at `/tmp/monorepo-folding-invariants-final-astra-review.md`
found no remaining actionable issue after preview recovery, pre-write durable registration intent
and current accepted-backend source propagation fixes. Crash-boundary tests exercise read-only
retry before a receipt, after local receipt and after remote artifact publication. This focused
review does not cover the subsequent CI/capture wiring or replace the complete final review.

The shared native controller builds for macOS and its signed sandbox grants exactly the temporary
capture directory. This proves compilation/entitlement scope, not yet actual pose/capture behavior.
The full Folding Ruby suite passes at this candidate: 22 tests / 576 assertions.

The independent endpoint-repair chat now reports private HTTPS/app API restored at the original
`homelab.tail8c014d.ts.net` via `svc:homelab`, approved only on the rebuilt Mini. The old offline
node was renamed `homelab-retired`. Preserve this service route; host SSH must use
`admin@homelab-mac-mini.tail8c014d.ts.net`, not the now-service `homelab` DNS name. Its durable
homelab candidate is `ec73547` (publication pending when reported). An existing resolver symlink
health issue remains for the homelab owner to reconcile. These are reported repair findings;
this migration still owes independent delivery verification.

### Reconfirmed speed and working instructions

The owner explicitly reconfirmed fastest usable app cutover first, homelab handover once current
changes land, and remaining cleanup/retirement afterward. The active goal was recreated with
this ordering after the prior goal was cleared. All migration scope remains required; optional
polish will not hold up working apps. Continue substantial implementation batches and concurrent
independent Astra review, reusing valid checks/artifacts and reporting overall progress honestly.

Astra's CI/capture review is complete with no remaining actionable findings after fixes:
full screenshot job names match evidence validation, active Tendr shipping uses shared delivery
inputs (test-only edits do not publish), and Worker embedded HTML/policy/certificate/build inputs
select backend delivery. Twelve selector/real-Git delivery tests, existing impact fixtures and all
six evidence workflow/job-name pairs pass. Report: `/tmp/monorepo-ci-capture-astra-review.md`.

### Unblocked Linux rollout from the retired deployment target

Verified GitHub `MINI_DEPLOY_ENABLED` was true while the active old deployment workflow still
SSHs `calum@homelab.tail8c014d.ts.net` and stages under `/Users/calum/www-control-center`.
The repaired hostname is now the HTTPS service, not a host SSH identity. Disabled that broken
trigger by setting the variable false; the current Mini service and private HTTPS route are
untouched. This temporary bridge prevents an unrelated CI-only merge from invoking obsolete
operations. It is not replacement deployment acceptance; enable only the reviewed new host/service
promotion route after live verification. The Linux agent reports all load/restart/cancel/isolation
gates passed and permanent pool rollout is in progress.

## Automatic Folding delivery adapter — approximately 34% overall

The root Folding delivery workflow now consumes source-bound selection from successful trusted
main CI, with its enable switch remaining off. CI seals the actual tested Wasm/JS artifact;
deployment validates those bytes, retains pre-migration D1 recovery-bookmark metadata, uses the
existing checksum-fenced migration wrapper, and publishes an immutable verified provider receipt.
The receipt omits unrelated/private runtime variables. Crash fixtures cover migration interruption
and lost deployment/receipt outcomes, preserving the first recovery bookmark and reusing the
already deployed source instead of rebuilding it.

Internal betas validate the exact named native CI jobs and live compatible backend, use readonly
signing, archive once, poll Apple processing and distribute only to configured internal groups.
Lost-upload-response tests reconcile a processed build without a second binary upload. The
allocator accounts for the live minimum-build floor; a retired pending reservation gets a new
linked immutable reservation rather than mutating its build identity.

A durable native-input delivery receipt handles GitHub's replaceable pending job: after acquiring
the shared delivery slot, the latest candidate compares actual native inputs with the last
confirmed distribution. A backend-only source can carry forward an otherwise lost pending native
change; identical native inputs do not ship. Older source completions cannot roll back a newer
recorded native distribution or a newer known Worker deployment. Backend verification also checks
its native client, and small contract checks run for native candidates so evidence is complete.
Thirteen selector/real-Git input-equivalence tests pass; backend crash/coalescing tests pass.
This is local wiring/test evidence. Secrets, ledger transfer, private visibility, live provider,
Apple and native VM screenshot acceptance still gate activation.

Before schema writes, the delivery adapter now confirms that the configuration's exact D1
identity/app/environment are bound to the current live Worker. Production credentials are
scoped to their specific publication steps, after dependency setup. The existing repaired
Control Center health endpoint was independently verified from this primary session: HTTP200,
revision `72f9533c84cc9362b9a3df9a5fe3f079411c638d`, after disabling the obsolete trigger.

The completed local automatic-delivery batch passes all 28 Folding release tests / 610 assertions,
13 selector/input-equivalence tests and actionlint. Four backend tests cover artifact identity,
live DB binding, crash/retry order and queue coalescing; the upload-response test distributes the
already processed build once without uploading another IPA. Complete independent batch review
is next; live channels remain off pending the documented acceptance gates.

### Automatic delivery review complete

Astra identified and rechecked five integration fixes: workflow recovery now uses its trusted
actor rather than the user-only API; original exact CI attempts/immutable deployment receipts
remain usable after reruns; runtime compatibility excludes pure JS/test tooling while canonical
backend compiler/build pins select deployment; internal-group membership is read back before
native delivery is recorded; accepted capabilities/flags cannot be relabelled over changed backend
inputs. The existing source-bound readiness/evidence generator remains the authority for actual
backend changes, carried forward only when normalized compiled inputs match.

Independent final checks pass: 33 Folding release tests / 656 assertions, 13 selector/input-hash
tests and the existing readiness-generator regression. Full report and exact reviewed file blobs
are outside Git at `/tmp/monorepo-folding-automatic-delivery-astra-review.md`. This closes the local
batch review; private-source/account gates, live credentials/ledger, actual runner/provider/Apple
and screenshot acceptance remain outstanding.
