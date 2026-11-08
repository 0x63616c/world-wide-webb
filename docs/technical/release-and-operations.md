# Release, infrastructure, and operations contract


## Owner-approved execution update — November 7, 2026

The owner has authorized implementation through submission/publication and reports Apple account agreements/tax/banking requirements complete. Verify actual App Store Connect state when used; do not request these again unless a concrete account prompt contradicts that report.

Physical-device testing is explicitly deferred until **after App Store submission**. Any earlier wording requiring a real-device pass before feature work/submission is superseded by this scheduling exception. Keep these checks marked **deferred**, never passed; continue simulator, domain, backend, security, UI, and release checks before submission. Do not bypass App Attest or fabricate device evidence to satisfy this schedule. Missing device-only evidence is recorded in the release manifest as an owner-approved deferral, not a successful check. Automatic release after approval remains enabled; approval may occur before device testing is complete.

Immediately after verified submission, run the deferred Duo tests with the owner and fix/resubmit if needed. The full shipping goal remains incomplete until required deferred tests and resulting fixes are resolved. Known functional/security failures are still fixed promptly; this exception defers hardware evidence, not already-known defects.

Status: implementation specification, November 7, 2026. No infrastructure or release automation is deployed by this document. Product scope remains in [the review spec](../review-spec.md); milestone order remains in [the delivery plan](../delivery-plan.md).

## 1. Technology choices and ownership

Use **OpenTofu** with the Cloudflare provider for infrastructure, **Wrangler** for Worker code/assets deployment and D1 migrations, **Fastlane** for Apple build/signing/TestFlight/listing/submission, and **GitHub Actions** for execution. Do not have OpenTofu and Wrangler both manage the same Worker script version. OpenTofu owns durable resources and routing; Wrangler owns code versions, bindings generated from outputs, and migration execution. Record every managed resource and its owner in `infra/README.md` before first apply.

Use `workers-rs` for Rust Worker execution. Render the admin HTML with **Askama** templates and autoescaping, verified in the first Wasm build; no JavaScript framework, SPA, or client-side administration credentials. The public site is static HTML/CSS served by a separate Worker with Static Assets, using the same repository. It has product, support, privacy, deletion, and appeal pages. Default no marketing analytics, cookies, third-party fonts, or trackers. These choices do not require adding a web application framework.

Use separate resources per environment:

- Production: Worker `folding-api-production`, D1 `folding-production`, R2 `folding-avatars-production`, queue `folding-jobs-production`, dead-letter queue `folding-jobs-dead-production`.
- Staging: identical names with `staging`; never share data buckets, databases, queues, APNs registrations, App Attest enrollment records, or signing identities with production app identifiers.
- Routes: `api.getfolding.app` and `admin.getfolding.app`; staging uses `api-staging.getfolding.app` and `admin-staging.getfolding.app`. Root public assets use `getfolding.app`; redirect `www` to root.
- Admin hostname is protected by Cloudflare Access. The Worker independently verifies Access credentials and its administrator allowlist. Reject admin requests arriving through the API hostname, previews, or `workers.dev`, even if those routes expose the same script.
- Disable public R2 access; approved avatars are served through the application-controlled route. Pending originals and rejected assets are never publicly readable.

Bindings in both environments use identical logical names: `DB`, `AVATARS`, `JOBS`, `JOBS_DEAD`. Non-secret configuration includes `ENVIRONMENT`, `APP_BUNDLE_ID`, `APPLE_TEAM_ID`, `ACCESS_TEAM_DOMAIN`, `ACCESS_AUDIENCE`, `PUBLIC_ORIGIN`, `API_ORIGIN`, and `ADMIN_ORIGIN`. Fail startup/request initialization on missing required configuration; do not fall back to production values.

## 2. Toolchains, repository commands, and hooks

