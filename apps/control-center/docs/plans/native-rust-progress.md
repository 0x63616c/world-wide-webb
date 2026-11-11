# Native Rust migration evidence

Delivery status is tracked in [issue #941](https://github.com/0x63616c/world-wide-webb/issues/941), cleanup in
[issue #942](https://github.com/0x63616c/world-wide-webb/issues/942), and the complete project in
[project 10](https://github.com/users/0x63616c/projects/10). Check actual workflow and `/healthz` revision
before treating any deployment as current. This record describes observations, not future acceptance.

## Replacement and preservation

PR #943 merged as `152893402893b78b1c8dbe8da23c5d2acd6bb950` after all required checks passed.
The exact merged revision then passed main CI and deployed successfully to the mini on 2026-11-08 UTC.
Rust reported that build, healthy SQLite and six enabled workers with zero consecutive failures.
The application PostgreSQL container is stopped; original data and backups are retained.

A fresh stopped-writer PostgreSQL snapshot was restored and imported into new SQLite, with exact
schema/type/row/value reconciliation, integrity and foreign-key checks. Its source export SHA-256 is
`0f7d6b2c617b3d8549df34301b15eae00e3351c08310482ac5a5c00faca870e4`.
All 135 Photo Booth records and files remain intact. Every file was compared against the final frozen
source archive; all 73 visible gallery frames also downloaded with matching bytes. Deleted/source-only
captures remain preserved and retain their original visibility. Missing legacy wake images are not a blocker.
Retired source tables are retained in a separate private raw archive.

Final database/media/runtime and encrypted infrastructure recovery payloads passed NAS read-back checks.
The initial precautionary backup `20261107T202453Z` also remains: 14 payloads, 475,622,543 bytes,
manifest SHA-256 `4134ae935bc22a5cf3090fd0067ec1d8787ed775a3a1aecc90e3844fc42528a1`.
Private evidence and recovery material stay outside Git. The earlier resumed-writer rehearsal was invalidated;
production uses the subsequent fresh import, never that stale rehearsal.

## Access and ownership

Calum chose all Tailnet devices as trusted. Native clients connect to `https://homelab.tail8c014d.ts.net`
without login, pasted credentials or Cloudflare headers. Docker publishes only loopback4202; Tailscale Serve
owns private HTTPS443, rejects Funnel and preserves other services' Serve routes.
Actual credential-free private HTTPS reads passed from another Tailnet host.

OpenTofu adopted the Cloudflare resources into enforced encrypted state on the mini with native file locking.
A recovery archive was actually downloaded from NAS and decrypted in isolation with its retained recovery key.
The tested-main Cloudflare apply passed: public app/API DNS, Access and ingress are retired, while independent
HA/Hindsight/Bambuddy/DSM routes and the shared tunnel remain. Three unused native service tokens were revoked.
The old installation-token file is removed. Only release-publication automation retains a server-side credential.
Pulumi source and its automatic writer are retired; encrypted recovery exports remain private.

## Verification and follow-up fixes

The replacement passed strict Rust checks, 23 Rust tests, 51 Python tests, 99 Swift package tests,
all 256 iPad native unit tests, actual Swift/Rust mutation and Photo Booth round trips, iPad/Duo interaction
checks, Mac Catalyst builds, actual Mac navigation, hosted ARM64 container persistence tests and encrypted
OpenTofu locking/recovery tests. One independent final reviewer inspected the replacement and fixes.

Live typed Swift reads passed alarms, walks, lights, Sonos, Tesla, weather, Wi-Fi, notifications, release metadata
and Photo Booth. They exposed lowercase climate action names against Swift's capitalized enum. The follow-up
normalizes the Rust wire response and adds a real mock-HA → Rust → typed Swift climate regression.
Apple's first signed upload was rejected with 90474: its validator requires the unqualified full-screen flag
for the declared landscape-only iPad policy. The follow-up sets that flag, retaining phone orientations and
the shared phone layout. Build 170 subsequently processed successfully in TestFlight.

The first release stopped safely at macOS SQLite preflight: a copied WAL database with no sidecars could
not be read with `mode=ro`. A disposable copy reproduced it. Clean journal preparation allowed deployment;
a regression now reproduces the exact cold-WAL failure under macOS system Python. The shared reader uses
existing-file `mode=rw` plus SQL `query_only`, allowing WAL bookkeeping while rejecting SQL writes. Both
preflight and consistent backups use it. The regression and retained operations checks pass after the fix.

Follow-up Python coverage is 53 tests. Pinned cargo-deny 0.20.2 advisories, bans, license and source checks
pass and run through `tools/check dependencies` locally and in CI. Periphery 3.8.0 was evaluated against the
real app/extension index with public, Codable, Objective-C and preview retention: 108 candidates were reported.
These include protocol/public/dynamic entrypoints; no bulk deletion is justified by that report alone.

About 646 MB of archived screenshots/design-review evidence is removed, preserving production Resources,
test fixtures, artwork provenance and Git history. New visual review evidence stays outside Git.

## Measurements and remaining acceptance

Before: Bun RSS69.78–71.81 MiB / meanCPU3.87%; app PostgreSQL RSS130.8–140.1 MiB / meanCPU1.85%;
tunnel RSS25.75–33.64 MiB / meanCPU0.405%. PostgreSQL logical size371,889,855 bytes, directory809,336 KiB;
media171,712 KiB /1,705 files. The fresh imported SQLite file is370,655,232 bytes before new worker writes.
These storage measures differ and do not by themselves establish savings.

Follow-up PR #944 deployed revision `7c2c39939eac9c3ee254a2f7cc5dfa4e487bb41f`. Main CI,
mini deployment, OpenTofu apply and TestFlight build 170 all passed. Live typed Swift climate reads and
all retained API reads passed. A fresh NAS backup was downloaded and restored: SQLite integrity/foreign keys,
all 135 media references and encrypted infrastructure recovery passed. Issue #941 is closed with evidence.
Calum confirmed physical iPad, iPhone and iPhone Duo working after enabling Tailscale on the iPad.

After: Rust RSS20.54–27.92 MiB; a 66.7-second cgroup CPU delta averaged2.206% of one core. These are
short production observations, not a matched-workload benchmark. The Rust image is37,243,236 bytes versus
59,784,598 bytes for Bun. Current SQLite is371,118,080 bytes plus4,120,032 bytes WAL; media1,708 files /
174,711,537 logical bytes. Twenty loopback alarm reads had p50 0.673ms /p95 1.156ms and no errors.

Calum subsequently removed Mac app support. The final cleanup disables Catalyst and iOS-on-Mac/Vision
compatibility, removes Mac window/fallback code and obsolete prototype scripts, retires the Mac download,
and restricts TestFlight groups to iPad/iPhone. App Store Mac/Vision compatibility was already disabled.
Historical Mac verification above records past work, not a supported product. Mac mini hosting stays.
The final delivery cleanup publishes and deploys the same CI-tested immutable image, exercises the real
Swift/Rust contract in CI, and separates native validation from TestFlight publication selection.

## Final acceptance

PR #947 merged as `5f48ec0a86d86def98e8e983b4179af0e4ff1840`. Main CI 42438244156,
mini deployment 42438994141, OpenTofu apply 42438994165 and TestFlight delivery 42438994181 passed.
The processed-upload receipt records build 171 for that revision. Production image ID and configured digest
match the CI-tested immutable image; live API reads and all 135 original Photo Booth file hashes passed.

Calum confirmed on the physical iPad with TestFlight build 171 that the alarm rings while locked, and
snooze and stop work. This closes the physical-device acceptance gap in #940; it is user-observed evidence,
separate from automated foreground/simulator tests.

Calum explicitly accepted the recorded production CPU/memory/storage observations with their documented
limits instead of an isolated matched old-versus-new benchmark. The original matched-workload requirement
is superseded by that acceptance. The observations above remain uncontrolled production samples; no
matched benchmark or whole-host resource improvement is claimed. No required migration acceptance remains.

## Dog Walker removal

The Dog Walker launcher, client integration and server API are removed. Existing SQLite walk records and migration history remain preserved.
