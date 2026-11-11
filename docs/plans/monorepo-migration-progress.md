# Monorepo migration progress

## Complete — November 10, 2026

Repository consolidation and source retirement are complete. Apps, homelab configuration/CLI,
Cloudflare infrastructure, sites and active delivery tooling belong to WWW. WWW is public.
Both Macs follow WWW; Callkeep/CLI Homebrew recipes download WWW releases.

November 10: Air Miles is retired at the owner's request. This change removes its application,
fixtures, import tools and active CI unit.
The records below describe the historical migration, not an active product. The separate
personal-flight dataset and other repositories are outside this removal.

The five original repositories (`apps`, `folding`, `callkeep`, `homelab`, `homelab-cli`) were
snapshotted into private `github-archive`, verified remotely, then deleted at the owner’s request.
Old local checkouts and archive snapshots are historical, never development/publication roots.
The old Folding repository had no GitHub releases; legacy artifact readers now target WWW.
Signing storage, dotfiles, homebrew-tap and agreed excluded projects remain separate.

The [completion record](monorepo-remaining-work-2026-11-09.md) records archive locations and
separate follow-ups. Tendr’s replacement website is live at `https://tendr.worldwidewebb.co/`
through [#1015](https://github.com/0x63616c/world-wide-webb/pull/1015). The
[#1007](https://github.com/0x63616c/world-wide-webb/issues/1007) receipt below records its
processed beta and updated App Store draft URLs; public Store promotion remains outstanding.
Old installed GitHub Pages links still require an app update.

Cloudflare/sites handover was merged in #972; Folding delivery preparation in #974; Control
Center’s Xcode 27.2 native/promotion handover in #984. Subsequent app fixes and individual beta
processing are product work, not source-migration gates. No new release, screenshot or restore
campaign is required to close consolidation.

## Historical execution record

The entries below are historical evidence, not current instructions or live status. References
to private visibility, pending homelab handover, old percentages, mandatory Astra reviews or
additional acceptance gates have been superseded.

## Dependencies and preservation

Homelab main is now `ad34038b10f432530ade78f844a88fa49bcd0c9a`, including the final Linux
main-CI evidence and Xcode27.2 image pin; its non-squashed history is imported. Actual MacBook
readback confirms that installed revision/image, matching boot/current generation and no hold.
Four total/two Mac slots, admission and Linux isolation remain unchanged. Exact Xcode/Swift/Duo
runtime canary passes; complete app builds/captures and the full mixed workload remain in CI.
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
ruleset API returns the explicit GitHub Pro upgrade requirement. This historical account prerequisite was removed by the owner’s later decision; no billing or visibility change has been made. Existing apps Pages
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
batch after the storefront-resume GitHub client dependency was fixed. The activation guards and
scheduled-resume bypass fix also passed its final recheck: `STANDARD_IOS_DELIVERY_ENABLED` and
`PANEL_DELIVERY_ENABLED` hold new automatic writers until old writers/credentials/canaries hand over.

Root development/contributing, release and new-app guides now describe the actual independent
product layout and supported commands, product-specific Fastlane handlers, test/tool choices,
explicit channel ownership, optional backend, low-touch onboarding and actual acceptance.
Unimplemented wrapper/backend-preset/rebind/distribution capabilities are labeled pending.
Historical docs remain historical, with their stale layout/runner claims explicitly superseded.
No new framework or shared UI package was introduced.


## Preserved CLI recovery snapshot — approximately 44% overall

Latest remote heads for Folding/apps/Callkeep/CLI remain unchanged at the previously recorded
SHAs. The CLI's committed local `95eb53b298d97c6caed01aeba43eeaab45897252` was merged with
its history, then a stable byte-identical snapshot of its existing dirty recovery/diagnostic
work was copied into the candidate. Original checkout, keys, profiles and uncommitted files
remain untouched. Snapshot evidence is outside Git at `/tmp/monorepo-cli-source-snapshot-20261108`;
refresh/compare it again before final source handover rather than assuming this freezes the owner.

Independent Astra and security reviews found and cleared two issues before integration: untrusted
SSH/Git/provider error bodies could survive a blacklist redactor, and selecting a new SSH agent
identity invalidated the already verified authentication scope. Diagnostics now retain fixed
failure classes plus typed HTTP/I/O metadata only; unknown banners, payloads and truncated key
bodies are omitted. Scope refresh proves a fresh selected-key connection to the original pinned
peer and rejects every other target/peer change. A single write-failure notice and valid log path
make diagnostic failures discoverable. Informational screens preserve one Back action.

All non-opt-in CLI suites pass: 411 tests across27 harness summaries, three explicit ignored tests,
plus separately opt-in VM/authentication harnesses left unrun where their private fixture is
required. fmt/clippy pass. The existing terminal regression passes after preserving its read-only
footer; no assertion was weakened. Reports/logs are outside Git at
`/tmp/monorepo-cli-recovery-astra-review.md`, `/tmp/monorepo-cli-recovery-security-review.md` and
`/tmp/monorepo-cli-recovery-all-tests.log`. Live credentials, enrollment and recovery remain unproved.

A further selector boundary now assigns the product/home vault to credential verification only:
it verifies Control Center and Cloudflare without activating a host or shipping an app. Host SOPS
ciphertext remains a host input; a global encryption-rule edit alone does not activate hosts.
Sixteen shared selector/gate/input tests pass. This is local policy proof, not live CI acceptance.

### Folding preview runtime attempt

Actual local preview execution at `14af3485a` generated the project and booted its temporary Duo,
then correctly refused the already-running shared DeviceHub session. It removed its temporary
simulator (remaining Folding capture devices: zero). The existing desktop session was preserved.
No screenshot manifest or preview success is claimed. Log: `/tmp/monorepo-folding-preview-14af3485a.log`.
The required capture canary remains on an isolated Mac guest with the new pinned image.


## Explicit host deployment policy — approximately 45% overall

Schema3 now names the matching source repository and `deploy/homelab` branch.
Authoring main discovers that policy; the CLI resolves an immutable deployment commit and
rejects missing/stale/retargeted policy rather than installing main. Versions1/2 and old installed
metadata retain their historical main behavior. Explicit recovery-vault handling accepts schema3;
proposal receipts/rebase checks preserve deployment identity. Nix generates metadata and Comin
configuration from the same root policy. Comin completion requires all three observed branch
fields to match, alongside the existing source/system/fetch evidence.

The obsolete public CLI release checker is removed. Homebrew will own upgrades; historical cache,
profiles and approved receipts are preserved. Private CLI publication, repository rebind, ordered
promotion and bounded enrollment coordination are still required before live activation.

Evidence: 239 targeted CLI checks pass (one separately ignored); all-target clippy/fmt, schema
drift, offline current/historical validation and workflow lint pass. Actual isolated MacBook Nix
evaluation selects WWW and `deploy/homelab`, with matching Mini metadata. Its Git-free test copy
has no revision, so this is configuration evaluation, not built-source or activation evidence.
Astra independently cleared this complete local batch, including compiled fake-GitHub fetch cases;
report `/tmp/monorepo-deployment-policy-astra-review.md`. No host source, keys or update ref changed.


## Local app entrypoint and account decision

`scripts/dev` now lists apps, creates an independent app, dispatches product checks, resolves
committed affected apps (verification by default) and checks tool/PyYAML availability. Standard
iOS checks require an explicit core-test declaration and run an unsigned simulator build;
custom products keep their own handlers. Missing/invalid manifests and failed tests/generation
stop before build. It adds no publication or host-activation command.

A real throwaway MigrationProbe scaffold builds successfully through this entrypoint. ShellCheck,
real-Git affected verify/ship selection, all16 shared selector/gate/input tests and independent
failure-sequencing probes pass. Astra cleared both findings; report
`/tmp/monorepo-dev-entrypoint-astra-review.md`. Build log `/tmp/monorepo-dev-scaffold-build.log`.
Cloudflare backend preset and account onboarding automation remain outstanding.

The owner explicitly declined GitHub branch protections/Pro. This removes that account prerequisite;
CI checks, review, stale-source/CAS ordering and private-history protection remain required in normal
automation. GitHub itself will not reject bypassing direct pushes. Repository is still public and
no migration history has been published. Current stage remains local delivery/host handover.


## Durable host promotion preparation — approximately 47% overall

The local Homelab delivery workflow verifies exact successful named CI/run/attempt/source evidence,
committed host input identity and schema3 destination authority. App-only completions skip promotion;
manual reconciliation requires explicit checked source. An atomic Git transaction advances the direct
source deployment ref and append-only control journal with expected-old identities and readback.
Late older candidates cannot rewind a deployment or bypass a newer pending candidate. Ambiguous
successful pushes reconcile exact remote state; mismatches fail closed.

The journal includes a bounded, resumable enrollment lease primitive. New checked source coalesces
while activation is held; no runner waits for enrollment. Prepared expiry allows forward movement
before activation, while expired activation requires explicit recovery. CLI wiring, host observation
before releasing holds, repository rebind and actual GitHub/provider/host acceptance remain outstanding.
`HOMELAB_DELIVERY_ENABLED` stays unset/off. No refs were published and no host ownership changed.

Independent review found and fixed pending-workflow replacement, uncaptured Git diagnostics and
acceptance of historical sources without the new authority contract. Git CAS now serializes writers
without a replaceable workflow concurrency slot; raw Git failures are captured/sanitized. The
[handover runbook](../runbooks/monorepo-homelab-handover.md) records protocol and remaining live gates.


This promotion batch passed final independent Astra review with all three findings resolved;
report `/tmp/monorepo-promotion-astra-review.md`. Nine real-bare-Git transaction tests and eight
current evidence/selection/privacy tests pass, alongside the16 shared selector/gate/hash tests,
Ruff, workflow lint and runner-route audit. Exact-attempt API metadata shape was independently
read from an existing WWW run without a provider write. Local Git atomic support does not prove
GitHub acceptance; the runbook retains that explicit canary before activation.


## Owner execution correction: usable repo first

The owner clarified that this should primarily be copying/consolidating the projects, adapting
paths and tidying, rather than putting a new homelab enrollment design on the critical path.
Prioritize the usable private app-development repository, existing product builds/releases and
selective homelab runners. Preserve current live host authority until its separate handover works.
Full migration/recovery/documentation/retirement scope stays open; those follow-ups do not block
ordinary app development in the consolidated repo. Review each complete usable candidate before
publication, keep automatic writers off until their own handover is proven, and do not claim live
release delivery from imported code.

Unfinished Rust enrollment-coordination changes were preserved separately, not published, in
stash `Park unfinished enrollment coordination for follow-up; usable repo migration first` and
local branch `codex/homelab-lease-followup-20261108-173501`. The stash's third parent contains the
new untracked `deployment_lease.rs`; retain the complete stash/branch graph when resuming it.
Its four independent integration findings and partial fixes are recorded outside Git at
`/tmp/monorepo-cli-lease-astra-review.md`. This snapshot is unfinished and not cleared for delivery.
The main migration candidate is back to the last committed implementation; no original checkout,
profile, key, live host source or service was changed by parking it.

Next milestone: refresh app sources, inspect the complete usable app/CI/release candidate,
resolve concrete cutover failures, make WWW private before any private-history push, publish
reviewed source, pass checks and verify the app workflows. Defer new enrollment features and
old-repo retirement from that usability milestone, while retaining them in the full active goal.


## Integrated usable-candidate review and source refresh

Astra completed one integrated review through `93a827db1`, accepting source preservation/layout
subject to writer holds and real private CI. Report `/tmp/monorepo-usable-candidate-final-astra-review.md`.
Primary added an initially-off Control Center image-publication flag to login/push/receipt only;
Docker build/runtime checks stay active. Current summaries now follow the owner’s usable-first
instruction. The existing Cloudflare apply flag was found enabled and must be held before merge.

Latest upstream main refs for Folding/apps/Callkeep/CLI remain unchanged; homelab advanced to
`4fd1937` and is imported without squashing. Original active feature branches are older forks:
their whole trees are not replacements for newer main. Stable protected local snapshots preserve
their current dirty changes/untracked files at `/tmp/monorepo-active-source-20261108-imphnfa3`;
Folding has527 untracked source/skill/design files, apps2, homelab6. Original files remain untouched.
The CLI original patch hash still exactly matches the source snapshot already imported. Refresh
again at working-branch handover; this preservation snapshot does not freeze ongoing development.

Read-only GitHub checks confirm WWW has no Pages site, remains public at this observation, and
only its AGE_PRIVATE_KEY secret is configured. Private-history publication must follow verified
private visibility. All new channel flags are absent/off; MINI_DEPLOY_ENABLED is false. Account
upgrade/branch-protection support is not a prerequisite by the owner's explicit decision.

## Private publication and first real CI — approximately 49% overall

WWW visibility was changed to private and independently read back before publishing imported
history. Reviewed source `c13c3e243` is published in PR #959. The HTTPS OAuth identity lacked
workflow-update scope; the existing SSH GitHub identity successfully published the same source.
No account upgrade, new login or branch-protection requirement was introduced.

The pre-push Rust/operations checks passed. Actual Linux executions completed the Callkeep and
Icon/launch-screen selectors successfully. The first Mac Duo job checked out the private source
successfully, then correctly failed because the installed image contains Xcode26.4.1/iOS26.4
and no Duo device type. This is real image compatibility evidence, not an app screenshot pass.
The controller acknowledged an explicit drain as idle. Its hold remains active while the pinned
Xcode27.2 candidate downloads with automatic cache pruning disabled; the previous image remains
available. Toolchain/runtime, native builds, capture and mixed-pool acceptance are still pending.

Existing account material was transferred directly from the primary credential session into
WWW Actions secrets. A read-only Apple API request returned HTTP200. Live inventory confirms
Tendr's Owner Preview, Folding's Folding Internal and Control Center's me internal groups;
Folding staging has no build/group yet. The production Folding group variable is configured.
Callkeep's existing Developer ID certificate matches the profile's pinned fingerprint and expires
November26,2027; its installed profile passes the production iCloud authorization validator.
A dedicated write key scoped to homebrew-tap is installed for WWW and backed up in 1Password.

The existing encrypted Folding Match identity was fetched without changing its source repository.
Its private key and certificate match, use the preserved Apple team, and expire November7,2027.
The same identity was repackaged with a protected export password for standard iOS delivery;
recovery is stored in 1Password. No Apple certificate was created or revoked. Standard Apple,
Callkeep and Folding Match/contact inputs are prepared, but no signed archive, notarization,
Apple upload, tap update or production release is claimed by credential preparation. Folding
runtime/deploy/signing Git access and immutable legacy-ledger transfer remain channel work.

### Image canary and workflow bundle compatibility

The immutable Xcode27.2 candidate is cached under the existing runner identity with the old
Mac and Linux caches retained. An isolated guest under the existing Softnet policy verified
Xcode27.2/27B52, Swift6.4.2, the available Duo runtime27.2/24B91016s and Duo device type.
The owned guest was stopped/deleted. Fresh inventory/process/cache checks confirmed its absence
and the retained candidate; free storage was243266625536 bytes against the unchanged
150323855360-byte admission reserve. The exact-token temporary hold was released through the
supported controller command before existing Comin activation can take its own hold.

The image has `/Applications/Xcode_27.2.app`, with no `Xcode.app` alias. Eighteen root workflows
now use that installed bundle, including the Duo requested default. The33 existing Duo-tool
tests, actionlint and route audit pass. The narrowly scoped image-pin/CI compatibility review
accepted this operation; it does not reopen the accepted layout/release design. Old-authority
homelab commit6a9424e is a two-line pin/comment change, builds the host closure and preserves
all other generated runner settings. Installed revision/image, new-source private CI and
actual application capture remain unverified at this point.

### First real native build and CI corrections

Homelab PR37 merged as ad34038b10f432530ade78f844a88fa49bcd0c9a and normal Comin installed it.
The current system and boot profile agree; the controller uses the validated immutable image
and has no leftover canary hold. WWW86b92b5d0 includes this exact non-squashed source and the
reviewed Xcode bundle-path fixes. Tendr's actual private CI simulator build and icon validation
passed on that image. Duo, component and launch-screen capture then exposed legacy explicit
27.0/27.1 runtime names. These scripts/workflow checks now match installed27.2: the regular
runtime for normal phones and the separate iPhone19-4 runtime for Duo. All33 existing Duo-tool
checks pass, including task-owned simulator cleanup; shellcheck and actionlint pass.

Superseded runs also exposed `always()` aggregate jobs that survived ordinary cancellation and
blocked replacement workflow concurrency. Only those obsolete heads were force-cancelled via
GitHub's supported endpoint. Aggregate jobs now run for failures but skip cancelled workflows;
the selected-job policy still rejects failures/cancellations/unexpected skips. The16 shared
selection/input/gate checks pass. Icon/tip workflows now cancel obsolete PR verification too.
Credentials/cleanup steps retain their cancellation behavior; no active-source check is bypassed.

After the new image activation and real native build passed, the exact stopped old OCI cache
was removed after checking the installed image, generation agreement, absence of old-image
attempts and retained new cache. No guest or Nix generation was removed. Subsequent inspection found that Tart's global GC
also removed the manually imported Linux digest cache; the correction below records its recovery. Recovery
retains the old immutable image reference and previous generation, requiring a cache pull if
selected again. Physical free space increased from241823813632 to242856464384 bytes; shared
image storage meant this reclaimed only about1GB. Capacity/reserve settings were not relaxed.

### Desktop-session bridge and encrypted signing copies

The corrected-runtime Duo job reached the native host UI test, then failed to connect to
`com.apple.testmanagerd.control`. An isolated minimal macOS UI test reproduced that same
failure when supervised in the runner's System bootstrap session. The identical compiled test
passed in the existing Aqua session. Testing the actual desktop helper from a System daemon
also passed, retaining UID501, a public environment sentinel and an argument containing spaces.
This is a real process-context comparison, not a mocked UI-test success. The exact diagnostic
VMs were stopped/deleted; their owned hold is released only after fresh token/inventory checks.

`scripts/ci/apple-desktop.sh` passes through an existing desktop command, or enters the same
user's existing desktop before dropping back to that user and executing the command. It retains
step environment, explicit tool PATH, literal arguments and working directory. Capture/Apple
XCTest entrypoints use it; controller services, host identity, capacity and isolation are unchanged.
Shellcheck, actionlint,16 shared selector/gate checks,15 Control Center CI checks,6 release-policy
tests/35 assertions and the local argument/environment probe pass. Full product CI/capture still
must pass before this source milestone is merged. No further per-fix review cycle is added.

Both encrypted signing histories are now copied to private WWW with exact remote readback:
`signing/folding` =85dcb487173509652d7ee9c9521df4a1e4b76716 (2commits/6unique encrypted blobs),
`signing/certificates` =404dc2c649a48d69b25377c0145b8ff26b9f9920 (7commits/11encrypted blobs).
All certificate/key/profile blobs across those histories have Match encrypted envelopes. No
plaintext credential was committed, source store overwritten, certificate revoked or release
channel enabled. Readonly signed archives and consumer-reference handover remain acceptance work.
Existing Control Center health still reports ok at build72f9533c84cc9362b9a3df9a5fe3f079411c638d,
with no consecutive/storage worker failures; this does not replace the later data/restore audit.


### Linux cache recovery and retention

Deleting the unrelated old Mac cache invoked Tart's global OCI garbage collector, which also
removed the untagged imported Linux cache. `TART_NO_AUTO_PRUNE` does not suppress this explicit
GC. The importer now creates Tart's trusted `.explicitly-pulled` marker after manifest/chunk
verification and before atomic installation. The archive allowlist is unchanged.

All five cache tests passed on the actual runner host, including a regression that calls real
`tart delete` against an isolated cache and proves the imported digest survives. Independent
Astra final review found no actionable issues. The saved Linux image was restored successfully
under `_runner`; its pinned manifest, 24GB disk and every authenticated chunk passed validation
(disk SHA256 `734c48bbb378617ea91c8f5c6596004591b5e67bc6cea9a9f02f9db086cef165`).
The first restoration attempts failed before import because shell input redirection conflicted
with sudo authentication; separating the password input from the root-opened archive fixed it.
No product data was affected. Old-authority importer backport was independently reviewed and merged as homelab PR38;
installed revision readback still showed the previous revision at the next observation.
This successful restore used the reviewed patched importer without changing host authority.

The existing Duo job reached its native orientation-control loop on the real runner. This is
progress beyond the earlier missing-testmanagerd failure, but complete screenshots and all
selected app checks are still unverified. Overall migration remains approximately 50%.


### Consolidated Folding signing consumer

The delivery workflow now configures Match against private WWW's preserved `signing/folding`
branch, directly cloned using its short-lived same-repository GitHub token. Its derived Basic
header is masked before export to later steps. No additional signing SSH key is introduced;
local SSH overrides still work and empty private-key values are omitted. Fastlane2.241.2's
actual implementation supports these branch/authentication environment variables. The12 existing
release regression tests pass (70 assertions), actionlint passes, and independent Astra final
review found no actionable issues. This is source wiring only: the delivery flag stays off and
a real readonly signed archive remains required before retiring the old signing store.


### Real Duo acceptance and measured capture overhead

Private CI run42553684855, source0c8ef9643, completed successfully. The Duo job built,
exercised all six interaction cases in both appearances, validated the inner/outer PNGs and
uploaded artifact13648170108 (`duo-screenshots-tendr`, 8362480bytes). Tendr, Air Miles,
RDesign and the new-app template also passed their real native CI jobs at this source.
Remaining selected workflows are still pending; this is not complete PR acceptance.

The screenshot job was too slow. Its logs show677.778s and682.244s for the repeated full
six-test suites; `testMainScreens` accounted for214.435s and219.755s respectively. Roughly
15minutes were repeated non-capture interaction work. Cold device probing/boot took112s,
the native helper build113s and controller startup39s; other build/start overhead remains.
These are observations from one cold run, not a controlled benchmark.

The completed correction retains the full interaction suite in the first appearance and uses
Tendr's explicit capture-only selector for later appearances. Both sets of required images stay
mandatory. Other apps without that selector keep their existing suite. The native helper no
longer reselects an acknowledged pose before every orientation; explicit pose changes still
execute, fresh helper processes start unknown and errors invalidate remembered state.
The real serve-path regression fails against the previous implementation and passes the fix;
33 existing capture/protocol tests plus the new protocol regression pass, as does ShellCheck.
Independent Astra final review found no actionable issues. Actual runtime improvement still
requires the updated real job; no faster duration is claimed yet.

The host backport merge temporarily drained new admissions while the existing Duo job ran.
That serialized otherwise available capacity. Avoid further host updates during the app CI batch;
observe installed revision and updater-owned hold release rather than releasing its hold manually.


### Fresh-checkout preview generation fix

PR screenshot run42557074547 exposed a missing generated Air Miles project. Native app CI
already generated it, but the shared phone capture entrypoint went directly to simulator boot
and xcodebuild. That entrypoint now generates any app's declared `project.yml` first, following
the existing component-capture behavior. Its actual-shell regression verifies generation before
boot in the app directory and preserves the source release metadata. The targeted test and
ShellCheck pass; independent Astra final review found no actionable issues.

Keep this small baseline fix separate from the reviewed local CLI release batch3b7678922, which
remains preserved on local `codex/monorepo-consolidation`. The baseline fix branch is
`codex/migration-capture-generation`, based on published110fc2f2c; it will update PR959 without
adding CLI delivery scope. No red PR is merged. After main establishes the consolidated baseline,
ordinary diffs can select only their affected products instead of the entire import.

Current MacBook admission also explains lower-than-configured concurrency: two active Mac guests
reserve60GiB growth each. With216.8GiB physical free and80GiB emergency reserve, an additional
24GiB-growth Linux guest needs224GiB. The configured four slots are a ceiling, not guaranteed
mixed-workload throughput. The updater-owned hold is now absent, and the checked cache-fix
revision3b442219 is installed. Preserve these bounds while avoiding repeated full-import CI.


### Updated Duo run measured

Run42557074449/job128965093779 on110fc2f2c passed its capture, staging and upload checks.
Capture step03:35:46–03:56:57UTC took21m11s versus the previous28m41s, a7m30s reduction
(about26%). Both required screenshot sets remain validated. This is a one-run observation under
a changing mixed workload, not a controlled performance guarantee; the pipeline remains too slow
for a general fast feedback loop. Further timing/trigger improvements remain follow-up work.

The only safe large temporary cleanup found on the host was our verified Linux transfer archive.
Its SHA256 matched the retained original backup before unlinking. That recovered about2GiB;
last physical free was220GiB. Both active Mac guests and both required image caches remain.
No obsolete VM, large disposable user cache or Time Machine snapshot was found. No disk budget,
rollback generation or active image was removed to increase concurrency.


### Batched first-run CI corrections

The generated Air Miles project now builds/launches in run42559317345. Its two journal cases
failed only the five-second Cancel readiness assertion: recorded activities show FileProvider
became available about ten seconds after Choose CSV, then cancellation and all later captures
continued successfully. The shared case now waits at most15s without fixed sleep or removed
assertions. The complete dark journal/search/import case passed on a fresh local iPhone18 Pro Max,
iOS27.2/Xcode27.2 (51.6s test execution; receipt outside Git). Full light/dark CI remains required.

Folding preview42559317422 stopped during frozen Bundler setup because Gemfile.lock contained
empty CHECKSUMS entries. Bundler4.0.23 populated all103 SHA256 entries from its existing resolution;
gem versions, platform list, Ruby and Bundler pins are byte-identical outside CHECKSUMS. A clean
isolated frozen install of all103 gems and a frozen dependency check pass. No pin was upgraded.

Tendr tooling job128980564240 then exposed the minimal Linux guest's missing UTF-8 locale:
localized metadata raised invalid-byte-sequence US-ASCII errors. The common Linux Ruby bootstrap
now sets LANG/LC_ALL=C.UTF-8 before Ruby setup and subsequent steps. The real release harness fails
under C and passes under UTF-8; all seven root release-lane check commands pass locally. A static
scan also found no missing literal action version/dependency input paths after relocation.

Independent Astra final review accepted this three-file correction batch. These are local/source
proofs, not a claim that the pending replacement CI is green. Production writers remain disabled;
the reviewed private CLI and operations follow-ups remain separate from the baseline PR.

### Control Center image readiness correction

The first consolidated image build succeeded, but the initial health request failed in
under one second with a connection reset before the listener was ready. The isolated
image check now retries that transport failure only inside its existing 30-second
readiness deadline. Revision/worker assertions and all post-readiness requests retain
immediate failure behavior; application mutations are not retried. A reproduction through
the real checker entry point failed before the change and passed after it. Four regression
tests cover recovery, deadline, revision mismatch and post-readiness failure; the Control
Center operations checks pass (70 tools and 37 deployment tests). Independent final review
found no actionable issues. Replacement real-image CI remains required before acceptance.

### Folding fresh-guest project generator

The replacement preview job completed the frozen install of all103 gems, confirming the
checksum correction. It then exposed a missing XcodeGen executable in the disposable guest.
The shared Folding Apple setup now installs XcodeGen before its existing strict product-pin,
Xcode/Swift/SDK/runtime checks; it does not accept a different generator version. The same
setup serves native, domain and preview jobs. Local real Apple environment validation and
its three existing regression tests pass, as do workflow lint/diff checks. Replacement
fresh-guest CI remains required; no preview output or native delivery is claimed.

### Folding screenshot target source membership

Preview job128994117370/run42565972684 passed tool setup and reached compilation. It found
three missing types used by existing screenshot views: AvatarImagePreparation,
ProfileAccountActions and InlineProfileIdentity. Their existing ProfileIdentityEditor.swift
file was included by the production target's App glob but omitted from the screenshot target's
explicit source list. The screenshot target now includes that file; no view implementation,
fixture behavior or product identity changed.

A real local unsigned FoldingScreenshots simulator build passes. The storefront target also
compiled, and its outer-render and tip-review cases passed on a fresh task-owned Duo simulator.
The attempted full render suite was not green: its inner-render case correctly rejected the
still-outer native geometry (466x678 versus951x669 points). That invocation did not control
native poses and is not inner-display acceptance; the task simulator was cleaned up. Controlled
CI preview/full captures remain the acceptance route. Source-only tests were not substituted
for actual compilation or rendering evidence.

### Pinned runner-tool download mirror

The Homelab Darwin configuration job128997796951 failed fetching Tart, with HTTP504 after
its normal retries. Direct operator downloads reproduced504 for both pinned Tart and Softnet
browser URLs. The upstream release APIs still identified the same release assets; unauthenticated
API asset downloads succeeded and matched both existing SHA256 pins exactly. Runner tools now
try those exact API assets with the octet-stream header, retaining the original browser URLs as
fallbacks and explicit archive filenames. Versions, archive contents, checksums and signed app
handling remain unchanged. Native Nix parsing/evaluation against the pinned nixpkgs revision
passes and confirms unchanged fixed-output source and final package paths for both tools.
This is a download-route correction,
not a host update or a successful replacement full configuration check; actual CI remains required.

### Change-selection checkout overhead

Homelab selection job129001398418 spent05:53:47–05:58:25UTC in full worktree checkout
and was cancelled at its five-minute job limit before the selector ran. The initial history
fetch had completed in about19s. Change-selection jobs do not need to materialize product
binaries/assets: six shared-unit selectors now check out only their action and scripts/ci;
the Control Center adapter additionally includes its tools directory. Full commit history
and path selection remain; build/test jobs retain their ordinary product checkouts. Explicit
filter inputs were removed because checkout documents that they override sparse-checkout.

A real fresh private sparse clone of the published baseline and its real selector completed
in3s in the operator environment, materializing132 files/501503bytes versus the47.2MiB full
tracked tree. Full and sparse selectors returned identical results for all19 verification
units; the real Control Center adapter also ran with absent production sources. This is
not a controlled cross-machine timing guarantee. Regression tests run actual selectors
against every workflow's sparse paths and retain cross-product move/deletion/edit results.
All17 CI tests, actionlint and diff checks pass. Runner-side replacement CI remains required.

Tendr tooling job129005094657 then reached a test-fixture failure: the scoped GHCR handoff
test replaced its child's entire environment and dropped setup-python's LD_LIBRARY_PATH.
The Linux shared Python interpreter consequently exited127 before the synthetic executables
could run. The fixture now retains only that required loader setting in addition to its
explicit PATH/workspace; no credential environment is inherited. A simulated loader requirement
reproduces127 with the old environment, then passes through the full synthetic SOPS-to-Docker
handoff after the correction. Both handoff tests pass; production login code is unchanged.
All remaining local tooling checks also pass: impact/source resolution,34 Duo regressions,
release/retirement/site checks, eight prebuilt-distribution tests and ShellCheck.

The current0cd Duo job also completed successfully: capture05:44:28–06:07:09UTC took22m41s.
That confirms the optimized path still works under the mixed runner load; the previous21m11s
was not a guaranteed duration. The sparse-checkout/fixture correction remains the next reviewed
baseline batch; neither this successful capture nor local tests make the currently red PR mergeable.

Control Center infra job129004066455 then exposed a minimal-image bootstrap dependency:
OpenTofu's ZIP installer could not find unzip. Shared archive-tool preparation now ensures
that prerequisite on Linux before OpenTofu and Folding's ZIP-based Bun setup. Existing Mac
tools remain in use. Workflow lint, ShellCheck of the bootstrap and diff checks pass. This
changes guest tool preparation only; no image/host activation, live state operation, version
or verification gate was changed. Actual installer/infra CI remains required.

### Python test-discovery import collision

Current-head Tendr tooling reached its path-filter regressions and failed because Linux loaded
`scripts/ci/select.py` as Python's native `select` module. Subprocess capture then raised
`TypeError: select() takes from2 to3 positional arguments but5 were given`. The original macOS
Python3.15 build's builtin module hid that lookup path; the earlier system-Python failure was
also evidence of this code naming collision, not solely an unsupported local environment.

The helper is renamed to `select_units.py`, with every action, resolver, input hash, product
adapter and fixture caller updated. Its implementation is byte-identical. A fresh-interpreter
regression exercises Linux's path lookup even on Darwin, reproduces the exact error before the
rename and passes after it. All18 shared selection/gate/import tests,15 product CI tests and
legacy real-Git impact fixtures pass after the correction. The same current CI already passed
Folding native and the light/dark Duo capture; its capture step took23m03s. Those successful
jobs are evidence for their current revision, not a green aggregate. Replacement tooling and
remaining real checks still need acceptance. The Folding backend additionally lost its runner
without a final build log; host diagnostics are being examined before deciding the retry.

### Remaining fresh-guest compatibility corrections

The same CI batch exposed three additional preparation/fixture issues. Control Center's30 Rust
checks completed before the dependency-tool browser download returned504. The bootstrap now
resolves exact cargo-deny assets through the upstream release API, retaining browser fallback,
the original SHA256 verification and the required dependency scan. A real cold-cache macOS run
installed the unchanged0.20.2 tool and passed advisories/bans/licenses/sources. The actual Linux
ARM64 archive downloaded via API also matched its upstream checksum
`995c82be0defc7a025cae49a2aa2644ce8245c9a3318fc4103907c6a285e8c7d`.
Three isolated real-bootstrap transport tests cover API success, unavailable-API fallback and
refusal to install/execute corrupt-checksum bytes. All40 Control Center tools tests pass.

Homelab Linux passed112 runner tests; its remaining official-wrapper fixture incorrectly demanded
the macOS cargo path. The fixture now keeps that strict check with the platform's expected prefix,
matching the existing production platform policy. Production runner behavior is unchanged. Its
real wrapper test passes locally and Rust formatting passes; replacement Linux CI is still needed.

Folding's real domain/storage job passed all113 Swift tests, strict Swift formatting and generated
icons, then its release metadata suite failed under an ASCII locale. Shared Folding Ruby setup
now establishes the platform's UTF-8 locale before Ruby/metadata processing. The exact33-test/
656-assertion release suite reproduces the encoding failure underC and passes underUTF-8, without
provider access, skipped assertions or gem/version changes. Workflow lint and ShellCheck pass.

The lost Folding backend VM is separate from these source corrections. GitHub records terminal
runner communication loss; the owned VM was already stopped before controller deletion. Its last
public guest status was executing, and no completed build log is available. Host memory is32GiB
with the unchanged24GiB guest budget. The current runner policy/timeouts are unchanged; no unsafe
budget adjustment or guessed product workaround was made. GitHub rejected a targeted retry while
the parent Folding workflow was still running; retry is pending its terminal state or the next
reviewed exact-source batch. This is not backend runtime acceptance.

### Folding Wasm helper download correction

The targeted fresh-guest backend retry stayed alive, passed its Rust tests and produced a complete
failure log. It stopped when worker-build's internal browser URL for wasm-bindgen0.2.129 returned
504 after five retries. The CLI retry passed its complete job on a fresh guest; the earlier journal
error remains unreproduced, with the local30-test bootstrap suite and20 direct repair repetitions
also passing. No recovery guard or runner resource limit was weakened.

The backend bootstrap now prepares the same upstream WebAssembly helpers through release API
assets, verifying their SHA256 identities and actual executable versions before publishing their
paths. wasm-bindgen follows the one exact Cargo.lock version; wasm-opt132 explicitly matches the
existing worker-build0.8.7 dependency. The pinned tool's supported WASM_BINDGEN_BIN/WASM_OPT_BIN
overrides select those binaries; compilation, optimization and workerd tests remain required.
No tool version is upgraded. Full extraction preserves sidecar libraries, with safe staged archive
extraction and atomic installation. Four isolated tests cover exact tools/cache reuse, checksum
failure before execution, wrong versions and path-escape refusal.

A real native preparation downloaded both exact upstream artifacts through API, then the unchanged
complete `scripts/check-backend` passed Rust tests, release Wasm compilation/optimization and all 30
compiled-Worker runtime tests. Its log confirms worker-build used both prepared overrides. This is
native-host proof; the replacement Linux job remains required. External receipts are
`/tmp/monorepo-worker-tools-native-prepare.log` and
`/tmp/monorepo-folding-worker-overrides-check.log`. The old source's product build checks have now
completed; this collected correction batch is ready for final review and replacement CI.

### Private CLI publication candidate (local follow-up)

The next coherent local batch adds `Homelab CLI delivery`, consuming the exact portable binaries
already built by successful main `Homelab CI`. It checks source/event/branch/repository/attempt,
the named successful CLI job, private visibility, archive checksum and bounded allowed tar entries,
then validates the CLI/helper versions and reuses the existing immutable orphan-artifact publisher.
Real Homebrew fetch/staging, receipt/payload comparison, anonymous denial and monotonic formula
checks precede a tap update. The first private CLI version is0.4.2; public0.4.1 remains preserved.

Distribution tooling selects its Callkeep/CLI consumers for verification without delivering apps;
CLI docs/test-only changes no longer nominate a CLI release. The seventeen selector/input/gate
checks and eleven distribution tests pass, including unsafe tar members, trusted-source rejection,
transport preservation and recipe downgrade/changed-byte rejection. Locked CLI binary compilation,
workflow lint and generated Ruby syntax pass. Independent Astra final review found no blockers.
The existing tap-scoped deploy key is reused, with no additional credential request.

CLI docs now describe private Git/Homebrew upgrades and point local source links at the relocated
fixtures. Historical schema IDs/helper pins and original saved profiles are untouched. Additional
setup/deployment coordination code stays parked; this batch changes no host enrollment behavior.
The delivery flag remains off. Installation, brew tests, existing-profile/recovery acceptance and
actual private publication remain unverified. Keep this follow-up local while the published app
candidate110fc2f2c finishes its existing CI, avoiding another cancellation of useful captures.


### Operations admission and staging candidate (local follow-up)

The separate follow-up adds an operations routing label with the same Linux image, public-only
Softnet configuration and shared resource accounting. Controller API evidence authorizes capacity
only for named main workflows/jobs after a successful same-source/attempt normal-Linux preflight;
JSON cannot set its derived authorization bit. GitHub can assign a different matching job before
revalidation, so the label grants no extra network/credentials. Workflow-scoped credentials remain
the capability boundary, as documented in `homelab/docs/operations-runners.md`.

The disabled canary requires exact-source successful main Homelab CI, checks pinned SSH metadata
staging/cleanup on the mini and rejects an open MacBook SSH negative control. It does not change
services or read app data. Actual Tailnet ACL, transport and cleanup acceptance remain unverified;
no credentials/flags/hosts were changed. Consumer release/apply adaptation remains work.
118 runner unit tests,45 scheduler tests, guest/probe tests, three actual staging-program/canary
boundary tests, route tests and the exact-source helper test pass. Clippy and workflow lint pass.
Independent final review accepted the runtime changes and verified the wording/source-proof fixes.
Private CLI publication remains a separate reviewed local candidate; neither batch expands PR959.

### New-app Cloudflare preset (local follow-up)

The existing new-app command accepts optional `--backend cloudflare`, keeping the default
independent SwiftUI scaffold intact. The backend belongs to the generated app: a TypeScript
Worker, frozen Bun/Wrangler dependencies, separate staging/production names, no public routes
by default, health/version response and route tests. Selected standard apps with this preset
receive Linux tests, two environment bundle checks and a real local workerd health probe;
template changes exercise a fresh isolated scaffold. The shared aggregate requires these
checks only when selected. This adds no shared product UI library or resource/account writer.

The real isolated default/Cloudflare generation, substitutions, duplicate/invalid refusal,
lockfile preservation, frozen install, route tests, both dry-run bundles and workerd startup
pass locally. Existing impact fixtures and all17 CI/gate tests pass; ShellCheck, actionlint
and diff checks pass. Independent final review found an outdated gate fixture, now corrected
and independently verified. Docs describe the working commands and remaining account/resource,
authentication and automatic production-promotion acceptance honestly. No live backend was
provisioned or published; this follow-up remains separate from PR959.

The scaffold also registers the explicit native delivery unit required by the consolidated
selector. Native source nominates only that product; backend-only and UI-test changes do not
nominate a native release. These boundaries are exercised against the actual shared selector
using freshly generated manifests. TestFlight remains disabled pending account/signing acceptance.

### Release authority inventory and native delivery preparation

Read-only provider inspection still finds active original Apps TestFlight/App Store workflows
and Callkeep's original build/test/release workflow. They have not been disabled or archived.
WWW's image/mini/Cloudflare writer flags remain false; the imported delivery flags are unset.
Workflow availability alone is not proof of an active upload or an enabled automatic channel.
Drain original publishers and reconcile durable counters/records at the relevant live cutover.

The Folding native delivery phase now explicitly installs XcodeGen and resolves the exact
pinned Apple environment/device before signing/archive. Its earlier `target: deploy` bootstrap
prepares backend/Ruby tools, unlike `target: apple`, so native delivery could otherwise repeat
the missing-generator/device failure after merge. Preparation runs only when native delivery
is selected; backend-only publication does not acquire this Apple setup dependency. Existing
strict product-pin checks remain in force. No release flag or provider state changed.

The compatibility audit found historical Folding `v…` records were still read from the new
repository. The artifact module now routes those reads to the configured original artifact
repository and rejects every create/upload/publish operation there before provider access.
Namespaced build/backend/reservation records keep using WWW. Regression tests reproduced the
wrong-repository read and unsafe historical write path before the correction; all36 release
tests/676 assertions pass after it. An actual read through the corrected module confirmed old
`v0.1.13`, processed build14/source091b09f359526cb81cf9b16de13fb750803eb579, without mutation.
The original repo remains required for those historical assets; do not delete it on source cutover.

Callkeep's provider release inventory currently ends atv1.0.25, matching the prepared allocation
floor. No original Apps or Callkeep workflow was in progress at inspection. These observations
are not a writer drain or a ledger migration; recheck queued/running work and reconcile exact
records when activating each replacement channel. This release-preparation/compatibility batch
remains local pending its integrated final review and live acceptance.

### Mixed-runner disk bottleneck removed

A deeper privileged read-only inventory found retired test caches outside the production Tart
home, missed by the earlier limited user inventory. The canary VM inventory was empty; neither
cache had open files. Production Mac/Linux pinned cache files and explicit retention markers
were verified before deleting only the unused canary/validation cache directories. No Tart GC,
production cache deletion, host activation, runner hold or budget change occurred. The prepared
validation VM and controller/test evidence remain. Observed physical free space rose from218.8
to305.6GiB, above the224GiB two-Mac-plus-Linux admission threshold. The permanent controller
subsequently showed both Mac attempts Running and an additional Linux attempt Starting.

The current Folding preview job also completed the shared tool setup and entered actual capture,
confirming the fresh-guest XcodeGen correction. Preview completion and the remaining PR checks
are still pending. The combined local follow-up candidate received independent final approval,
including historical artifact routing and native release preparation; it remains unpublished so
these changes do not restart the baseline PR's captures.

### Local native preflight and release credential inventory

The exact current baseline's production Folding app/widget and native test bundle compile.
An initial unsigned simulator invocation was unsuitable for its real Keychain tests: eight
cases failed without entitlements. Rebuilding/running with the existing CI simulator signing
settings passed all71 native tests, zero failures/skips, on a fresh task-owned pinned Duo
runtime. The simulator was cleaned up. Receipt: the external
`/tmp/monorepo-folding-native-signed-local-0cd.xcresult`; this does not claim physical-device,
live CloudKit, signed distribution or Apple processing acceptance.

Read-only GitHub metadata confirms all eight Tendr and seven Callkeep referenced secret names
are present. The production environment only overrides AGE_PRIVATE_KEY, avoiding an Apple-key
shadowing conflict. Folding's four signing/Apple names are present; FOLDING_DEPLOY_TOKEN,
FOLDING_RELEASE_POLICY_TOKEN and FOLDING_PRODUCTION_WORKER_CONFIG remain absent. Secret-name
availability is not a cryptographic/signing verification. The required Cloudflare lookup hit a
1Password authorization timeout; the owner has a pending retry/unlock request. No additional
vault session, token creation, plaintext logging or live delivery activation occurred. CI
continues independently. Folding infrastructure READMEs now describe their actual existing
owner-operated token and relocated generator paths accurately.

### Confirmed Folding preview and legacy build inventory

Folding preview run42568875617 completed successfully. Its downloaded private artifact contains
five outer-display preview PNGs for Today, History, Patterns, Leaderboard and Milestones. Each
PNG is1398x2034; all five byte hashes match the manifest and every entry has the same recorded
PR capture revisionc4003699a6437bfd2e4a0ed4fe1abb5d7f945163. The Today composition was visually
inspected. External receipt: `/tmp/monorepo-folding-preview-42568875617-verified.json`.
This proves the PR preview path, not the full multi-device/storefront screenshot matrix or
App Store publication. The replacement18b15907b PR checks remain pending.

Read-only reconciliation downloaded the latest immutable manifest for every historical version
and the original reservation ledger revision14. Both describe reserved builds1 through14;
the latest version is processed build14. Unuploaded/archived numbers remain burned. Preserve
the full append-only ledger and historical artifacts; recheck/drain original writers and copy
verified immutable ledger history into WWW before enabling a new allocator. This snapshot is
not a writer drain or Apple provider readback. No ledger, counter or old writer was mutated.

### Scoped Cloudflare consumer and minimal-guest scaffold preparation

The local follow-up is rebased onto baseline18b15907b, preserving both branches' progress records.
The generated Cloudflare-backend CI job now prepares ZIP extraction before Bun, matching the
minimal Linux guest prerequisite discovered in actual Folding CI. Cloudflare apply now uses
its controller-allowlisted source/apply names, ordinary Linux verification, the operations
profile and scoped OAuth/SSH credentials instead of decrypting the legacy application vault.
Its existing state-owner apply, encrypted backup/locking and positive result checks remain.

Four tests execute the actual workflow shell with fake SSH and verify private temporary files,
pinned transport, cleanup on failures and refusal to use an invalid staging path. An explicit
refusal fixes the reproduced Bash3 conditional/errexit behavior. All four and the15 existing CI
policy tests pass, with workflow lint/diff checks. The apply flag remains off; actual restricted
network canary, state-owner/restore acceptance and source ordering remain unverified.

### Control Center image publication follows the installed homelab owner (local)

The completed homelab dependency already pins and health-checks the app image through its own
release manifest. The local replacement for `Deploy Mac mini` therefore consumes the trusted-main
CI immutable image receipt and commits only that pin using a dedicated scoped Git deploy key.
Normal Homelab CI/promotion and the existing host stateful generation transaction then own deployment.
No retired-user SSH copy, backup/schedule reinstall or runtime-only image override remains in the
replacement workflow. The new writer has a separate disabled flag; the old flag cannot activate it.
Cloudflare keeps the scoped operations SSH route; the retired app deployment is removed from its
controller allowlist. No live key, flag, source authority or service changed.

Seven real-Git promotion tests pass: a one-file edit with untouched caller checkout, idempotent retry,
immutable source/digest, stale image rejection, unmerged source rejection, concurrent unrelated edits,
concurrently newer image pins and lost successful push responses. The commit retains exact source,
digest and successful CI run/attempt provenance. Source verification now checks the actual CI workflow
path, completed status and valid numeric run/attempt identity. The new host-automation ownership
regression failed before its manifest mapping and passes after: automation verifies only homelab
without activating it; the app image pin selects only homelab verification/promotion, not another app
release. All19 selection/gate tests,25 host automation tests, source test and seven relevant controller/
scheduler operations tests pass; Rust fmt, Python lint/format and workflow lint pass.

A wrong system-Python test invocation lacked PyYAML and shadowed stdlib select; rerunning with the
existing pinned tooling environment passed. This is local acceptance only. Scoped-key event triggering,
actual checked host source handover, live digest/worker/backup ownership and NAS restore still need
proof. Preserve old generation records; the new source epoch uses ordered Git and Nix generations,
never the old workflow counter. Independent final review is the next publication gate for this batch.

### Standard iOS resolver respects known host ownership (local)

A real committed-tree regression found that `scripts/affected` still overrode the shared selector:
a known host-automation script selected Tendr, RDesign and template builds through its older generic
scripts rule. The standard resolver now honors known ownership, retaining full verification for
shared/unmapped changes and the original legacy-repository behavior when no unit manifest exists.
Host automation selects no standard app work; mapped backend-template tooling selects its template
checks without building existing apps. Existing shipping policy is unchanged. The regression failed
before the correction; all19 selection/gate tests and the independent legacy impact fixtures pass.
This correction remains local with the release follow-up; no baseline PR checks were restarted.

### Enrollment promotion coordination restored and completed locally

The separately preserved enrollment candidate was restored into the local follow-up without
changing original checkouts, deleting its stash/backup branch or publishing it. The saved code
already contained fixes to the earlier independent review: UI-side cancellable polling instead
of a20-minute opaque worker wait; same-thread pinned SSH for recovery; a renewed activating fence
before verification of an expired prepared hold; and confirmed descendant progress after release.
Additional finish-enrollment cancellation checkpoints prevent starting verification after stop.
The existing reservation supplies the source/host/attempt identity; no additional user command or
new provider credential is introduced.

Ten protocol tests cover ownership, expiry, immutable source binding, lost responses, historical
manifests, recovery and release after concurrent promotion/new enrollment. The new descendant
regression reproduces Unconfirmed with the former strict readback guard and passes with the saved
correction. Negative cases retain strict acquire/activate ownership and ancestry checks. A stopped
wizard finish test passes. The full Rust CLI suite and all-target Clippy/fmt pass; opt-in physical/
VM enrollment and live provider checks remain unexecuted. The same-thread SSH/presentation paths
remain in the wizard, with no delegated vault access or new secret store.

Actual source-authority/key/profile/reboot/recovery acceptance is still required. This coherent
follow-up remains local pending final independent review and the app-baseline merge. Production
promotion flags, host identities, data and installed processes remain unchanged.

### Home Cloudflare plan, isolated encrypted restore and recovery ownership

The published usable-source candidate is `803d334e12b2acce3d6c91fa9181a8169d16bf9b`.
The reviewed delivery follow-up was rebased onto it; range-diff confirms the 13 logical commits
retain their implementation changes, with only progress-document append placement resolved.
The rebased shared CI suite passes 20 tests, host-promotion/operations suite 25 and distribution
suite 11. The earlier invocation accidentally selected Apple's Python 3.9 without the configured
requirements; rerunning with the existing tooling environment resolved those environment errors.

On November 9, the mini's existing OpenTofu 1.13.9 read the relocated home configuration and the
existing encrypted owner backend. Its plan returned 0: all 15 resource actions were no-ops.
A byte-identical encrypted state copy was then initialized as a separate local backend. A
wrong passphrase was rejected; the correct owner passphrase produced another no-change plan.
The production state SHA256 stayed
`6a135440b7b66b0833f9bcdff759a3c4599c0b103392f394e049dde3f158b521` throughout both checks.
No apply, resource import, vault lookup or service restart occurred. Private plans/logs and
state copies stayed on the mini outside Git. Redacted external receipts are
`/tmp/monorepo-home-infra-readonly-plan-receipt.json` and
`/tmp/monorepo-home-infra-restore-receipt.json`. This is not a NAS restore or off-host key proof.

Installed mini launchd metadata confirms nightly/full, hourly Control Center and Penpot backup
jobs run as `_containers`. Their source and the admin-owned infrastructure state have separate
ownership: the new service recovery bundle does not include Cloudflare state. Local before-apply
copies alone cannot satisfy off-host recovery. Keep the automatic Cloudflare writer disabled
until owner-scoped NAS state/configuration backup and actual downloaded restore/key recovery
are proved. Private set recency could not be checked with noninteractive mini sudo, so no fresh
service backup success is claimed. Backup docs now describe actual native SQLite/schedules and
explicitly retain this acceptance gap instead of calling the installed module disabled.

The old opt-in Hindsight synthetic recovery workflow was imported under `homelab/.github`,
where GitHub does not execute it. Its adapted root workflow restores that operator entrypoint
on a disposable homelab Linux guest, uses relocated source paths and the shared 1.99.0 Rust pin,
and preserves the pinned image, offline non-root container and synthetic-only inputs. Actionlint
passes. Its historical hosted result is not replacement-run acceptance; the new workflow still
needs publication and a real homelab run. No extra production data or credentials are supplied.

The new recovery build exposed an independent lockfile mismatch: the reviewed CLI version is
0.4.2, but the host helper still locked its local dependency to 0.4.1. A real `--locked` test
build refused that mismatch. An offline Cargo refresh changed only that package version,
without upgrading registry dependencies. The exact `--locked` release helper build and host
suite pass; the synthetic Linux-container restore remains explicitly ignored locally and must
run through the relocated workflow. Independent Astra final review approved this complete batch.
Private temporary plans and the copied state were removed after retaining redacted receipts in
the owner evidence directory; the original encrypted state and credentials stayed in place.

### Actual encrypted Cloudflare NAS round trip

Using the existing approved encrypted host recovery store, the primary operation read only its
NAS credential field directly into the uploader; no vault prompt, credential output or plaintext
credential file was created. A unique NAS folder received the encrypted state, private variables,
exact home HCL/provider lock/version and a hash manifest. The original state matched the earlier
proved SHA256 before upload. The pinned uploader verified remote bytes, then a separate actual
download was saved and all eight archive members were checked against their original hashes.

The downloaded files were transferred into a separate private mini backend. Initialization
passed; the wrong passphrase was rejected; the correct existing owner credentials produced a
no-change plan. Downloaded and production state hashes stayed unchanged. No apply or service
restart occurred. Redacted receipts are `/tmp/monorepo-home-infra-nas-receipt.json` and
`/tmp/monorepo-home-infra-nas-restore-receipt.json`; private snapshots stay outside Git.
The successful archive payload SHA256 is
`a93d15913bc60e910f97f1d9e5cdc9570ad9a98d35f9455c807b137494ab52fe` (44,847 bytes).

This supersedes the earlier absence of an actual NAS-copy restore proof, but does not close
automatic owner-scoped backup coverage or separately recovered passphrase/provider access.
Keep the automatic writer disabled until those remaining handover requirements are satisfied.
Source refresh fetched all six repositories successfully; remote main revisions were unchanged,
and dirty originals/branches were preserved. The current review-approved recovery implementation
is committed locally as `5bc50cd7d`; this subsequent receipt/documentation update changes no code.

### Real Folding signing and two reproduced CI defects

A local read-only Match canary cloned WWW's consolidated `signing/folding` branch,
imported its existing production app/widget profiles and signed a native archive
and IPA using a temporary keychain. The product's existing binary inspection
verified both packaged and archived identities, distribution entitlements, source,
backend configuration and exclusion of screenshot/development code. The keychain
was deleted. This used build 14 only as an unsubmitted signing canary, without
a reservation, upload or release record; it is not a new beta or reusable
reserved release. IPA SHA256 is
`8fb2e3bd93c47da5774a8a5a8dd1d5d956fc7bd3181d3e7135d7520eca90c60f`.
Receipt: `/tmp/monorepo-folding-signing-canary-receipt.json`.

PR #959 at `803d334e1` reached 41 successful checks, but two independent defects block green
acceptance (plus their failed aggregate). Folding's Linux VM stopped before the
controller issued DeleteVm; GitHub later reported lost communication without a
final build log. The actual Apple Virtualization service crash reports at 23:03:45
and 00:28:42 both trap on `com.apple.virtualization.virtio.vsock-device:0`, matching
[the upstream Linux connection leak](https://github.com/openai/tart-guest-agent/issues/81).
An isolated developer VM using the exact production image reproduced the leak
and crash after 240 completed probes plus measurement/readiness calls. With the
idle-connection correction it survived 640 calls with bounded socket counts.
A native RPC regression goes red before the fix; active commands remain alive.
The pinned Linux source-build recipe passes its complete RPC/vsock tests and
produces the same tested ARM64 binary hash. Image publication/host adoption and
replacement real CI remain unverified; no production image/policy was changed.

Separately, Darwin's Nix check reproduced the intermittent repair journal error
after 29 other bootstrap tests passed. The existing unlock-on-drop covered a
constructed Journal but omitted an early mismatch return before construction.
A concurrent fork can retain that file description and transiently block the
immediate repair reopen. A deterministic retained-descriptor regression now
reproduces Busy on the earlier ownership and passes when a private lock guard
owns every return path. The whole CLI suite passes 424 tests (three explicit
opt-in tests ignored), all 30 bootstrap tests pass, and all-target Clippy/fmt pass.
No recovery guard, lock exclusion or interrupted-activation rule is weakened.

The correction batch remains local, alongside the previously reviewed delivery
follow-up. Since a new source CI run is already required for the real Nix fix,
integrate that reviewed follow-up at the same publication boundary after final
review and runner correction, avoiding a second full migration CI cycle. Keep
all release/host/infrastructure flags off until their actual acceptance work.

The complete correction batch passed final Astra review after fixing its one publication finding:
refreshing the same image repository leaves both old and new cached digests, so publication now
identifies exactly the newly populated digest rather than requiring a one-image namespace.
Three filesystem-layout tests reproduce the earlier failure and pass with the correction,
including no-new/ambiguous refusal. All 134 homelab operations tests pass (one explicit skip).
The checked-in source recipe completed in a separate real Linux VM and produced the exact tested
agent bytes; its build unit exited successfully and the VM was stopped/reaped. The first recipe
attempt's Go read-only cache cleanup failure was corrected within the task-owned temporary cache.
Publication and host activation have not yet occurred.

### Linux image adopted; large runtime fixture corrected

The private replacement Linux image was built from the reviewed recipe and published as
`ghcr.io/0x63616c/homelab-linux-runner@sha256:3c7defd1a13e63560c36523dbdbe25a3ef11e1f264390447c27d5c474e7ca6a2`.
Its clean registry download passed manifest/chunk verification before preloading the runner.
The minimal byte-identical old-authority backport passed 131 operations tests (one explicit skip),
shell checks and the full exact-source Nix flake check on the MacBook. Homelab PR #39 merged
as `dd8ef99d584f4fb3a0ff4533c757fc87fc904432`; normal Comin adoption installed that revision.
Installed and boot system agree, the new image pin is live, and admission/resource reserves are
unchanged. No registry credentials entered a guest. Astra approved the recipe, artifact and pin.

The replacement Folding backend job `129089939553` in run `42583245917` stayed healthy,
completed Rust/Wasm builds and produced normal final logs. It passed 29 of 30 runtime tests;
the 100k test spent 105,231 ms constructing its direct-database fixture and exhausted its
120-second timeout after backfill. Bulk JSON insertion now seeds the identical 100,000 events
without 100,000 prepared statements. Count, 391-page backfills, read/delete/rebuild assertions
and timeout remain unchanged. On the same native host, fixture setup fell from 58,175 ms to
1,059 ms; all 30 runtime tests pass in 10.38 seconds. Astra independently approved this delta.
Replacement source CI remains required; neither this local result nor runner adoption is a green
PR claim. Signing/delivery/infrastructure acceptance and old-repository retirement remain open.

### Fresh SQLite advisory corrected without disabling the gate

Replacement CI job `129102252671` passed the Control Center server tests, then failed the
actual dependency check on `RUSTSEC-2026-0459` / `CVE-2026-119375`. Bundled SQLite before
3.54.0 can expose uninitialized page-cache memory for a crafted database/WAL pair. No live
database or file ownership changed during this finding.

SQLx 0.9.0's published SQLite constraint still excludes the patched library. The upstream
[compatibility correction](https://github.com/launchbadge/sqlx/commit/10462fa4414c6c7f1ed1d39bb31678e3b726878c)
permits SQLite sys 0.39; pin that exact official revision and package version rather than
suppressing the advisory or introducing a local database fork. The lockfile selects
`libsqlite3-sys 0.39.1` (SQLite 3.54.1). The source policy permits only that official Git
repository; all other unknown Git sources remain denied. Return to a registry release when
it includes the fix. Control Center's declared Rust minimum is 1.94 for SQLx 0.9; its existing
actual CI/compiler pin remains 1.99. Raising the minimum enables Clippy's let-chain guidance,
so mechanical equivalent condition collapses were applied without changing feature behavior.

All 30 Rust tests pass with the locked graph. All-target Clippy/fmt pass, and the actual
advisories, bans, license and source checks all pass. The real isolated Swift client/Rust
server round trip also passes. These are local checks, not replacement private CI acceptance.
The correction remains local until final independent review and the combined publication gate.
### Scoped Folding CI credentials and encrypted recovery

The owner approved the 1Password retry; all access reused the primary persistent shell.
Recovered bootstrap state stayed encrypted. The first full plan exposed only a list-order
change to the existing owner policy; aligning the same policy/resource sets with provider
readback yielded a reviewed plan with exactly two creates and no existing-resource mutations.
Astra approved the complete source and redacted plan before the exact saved plan was applied.

Separate deployment and published-build policy tokens are now active, saved in the Folding
vault and installed as `FOLDING_DEPLOY_TOKEN` and `FOLDING_RELEASE_POLICY_TOKEN` in WWW.
Worker deployment/version reads and a read-only D1 query passed with each identity; provider
metadata confirmed their permission/resource scopes. Neither CI token receives DNS, Access,
R2/state storage or token-minter privileges. Updated encrypted bootstrap state replaced its
existing vault recovery document; a separate download matched the new encrypted state bytes.
Token values remained in session memory and direct secret-store inputs, outside Git/logs.
Redacted receipts: `/tmp/monorepo-folding-bootstrap-identities-plan-summary.json`,
`/tmp/monorepo-folding-ci-identities-verification.json` and the two CI vault metadata receipts.

`FOLDING_PRODUCTION_WORKER_CONFIG` and live staging/readiness acceptance remain open. Both
live Workers still advertise only the previously accepted `profiles.milestones` at `091b09f`.
The imported backend adds history import and badge notification behavior; existing source-bound
configuration correctly rejects an unreviewed input change. Preserve live flags/resources/claims,
use the product's staging acceptance/readiness procedure, and retain device-only deferrals.
No application deployment, database migration, TestFlight upload or delivery flag was activated
by this credential operation. The credential source batch is local pending its publication gate.

Astra approved the complete SQLite correction and the independent credential source/plan batch.
They are combined without implementation conflicts; this documentation conflict retained both
acceptance sections. Replacement private CI and subsequent delivery acceptance remain required.

### Real backend success and deterministic authentication test timing

Folding backend job `129104370967` passed in the replacement homelab run: all 30 runtime
tests passed. The 100k fixture seeded in 3,125 ms, both actual 391-page projections completed
(14,989 ms backfill and 14,822 ms deletion/rebuild), and owner-read P95 was 23 ms. This is real
Linux runner acceptance for the connection/fixture corrections, without weakening the workload.

Darwin job `129104780192` passed the repaired journal/bootstrap tests and then exposed a
different CLI integration harness assumption: a 300-ms capture deadline was also required to
reach a native password prompt. A child scheduled after that deadline correctly times out
without showing a prompt. A controlled 600-ms fixture startup reproduced the exact failure
locally. The harness now separately exercises timeout while waiting at the prompt (three-second
budget, prompt still mandatory) and timeout before startup reaches it (50-ms budget, no prompt).
Both assert the actual `TimedOut` error; cancellation, secret masking, parser isolation and
terminal restoration assertions remain. All 11 authentication modes pass, with all-target
Clippy/fmt. Only synthetic test files change; production timeouts and transport code are unchanged.
Replacement Darwin CI remains required after final review/publication.

### Tendr website replacement — #1007

Objective: publish the existing site at the owner's selected `https://tendr.worldwidewebb.co/`,
preserve privacy/support content, and deliver app/listing URL corrections through normal handlers.

Plan and results:
1. **Done:** #1015 replaced the retired Git publisher with independently pinned Cloudflare
   static asset deployment. It compares the tested allowlisted artifact, skips superseded
   source and propagates errors. Folding's publisher remains separate.
2. **Done:** the existing encrypted Cloudflare state owner manages Tendr's DNS/Worker route;
   Wrangler owns only `tendr-web-production` code/assets. Dedicated CI credentials are in
   WWW and recovered in 1Password's Development vault, with only account-scoped Workers
   Scripts Write. No retired Pages flags or keys remain installed.
3. **Done:** app, metadata and current website documentation use the canonical URLs. Required
   PR checks and exact-source main [CI 42903597964](https://github.com/0x63616c/world-wide-webb/actions/runs/42903597964)
   passed for merge `31a699100a62e629befe02df1b9b10fcb45839fa`, including the Tendr simulator
   build/core/component tests, release/publication fixtures and infrastructure checks.
4. **Site and beta delivered; public Store promotion outstanding:** live URLs and App Store
   draft metadata are verified below. Keep #1007 open until the Store rollout is complete.

`Sites` published Worker version `b9117725-9a86-407e-b513-33e473352466`; Folding publication
skipped. [Apply Cloudflare 42904279137](https://github.com/0x63616c/world-wide-webb/actions/runs/42904279137)
checked out the exact #1015 merge and confirmed the encrypted state owner applied it with
recovery evidence retained. The workflow run's own head followed newer main; its apply-job
checkout is the source authority.

Homepage, `/privacy/`, `/support/`, stylesheet and icon returned 200 with bytes matching source;
unknown paths returned 404. Browser navigation home → privacy → support passed. Cloudflare
rejected the Python-default user agent with error 1010; browser/curl and Applebot user agents
returned 200. No zone security settings were changed. Old installed links cannot be repaired
by the replacement host alone.

[TestFlight 42904748330](https://github.com/0x63616c/world-wide-webb/actions/runs/42904748330)
processed **Tendr 1.1.1 (5)** and distributed it to Owner Preview. Its retained release manifest
binds build 5 to `baccc48f6fb4248bc4141633e845eda92579335c`, which includes the URL correction.
The subsequent `ScreenshotTests.testAppStoreScreens()` capture failed with exit 65 before
listing upload/submission; this is a failed Store pipeline, not a completed Store release.
No second binary upload was requested for recovery and no screenshot gate was bypassed.

During that run, #1016 replaced the old manually dispatched Store workflow with tagged
promotion. Using the still-supported `ios metadata app:tendr version:1.1.1 skip_screenshots:true`
handler then successfully uploaded the URL-only changes while retaining existing images.
Independent Apple API readback confirmed the editable 1.1.1 marketing, support and privacy
URLs and that build 5 is VALID and unexpired. Public 1.1.0's privacy URL still points to the
retired host; its replacement awaits Store promotion/Apple approval. No physical installation
is claimed. Remaining step: complete the normal tagged Store promotion with passing screenshot
evidence; the shared release guide owns that process.

### Tendr build 7 screenshot preview

The owner rejected the Catalyst-rendered gallery and requested native fidelity with only
the required assets. The replacement capture keeps one Tendr session across the two Duo
displays, uses the configured five screen/appearance pairs, and separates interaction tests
from asset capture. The manual Screenshots workflow captures on the hosted runner to avoid
interrupting the owner’s desktop. Local capture protocol checks (34) and release/export
checks (6) pass. Native preview [42952537362](https://github.com/0x63616c/world-wide-webb/actions/runs/42952537362)
passed: one app launch, one capture case (208.833 seconds), ten staged opaque native Duo
images. The full hosted capture step took about 24 minutes, with cold setup/builds dominating.
The six accurate phone frames from build 7 were reused. Required CI 42952542507 passed.
The native run exposed a test selector that assumed a horizontal TabBar; the capture now
selects the existing vertical-rail buttons directly, with no production app changes.
PR #1023 contains the capture changes and supersedes #1022. The complete 16-image gallery
is ready for owner review. App Store submission and merging remain pending; preserve the
current build-7 release source until promotion is complete.