`tool-versions.json` records exact versions for Xcode build/SDK/simulator runtime, Swift, Rust, Ruby, Bundler, Node, OpenTofu, and dependency tooling. It is a project configuration file read by bootstrap/CI, not an assumed third-party tool format. Select values from a successful M1 build on the intended runner; no agent should write invented version numbers or floating `latest` values. Commit `Cargo.lock`, `Package.resolved`, `Gemfile.lock`, Node lockfile, `rust-toolchain.toml`, and OpenTofu dependency lockfiles.

Use Xcode's Swift formatter (`swift format`) from the pinned toolchain, `cargo fmt`, `cargo clippy -- -D warnings`, `tofu fmt`, and pinned Prettier for Markdown/JSON/YAML/HTML/CSS. Limit format paths to owned source/configuration files. Do not run formatters over generated Xcode files, secrets, fixtures whose exact bytes are test inputs, or release artifacts.

Expose stable scripts:

- `scripts/bootstrap`: check/install supported development tools using pinned versions, resolve dependencies, and install `.githooks` idempotently. Do not read secrets or provision cloud resources.
- `scripts/format`: format intended working-tree source files; never stage changes.
- `scripts/check`: formatting check, domain/contract checks, and local Rust validation; clearly report simulator/device checks that were not run.
- `scripts/check-staged`: extract staged blob contents into an isolated temporary tree and check formatting there; never overwrite working files or alter the Git index. Report paths and the format command.
- `scripts/check-prepush`: focused domain/contract tests; full simulator matrix remains CI work.
- `scripts/release-preflight`: read-only validation of the selected manifest, local artifact hashes, Apple prerequisites, and backend compatibility.

The pre-commit hook invokes staged checks; pre-push invokes focused checks. CI enforces equivalent rules independently. Shell scripts use strict error handling, quote paths, handle filenames with spaces, clean temporary files, and never print environment variables wholesale. Bootstrap must not change a user's global Git configuration.

## 3. Infrastructure state and deployment

Use the OpenTofu S3 backend against a dedicated private Cloudflare R2 state bucket, with separate keys `folding/staging.tfstate` and `folding/production.tfstate`, client-side state encryption, and `use_lockfile=true`. **Before first shared apply**, prove native conditional-write lock compatibility against the actual R2 endpoint with the pinned OpenTofu version: two competing clients must not both acquire the lock. Also rehearse restoration from an encrypted versioned backup. R2 compatibility and recoverable history are explicit M0 gates; do not assume S3 parity or silently disable locking. If that proof fails, stop shared applies and record an alternative locking backend decision; local state is not the production fallback.

Bootstrap the state bucket once with scoped credentials and a recorded recovery procedure, then import its management into a separate bootstrap state if supported. Back up encrypted state after successful applies to immutable timestamped objects; ordinary CI must not delete state or backup objects. Store encryption/recovery keys outside the state bucket in 1Password. Restore rehearsals use staging copies, never overwrite live state to test recovery.

A production change follows: validate configuration → generate plan for the exact commit → inspect destructive replacements → apply that same plan under environment concurrency lock → generate deployment bindings → additive D1 migrations → deploy compatible Worker version → run smoke checks. Any plan that replaces/deletes a production database, bucket, or zone requires a separately justified migration action; never auto-approve it as routine deployment.

Provision resources as code where provider support exists. An unsupported resource requires a documented bootstrap command/configuration and verification, not an invisible dashboard-only dependency. Preserve existing domain/email records when importing DNS.

Migrations are numbered append-only SQL files with a checksum ledger. Applied files are immutable. Use D1-supported transactional constructs; do not assume arbitrary multi-statement SQL transaction commands work through every driver. Rehearse each migration against a staging copy and verify old/new Worker compatibility. A migration with external side effects must have an idempotent separate step.

## 4. Secrets and signing

Secret names are identifiers, not values. GitHub environments hold only the credentials needed by their jobs:

