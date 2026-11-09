# Monorepo migration progress

Execution authorized November 8, 2026. The accepted scope and acceptance criteria are in
[the migration plan](world-wide-webb-monorepo-2026-11-08.md).

## Active goal execution contract

The full consolidation goal remains active. The November 8 working instructions govern
execution, including where they are stricter than the stored goal wording:

- The primary agent implements substantial coherent batches. Subagents provide independent
  final review only; Astra reviews the completed candidate, with findings fixed locally.
- Keep the entire migration candidate, verification, review fixes and Conventional Commits
  local until the complete candidate is reviewed. Then publish, pass required checks, merge
  and verify delivery. A usable-cutover priority does not authorize publishing a partial candidate.
- Preserve the existing worktree, original checkouts, ongoing source work, product identities,
  data/media, infrastructure ownership and excluded repositories. Refresh sources before handover.
- Use one primary-agent persistent credential session; reviewers do not access credentials.
  Keep secrets, private state and private visual evidence outside Git.
- Optimize elapsed time through substantial batches, existing product tooling and reuse of
  valid exact-source evidence. Run relevant checks and required product acceptance checks;
  avoid repeated broad verification without a new reason.
- Continue autonomously within the agreed scope. Report estimated overall completion and
  current stage. Completion requires actual delivery, retained integrations/data/media and
  applicable restore evidence; local wiring or successful uploads alone do not prove it.

Overall estimate remains approximately 36%; current stage is local release-adapter review
and fixes. The complete candidate is not yet ready for publication or live cutover.

## Current candidate

Local branch `codex/monorepo-consolidation`, created from WWW `242eb8f4a0c3dc1ca336c20682e610128f914ac9`.
Migration candidate not published; repository visibility is unchanged. Original working copies remain untouched.
The obsolete Mini deployment trigger was disabled separately; the running service remained healthy.

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

### Callkeep signed source identity preparation

Private packaging now requires the notarized app's signed Info.plist to match the exact full
source SHA, monotonic `1.0.N` version/build counter, production mode and existing bundle identity.
The app/project embeds that source field; four distribution tests pass, including all metadata
mismatch cases and real Git mode/symlink/byte preservation. This does not yet prove a freshly
signed candidate, private GitHub authentication or installation/upgrade. Automatic Callkeep
reservation, signing/notarization, immutable artifact-tag publication and tap update remain next.

## Private artifact promotion preparation — approximately 35% overall

Callkeep's updated native project builds successfully and embeds the declared source field while
preserving its bundle identity. The shared private-artifact publisher validates the committed
orphan payload, signed product identity and byte receipt, pushes only the immutable namespaced
distribution tag, and confirms remote identity after an ambiguous response. Seven distribution
checks pass with real local Git transports, including repeated publication, conflicting bytes,
source-parent rejection and unavailable-remote failure. No private GitHub publication occurred.

Callkeep's cask renderer now emits the built-in Git strategy with an immutable commit/tag in
private WWW and removes Sparkle/public-release URL authority. Existing installation data paths
remain the same. Root full-history CI checkouts use `filter: blob:none` to avoid fetching old
artifact payload blobs, retaining the temporary repository token for authenticated lazy reads of
historical source inputs until checkout's post-job cleanup. Product production secrets remain
scoped to their actual publication steps. See the primary checkout action documentation:
https://github.com/actions/checkout#usage . Actual private fetch/install/upgrade remains a cutover
canary; automatic Callkeep counter/signing/sealed artifact/tap handover is still being wired.

Full-history filtered checkouts use the pinned v6 action, whose temporary credential file stays
under runner temporary storage rather than `.git/config`. The old action versions are not used
for these credential-preserving filtered history reads. Callkeep's private cask parses as valid Ruby;
source binding also passed an actual unsigned native app build (not a signed release canary).

Eight distribution tests now pass. A real Git server fixture advertises filtering, serves a source
branch plus a separate 3 MB synthetic orphan binary tag, and proves full source/tag history can
be fetched/checked out while the binary blob remains missing and total received pack data stays
below 1 MB. This is local Git/filter proof, not a GitHub authorization or install proof.

### Artifact foundation review complete

Astra found and verified two fixes: the cask explicitly selects `only_path: "Callkeep.app"` so
Homebrew uses its built-in sparse partial clone, and the privileged Folding publication job keeps
checkout credentials nonpersistent through dependency setup. Authenticated publication commands
use a per-invocation Git helper reading their already-scoped GH_TOKEN, without writing token values
to arguments or Git configuration. Readonly source selection can retain its temporary checkout token.

Actual installed Homebrew fetch, staging and cached refetch passed with the exact selected app
revision/bytes/executable mode. The synthetic 1 MB source blob and unrelated 3 MB orphan artifact
remained missing; received pack data was 822 bytes. Probe/report are outside Git at
`/tmp/artifact-homebrew-strategy-review.rb`, `.json` and
`/tmp/monorepo-artifact-foundation-astra-review.md`. Eight distribution tests pass. No remaining
actionable foundation review findings; the full producer/private signed install is still pending.