- Apple release: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY`, `MATCH_PASSWORD`, and `MATCH_GIT_PRIVATE_KEY`.
- Cloudflare deployment: `CLOUDFLARE_API_TOKEN` scoped per environment; `CLOUDFLARE_ACCOUNT_ID` is a non-secret variable where appropriate.
- State: `TF_STATE_ACCESS_KEY_ID`, `TF_STATE_SECRET_ACCESS_KEY`, and the configured OpenTofu state-encryption secret. Supply them through backend environment/configuration supported by the pinned tool, not committed argument files.
- Runtime Apple integrations: `APNS_PRIVATE_KEY`, `APNS_KEY_ID`, `SIWA_PRIVATE_KEY`, `SIWA_KEY_ID`; team/topic/issuer identifiers are non-secret configuration. Apple may scope an account key across applications, but per-app credentials are preferred when supported.
- Runtime application secrets: named values required by the authentication specification, including token/signing and moderation pseudonymization keys. The auth owner defines algorithms and rotation; infrastructure must not invent a competing scheme.

Store signing assets encrypted in a separate private `0x63616c/folding-signing` repository managed by Fastlane match. Create it during account setup, not implicitly during PR checks. Routine CI uses match readonly mode and a temporary keychain removed on exit. Certificate/profile creation or renewal is a dedicated trusted setup lane. Never run `match nuke`, revoke unrelated team certificates, or allow Xcode automatic signing to silently replace team assets.

Materialize private keys only in restrictive temporary files, mask secrets, and delete keychain/files on failure as well as success. Do not upload workspace archives containing keys, provisioning credentials, environment files, raw application logs with identity tokens, or OpenTofu state. 1Password remains the recovery source; CI is not the only copy of irreplaceable credentials.

## 5. CI jobs and permissions

Use GitHub-hosted macOS for Xcode work and Linux for Rust/contract/infrastructure checks where possible. Pin action revisions to full commit SHAs. Record exact runner image/toolchain in evidence; a stable runner label alone does not freeze installed software. If hosted runners lack the required SDK/runtime, use a documented supported runner selection before enabling release jobs; do not quietly downgrade the deployment target.

- `checks.yml`: pull requests and main; `contents: read`; format, Swift/Rust domain tests, contract fixtures/schema validation, imports/module checks, localization, infra validate, targeted simulator UI/snapshots, dependency/secret checks. Forks get no deploy or Apple secrets. Do not use privileged `pull_request_target` to execute PR code.
- `staging.yml`: trusted main commits; deploy one environment with `folding-staging` concurrency and `cancel-in-progress: false`; integration smoke and migrations.
- `beta.yml`: trusted workflow dispatch or qualifying release candidate; invoke the shared archive/upload workflow, then distribute the recorded build to configured TestFlight groups. It must not automatically submit to App Review.
- `screenshots.yml`: unprivileged dispatch/PR/release capture; uploads gallery, images, and capture manifest. No production sign-in or real user data.
- `release.yml`: protected `vMAJOR.MINOR.PATCH` tag or explicit resume of its existing release record; production secrets only after trusted-ref validation; `folding-release` concurrency with cancellation disabled. A tag is the owner-authorized release instruction; do not add routine per-stage approval prompts.
- `infra.yml`: unprivileged formatting/validation on PRs; trusted plan/apply with scoped environment credentials. Plan outputs are restricted artifacts because they can contain sensitive configuration.

A failing required job blocks submission. Failed or cancelled runs are not acceptable evidence. Snapshot changes need human/independent visual review; blindly re-recording baselines to make CI pass is prohibited. Check only the relevant screenshot matrix on PRs; run every required storefront asset before release.

## 6. Fastlane lanes and build identity

Fastlane is the sole orchestration entry point for Apple distribution; wrapper scripts may prepare inputs. Define:

- `verify`: compile/test supported schemes and validate localization/configuration.
- `screenshots`: Fastlane snapshot with deterministic fixtures, then caption composition and capture-manifest validation.
- `archive`: explicit scheme, Release configuration, production bundle IDs, readonly signing, unique build number, and immutable `.xcarchive`/`.ipa`/dSYM hashes.
- `beta`: upload the selected artifact using pilot, wait for processing, record the App Store Connect build ID, and distribute only to configured groups.
- `release_preflight`: check artifacts, metadata, privacy/support URLs, required products, account prerequisites, minimum backend capabilities, and intended version/build match. No submission.
- `submit`: deliver metadata/screenshots, select the exact processed build, submit for review with `automatic_release: true`, then poll/read submission state.

Use shared functions/configuration for identifiers, signing, upload, and version assignment. Never independently rebuild the same marketed release in beta and submission lanes and assume the binaries match.

One archive-allocation workflow owns build numbers for every production bundle. Under a global distribution concurrency lock, reserve the next monotonically increasing integer above the maximum of App Store Connect and the repository's stored reservation manifest. Persist the reservation before archive/upload. Its idempotency key is `(commit_sha, marketing_version, archive_configuration_hash)`. Retries reuse the reservation and existing immutable artifact; a different binary requires a new build number. Do not use only a workflow-specific run number or wall-clock second as an assumed unique global counter.

The release manifest is a versioned JSON artifact with these required fields:

```text
schema_version = 1
release_id, tag, commit_sha, marketing_version, build_number
bundle_id, apple_team_id, asc_app_id
configuration_hash, toolchain_versions, dependency_lock_hashes
archive_sha256, ipa_sha256, dsym_sha256
fixture_version, screenshot_manifest_sha256, metadata_manifest_sha256
backend_contract_version, minimum_backend_capabilities, deployed_worker_version
required_checks[{name, run_url, conclusion, commit_sha}]
asc_build_id, asc_processing_state
submission_id, submission_state, automatic_release
created_at, updated_at, workflow_run_url
```

Before external upload, fields not yet known are explicit `null`; a state transition requires its fields to be filled. Update the manifest atomically with a monotonically increasing revision; preserve prior revisions as release artifacts. Hash file contents, not just names. Do not overwrite an artifact associated with an existing hash/build. Promote an already-tested archive by manifest identity, not “latest build.” Store artifacts as a draft GitHub release during preparation; publish the release record after verified submission. Keep dSYMs and the complete archive in access-controlled storage for the lifetime of that distributed version.

## 7. Release state machine

Persist one release record per tag; state changes are resumable and must be verified from the external system after an ambiguous timeout.

1. `planned`: tag resolves to a trusted commit; version and archive reservation established.
2. `validated`: required checks pass for that commit; compatible production backend and required public pages are available.
3. `assets_ready`: all required screenshots/metadata match the commit/configuration and have validated manifests.
4. `archived`: signed immutable artifact exists and its identifiers/version/entitlements have been inspected.
5. `uploaded`: Apple has accepted the upload; record build ID when available. Do not infer processing success.
6. `processed`: the exact build is usable in App Store Connect; compliance requirements satisfied. Processing failure records a failure without advancing.
7. `ready_to_submit`: listing/products/screenshots/review notes are associated with the intended version/build and preflight passes.
8. `submitted`: verify **Waiting for Review** or **In Review**, with submission identifier and automatic release enabled. This is the submission completion gate.
9. `approved`: Apple approval observed; do not assume public availability is immediate.
10. `live`: public listing and download are available; run production smoke checks and record results.

`failed` is a recorded attempt outcome with the last stable state, reason, and retry instruction, not a reason to reset all state. On retry, inspect Apple and artifact storage first. `rejected` preserves Apple's feedback and submitted identity; a code change starts a new build/release attempt, while permitted metadata-only corrections keep the exact build if Apple allows it. `cancelled` stops subsequent external writes and must distinguish a cancelled local run from an already-submitted Apple version. Do not resubmit on every polling timeout.

## 8. Screenshot and reviewer fixture isolation

Capture actual app views using the Release UI code and simulator builds from the selected commit. The screenshot composition root substitutes fixed-clock/in-memory or temporary-store fixtures and disables every network client, notifications, cloud sync, and purchase execution. Fixture access is compiled only for simulator screenshot/test configurations; the distributed device artifact cannot enable it with a launch argument or remote flag. This is a separate simulator artifact with a recorded configuration hash, not the identical signed IPA.

The Apple reviewer demonstration path, if needed, is a separate explicitly documented read-only preview of sample data in the shipping app. It uses a distinct fixture store, visibly identifies sample content, cannot enqueue competition events or access production account mutations, and exits back to the real app. Do not turn off App Attest for reviewers or ship hidden developer controls.

Capture-manifest fields: `commit_sha`, `configuration_hash`, `fixture_version`, `fixed_clock`, `app_locale`, `storefront_locale`, `device_model`, `runtime`, `pixel_width`, `pixel_height`, `appearance`, `scenario_id`, `raw_sha256`, `composed_sha256`, `caption_key`, `caption_version`. Require every expected scenario/locale/device-size tuple exactly once. Hash both raw and composed images; preserve native UI without misleading replacement content. Missing current captures fail release, not fall back to older images.

Define locale mapping in `fastlane/locales.json`: app resource locale, notification locale, and Apple storefront identifier are separate fields. Confirm accepted storefront identifiers against App Store Connect before locking values. The screenshot manifest defines Apple upload sizes separately from device-layout review sizes. Validate dimensions against current Apple requirements at the first release and when SDK/device support changes; never invent an iPhone Duo simulator name.

## 9. Runtime jobs, failure handling, and observability

Use one scheduled dispatcher every five minutes to find due period finalizations, notifications, retention cleanup, and pending retries. Cloudflare Queues carries work identifiers; D1 remains the source of truth for job status and uniqueness. Queue delivery may repeat. A worker acquires a time-bounded database lease, checks current state/generation, performs the operation, and commits its outcome. Expired leases are reclaimable. Never hold a database transaction open during an external network call.

The dispatcher selects categories with due domain work instead of creating nine jobs unconditionally. Retention, expired-avatar discovery and period catch-up run hourly; due finalization, cleanup, deletion, corrections and retries remain eligible every five minutes. Expired suspensions also trigger retention promptly. Feature-disabled outbound categories are not enqueued. Existing pending/failed category jobs prevent new category jobs from resetting their retry budget. Queue delivery batches up to ten identifiers while retaining per-message leases/acknowledgments and the two-consumer concurrency bound. Monitoring runs directly each tick and updates alert rows only when their values change. An idle installation with no domain work therefore creates at most one routine retention job per hour.

Generated Worker configuration includes a 5,000 ms CPU limit per invocation and 10% head-sampled structured application logs, with automatic invocation logs disabled to avoid storing request headers/URLs. Route labels distinguish authentication and enrollment endpoints without including dynamic identifiers. CPU limits and sampling bound individual work and reduce logging overhead; they do not cap monthly spend. Existing administrative ingestion/avatar/notification switches remain the emergency controls. Billing alerts/watchdog activation retain their separate live-delivery acceptance requirements.

Default retry schedule for external transient failures: exponential backoff starting at 30 seconds, capped at one hour, with jitter and a maximum of 12 attempts before dead-letter/review. Authentication/configuration failures alert immediately and pause that job category. APNs expired/invalid tokens are removed; invalid payloads are dead-lettered without infinite retries. A queued identifier is not permission to send: recheck current account status, notification preferences, generation, result version, and eligibility immediately before dispatch.

Do not claim exactly-once push delivery. Maintain one logical notification identity per participant/period/category and reuse the same APNs collapse identifier for retries where supported. A timeout after a possibly accepted send is an ambiguous outcome; record it and retry conservatively. Device delivery remains best-effort, and result history is always available in-app.

Before relying on direct APNs delivery, prove HTTP/2 transport, signing, environment/topic selection, and response handling in the real Rust Worker runtime. If unsupported, stop the notification integration task and record the smallest compatible delivery design. Do not silently introduce an unreviewed paid third-party push platform or rewrite the backend in another language.

Operational switches live in a versioned administrative configuration record: `competition_ingestion_enabled`, `result_notifications_enabled`, `avatar_uploads_enabled`. Default true after launch acceptance; local personal tracking is never gated by these server switches. State changes require authenticated admin action and audit reason, take effect on each relevant request/job, and must not clear queues automatically.

Log structured request/job IDs, deployment version, route name, outcome code, duration, and non-sensitive counts. Never log raw identity tokens, assertions, request bodies, avatar bytes, email addresses, or complete exported histories. Use narrowly scoped participant references only where needed for moderation and enforce the retention policy. Start with alerts for five consecutive health failures, sustained ingestion failures above 5% over 15 minutes with at least 100 requests, finalization delayed more than 30 minutes after its scheduled processing time, and dead-letter queue growth. These initial thresholds are operational defaults to tune from staging, not physical-fold abuse thresholds.

## 10. Recovery and release compatibility

Every production deployment must support the current released app plus the candidate awaiting review. Add fields/endpoints first; remove only through a separately documented retirement plan. Preserve old client request fixtures in compatibility CI. A backend capability check confirms required functions before app submission, but must not become a remote switch that disables existing private tracking.

Runbooks must include exact environment, credentials reference, safe commands, verification, and rollback/forward-repair criteria:

- Worker regression: pause affected ingestion/notification category if needed, deploy prior known-compatible Worker version, verify old/current client fixtures, then resume. Do not roll schema backward automatically.
- Failed migration: halt dependent code deploy; inspect ledger and actual schema; apply a reviewed forward repair. Restore data only through a separate rehearsed recovery operation.
- Data loss/corruption: restore a staging copy first, compare counts/key invariants and tombstones, determine the recovery point, then perform controlled production recovery. Reapplying old data must not resurrect resets/deletions/bans; preserve the authoritative destructive-operation ledger during reconciliation.
- Signing/key compromise: revoke only affected credentials, rotate and deploy replacements, preserve unrelated team assets, verify new token/signing behavior, and invalidate compromised sessions where applicable.
- Apple authentication/attestation outage: leave local tracking active and verified submissions pending; no production bypass.
- Notification outage: pause sends, preserve finalized results, fix transport/configuration, recheck eligibility before resumed delivery; never issue a second logical award.
- Cost spike: inspect request/job category and bounded-query metrics, apply category-specific limits/pause, retain personal functionality, and do not delete evidence/data as a cost-control shortcut.

Acceptance before launch: restore rehearsal succeeds; rolled-back Worker can read the additive schema; old-client contract tests pass; simultaneous release/infra attempts serialize; interrupted uploads resume without duplicate build/submission; production artifacts reject fixture activation; all admin aliases reject unauthorized access; and the final release manifest proves the exact submitted build and current assets.

## 11. Common implementation mistakes to reject

- Treating `Ready for Review`, upload success, or a green GitHub job as proof of submission.
- Rebuilding after beta and submitting a different binary under the same release label.
- Using short-lived CI artifacts as the only release/signing recovery copy.
- Giving PR code release secrets or allowing a fork to invoke a privileged reusable workflow.
- Putting private keys/state in the repository, debug output, or broad workspace artifacts.
- Having OpenTofu and Wrangler fight over the same resource or accepting a destructive production plan unattended.
- Assuming an API returns HTTP/2 support, transactional semantics, or screenshot runtime support without the required integration check.
- Leaving a screenshot/demo route able to write production scores.
- Using direct database edits in admin pages rather than audited application operations.
- Treating retry-safe job processing as a guarantee of exactly-once push display.

## References

- [Fastlane deliver](https://docs.fastlane.tools/actions/deliver/): listing/upload/submission orchestration and automatic release option.
- [Fastlane match](https://docs.fastlane.tools/actions/match/): shared signing storage and readonly CI configuration.
- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/): public static-site hosting direction.
- [OpenTofu S3 backend](https://opentofu.org/docs/language/settings/backends/s3/): lock-file mechanism; compatibility with the actual chosen endpoint must be tested.