### Mac image alignment required before app activation

The active homelab candidate still pins its documented Xcode26.4.1 image (`e329b2ea...`), while
Folding requires Xcode27.2/27B52 and its exact Duo runtime. Public GHCR metadata confirms an image
candidate `ghcr.io/cirruslabs/macos-tahoe-xcode@sha256:f8315a2f627daf64ab2c4e11d29a4d267953902a16151ee28fcdd7185927c317`
for tag27.2, uploaded2026-10-31, with a140000000000-byte uncompressed disk. This is registry metadata,
not yet booted toolchain/runtime proof. Upgrade through the homelab owner after its current work lands,
with admission held, disk reserve/old-image recovery retained, and fresh native/mixed-load canaries.
Do not overlap its current pool rollout or silently lower Folding's pins to the old image.

## Automatic Callkeep producer — approximately 36% overall

The local product workflow now verifies the exact trusted-main native CI attempt, atomically
reserves namespaced source tags above the legacy counter floor, builds universal source-bound
production binaries, and uses the existing Developer ID/notarization scripts. It seals private
ZIP/symbols/sanitized Apple acceptance receipts, uploading symbols/evidence before the ZIP so a
complete archive can resume without rebuilding. An interrupted unsealed build burns its number.
Immutable private Git promotion, sparse Homebrew download/staging/signature/source verification
and explicit anonymous denial precede any tap recipe change. Completion fetches/reads the real
homebrew-tap main and records the exact recipe/artifact commit; stale earlier source runs do not
roll back a newer confirmed delivery. Only Callkeep's cask is modified. Notes use the last
published source, not an interrupted reservation, and normalize nested-product Git paths.

Eight producer state/provenance/escape tests and four scoped-note tests pass; eight real Git
artifact tests remain green. New workflows pass actionlint and code passes pinned Python/shell/
Ruby syntax checks. This is local integration, not a signed CI/private install acceptance claim.
Before enabling: drain legacy Callkeep writer, seed all relevant source aliases and the verified
latest counter, transfer scoped signing/tap credentials, perform real notarized/private download/
install/upgrade canaries, and pass the independent complete batch review. Intel slices are checked;
Intel runtime acceptance remains separate from universal packaging.

### Callkeep producer review fixes

Astra's two confirmed findings are fixed locally. Homebrew transport validation accepts only
its expected checkout metadata, verifies the exact immutable receipt digest/identity and every
app byte/mode/symlink, then verifies the app signature and source identity. Generic artifact roots
remain strict. A durable monotonic promotion fence is saved before changing the tap; a successful
tap push followed by a lost delivery-pointer write can no longer permit an older source rollback.
A newer sealed source stranded below that fence gets a fresh higher reservation with an explicit
replacement reason; the old signed bytes and records remain unchanged. Eleven producer tests
and eight shared artifact tests pass. Astra independently cleared the fix batch at `b1ad43a4b`, including an actual Homebrew
staging/fingerprint probe. Live delivery remains unproved.

Upstream freshness: WWW main now includes Linux runner CI PR958 at `4af50b39b`; homelab main
includes permanent runner validation PR35 at `574330c`. Import/handover still requires preserving
active CLI/source work and confirming current live ownership before any writer changes.

## Homelab source import and toolchain preparation — approximately 38% overall

Homelab main `574330ce97b88c1045509f1b8ad85e5e85207d32` and CLI main
`6ad2c833c607a065d6f56e6a51755529447dbf54` are imported without squashing into
`homelab` and `homelab/cli`. Active dirty source work and the local CLI credential commit
remain untouched; merge their accepted final deltas before handover. No host source/ref/key
has switched. Root compatibility files and local filtered Nix package dependencies are next.

WWW runner PR958 is merged locally, preserving selective Control Center checks and architecture-
specific Rust caches. Its baseline/mixed-load workflows now use relocated product paths. All
15 Control Center CI tests, workflow lint and the ARM-aware linter installer checks pass.

Folding's composite action now installs its exact Ruby/Bundler instead of assuming the VM's
system Ruby matches. It uses the pinned upstream ruby/setup-ruby action; its documented self-
hosted toolcache/dependency requirements must pass the new image canary:
https://github.com/ruby/setup-ruby#using-self-hosted-runners . Apple preparation can explicitly
create a missing Duo device only after its exact pinned runtime/build is available; it never
substitutes a runtime or mutates existing devices. Three portable device-policy tests pass,
and the actual local Xcode/SDK/Swift/XcodeGen/device check passes. New image boot/runtime/Ruby
and capture verification remains pending; this is preparation, not a live runner upgrade.

### Homelab compatibility and verification — approximately 40% overall

Root flake/lock, manifest, installer pin and host ciphertext are canonical regular files.
The thin root flake delegates to `homelab/flake-outputs.nix`; ordered host-specific SOPS rules
precede the existing generic product rule. Ciphertext bytes and recipient sets are preserved.
Private host operations now depend on the colocated CLI by path; its lock changes only the
local package identity. Both Nix packages use explicit source sets instead of fetching the
old public CLI repo or incorporating app source/assets.

The new always-reporting `Homelab CI` gate selects Linux operations/controller checks and
nonactivating Darwin configuration builds for host changes. CLI changes additionally run its
native checks/schema/portable release build, preserving executable/symlink modes inside a tar
artifact. No host promotion or CLI publication is enabled by this workflow.

Evidence: 127 operations tests, 16 host tests (one separate container restore test remains
explicitly ignored), 162 CLI library tests (one existing test ignored), host fmt/clippy and
workflow lint pass. On the MacBook, isolated candidate `nix flake check --no-build` evaluates
all configurations/packages/check derivations successfully. Actual Nix source paths for both
CLI and host tools remain identical after adding an unrelated synthetic app input. These are
evaluation/input-isolation proofs, not successful Nix package builds or live activation.
Temporary source/logs are outside Git at `/tmp/monorepo-nix-validation-20261108` and
`/tmp/monorepo-nix-validation.log` on the MacBook; no deployment ref/Serve/state changed.
Full Nix builds, explicit deploy-ref/repository rebind, new private CLI distribution and active
source repair integration remain outstanding. The complete local batch is awaiting Astra review.

### Public site boundary and compatibility fixes

The previous shared site builder recursively copied Folding's build/source/docs into public
Pages output and the workflow targeted the new source repository rather than the installed
legacy endpoint. The replacement explicitly registers public static roots in `sites/.pages`,
rejects unexpected private inputs/symlinks, and builds Folding assets independently. New-app
scaffolding registers its static pages and preserves the actual `/apps/<app>/` URL prefix.

Legacy publication uses a separate old-apps `gh-pages` checkout with a narrowly scoped SSH
key, generated assets only, no source history/worktree deletion/forced push, tested-artifact
comparison, retained-page policy and source-ancestry rollback prevention. Automatic publication
is disabled pending credential handover/draining the old writer and live Pages acceptance.
The old apps repository may remain a static publication host while installed privacy/support
links depend on it; it cannot simply be deleted or archived while updates still require writes.

Real local Git publication fixtures cover retention, fresh-build priority, no-op, private-source
exclusion, prepared-artifact mismatch, private-file rejection and late older-source preservation.
All13 shared selection/input tests pass using the pinned Python environment, workflow lint and
shell checks pass, and actual Tendr static output plus both Folding site builds succeed locally.
Folding site automatic promotion is still outstanding; no public endpoint was changed.

The imported homelab batch passed independent Astra review; its report is outside Git at
`/tmp/monorepo-homelab-import-astra-review.md`. The correct-key SOPS
integrity verification now passes for both imported host ciphertexts using the existing protected
operator recovery store. No key values or decrypted contents were displayed. The original root hook always used the WWW key and mislabeled the
new host recipients as corrupt. It now accepts session-supplied identities, keeps the blocking
decryption/MAC check and private temporary diagnostics, and emits a sanitized ownership-aware
error. Primary 1Password authorization timed out, so the existing approved local recovery file was passed
directly to SOPS instead; no new authentication or persisted secret was needed.


The site batch also passed final independent Astra review after fixing source-authority advance
for identical newer output and refusing an unconfirmed ahead checkout after a failed push. The
full report is outside Git at `/tmp/monorepo-sites-astra-review.md`. Public endpoints remain unchanged.


## Homelab CI routing and lifecycle documentation — approximately 42% overall

All active root workflow jobs now request explicit disposable homelab Linux or Mac profiles;
the imported routing audit and actionlint pass. Standard Ruby jobs provision the upstream
writable Linux toolcache/runtime libraries, and source/wait/resume jobs install their GitHub
client. The image publisher extracts only its scoped encrypted field directly into Docker
stdin using the source-root vault path; no decrypted vault content is logged. A synthetic
client handoff test passes. Live guest/tool/network canaries remain pending.

The standard iOS aggregate gate checks selected job success and required unselected skips.
Shared tooling no longer runs on every unrelated app change. Forced selection verifies all
standard products without enabling publication, while shared/unknown paths conservatively
verify. Real Git impact/source fixtures, fifteen shared tests, fifteen Control Center CI tests,
release-lane/state tests and workflow-route checks pass. Astra independently cleared this
batch after the storefront-resume GitHub client dependency was fixed. The additional activation
flags are awaiting final fix recheck: `STANDARD_IOS_DELIVERY_ENABLED` and
`PANEL_DELIVERY_ENABLED` hold new automatic writers until old writers/credentials/canaries hand over.

Root development/contributing, release and new-app guides now describe the actual independent
product layout and supported commands, product-specific Fastlane handlers, test/tool choices,
explicit channel ownership, optional backend, low-touch onboarding and actual acceptance.
Unimplemented wrapper/backend-preset/rebind/distribution capabilities are labeled pending.
Historical docs remain historical, with their stale layout/runner claims explicitly superseded.
No new framework or shared UI package was introduced.
