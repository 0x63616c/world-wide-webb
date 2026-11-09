# Finish the migration

Updated November 9, 2026. This is the current execution plan; it replaces the remaining-work
and verification requirements in earlier migration documents.

## Already done

- Source consolidation is merged into WWW. WWW is public.
- CI uses hosted runners, including `xcode-27` for Xcode 27.2 jobs.
  That image includes the pinned Xcode build and Duo runtime. Control Center's legacy
  native jobs still use `macos-26`; correcting them is included below.
- Both Macs follow WWW; the handover was verified at `0b046d9`. Subsequent host changes
  follow their normal updater. The bedroom-switch worker was verified live.
- The old homelab repository is archived.
- Folding **1.0.0 (15)** is VALID and available in Folding Internal; future main delivery
  is enabled. App Store submission/device acceptance remain separate product work.

## Cloudflare and sites — complete

[PR #972](https://github.com/0x63616c/world-wide-webb/pull/972) handed publication to WWW.
[Sites](https://github.com/0x63616c/world-wide-webb/actions/runs/42649259019) published
legacy Pages assets and both Folding sites. Existing support/privacy URLs and Folding routes
were checked. The old apps site writer is disabled; its Pages host remains for installed URLs.
[Home Cloudflare apply](https://github.com/0x63616c/world-wide-webb/actions/runs/42649263710/attempts/2)
passed using the existing encrypted state and resources. No replacement state or infrastructure was created.

## Callkeep and CLI publication

The public publisher cutover removes both migration enable gates and replaces Git artifact
transport with ordinary release archives and SHA-256 Homebrew recipes. Product tags are
`callkeep/v1.0.N` and `homelab/vVERSION`. Each publisher updates only its own tap recipe after
its selected main CI succeeds. Keep historical releases; archive the old source repositories
after the first WWW releases and tap updates succeed. Current execution evidence belongs in
`monorepo-migration-progress.md` once delivery completes.

## Control Center — one implementation PR

### Build 173 investigation

The processed-upload receipt from [delivery run 42512604639](https://github.com/0x63616c/world-wide-webb/actions/runs/42512604639)
records build **173**, source `242eb8f4a0c3dc1ca336c20682e610128f914ac9` (PR #955).
That source already contains `duoClosed` and `duoOpen` canvases. Its archive log explicitly
uses `/Applications/Xcode_26.6.app/Contents/Developer`. Current Control Center CI and
TestFlight workflows still select `macos-26`; their shared selector accepts Xcode 26.4+.

[Apple's SDK guidance](https://developer.apple.com/videos/play/tech-talks/111461/)
explains that older-SDK apps retain a familiar size/aspect ratio on the inner display;
the iOS 27.1 SDK enables edge-to-edge use. The confirmed release-toolchain mismatch
strongly explains Calum's build-173 symptom. This is release forensics, not a reproduction
of the installed binary or proof that upgrading alone fixes every layout issue.

The existing canvas UI test derives its expected display from the app's own frame.
It therefore does not independently establish that an open Duo received its full inner
display. A local installed simulator app also has `UIRequiresFullScreen=false`, unlike
the shipped source's `true`; do not reuse that altered app as release-equivalent evidence.
Apple documents that the flag still allows fold/unfold resizing, so do not remove it
as an assumed fix or break the existing iPad distribution policy.

### Implementation order

1. Move Control Center native validation and TestFlight upload to hosted `xcode-27`.
   Require the intended Xcode 27.2/SDK in its validation and archive path, using existing
   toolchain tooling with a product-specific requirement where needed. Reject old SDKs
   before archiving; keep unrelated products' supported toolchains intact.
2. Check the production configuration on the actual open/closed Duo simulator displays.
   Extend the existing canvas test to assert the selected pose independently of the app
   frame and check opening/closing retains launcher/navigation state. Fix sizing/orientation
   only if the corrected toolchain still exposes a failure; preserve the clock and iPad UI.
3. Finish automatic TestFlight ownership in WWW: retain signing identities, processed-upload
   retry receipts and product-scoped selection. Remove the temporary `PANEL_DELIVERY_ENABLED`
   gate when ready. Deliver a real successor to build 173 and record its processed build/source.
4. Finish the existing backend chain: successful source CI publishes the same tested immutable
   image, `deploy-mini.yml` commits its digest to `homelab/services/control-center/release.json`,
   then normal Homelab CI/promotion and the mini updater activate it. Confirm the promotion
   deploy key exists; remove temporary image/promotion gates once connected. Remove stale
   `MINI_DEPLOY_ENABLED`; do not restore the superseded direct-SSH deployment owner.
5. Update Control Center release/runbook and migration tracking to match the working path.
   Run relevant existing checks and one final Astra review of the complete implementation PR.
   After merge, check the processed native build/Duo core flow and live backend revision/health.

Implementation now uses Xcode 27.2 for validation and signed upload, removes the temporary
publication gates and reuses the existing homelab image-promotion path. Verification and
TestFlight delivery run in CI, as requested; no local app builds or simulator checks are required
for this batch. The open/closed UI-test improvement above remains a follow-up rather than a
blocker to delivering the corrected SDK build. Delivery results are pending CI.
No CI redesign, backup overhaul, App Store submission or broad UI rewrite is included.

## Finish remaining references and cleanup

- Fix remaining app, CLI and Homebrew source/release references. Use the existing pipelines;
  account for WWW now being public rather than implementing the old private-download proposal.
- Update README, AGENTS and release instructions to describe the working setup.
- Retire superseded source writers once their workflows, downloads, issues and recovery readers
  use WWW. Keep the apps Pages repository writable while WWW publishes retained installed URLs.
  Keep Folding’s historical artifact repository available while legacy records reference it.
  Keep dotfiles and homebrew-tap separate; leave the agreed excluded projects alone.

## What counts as finished

The remaining paths and ownership point here, normal relevant CI passes, affected sites work,
and old repositories no longer own active jobs. Keep any real blocker visible; fix ordinary
issues as they arise. Do not manufacture releases to close the migration.

App Store submissions, complete screenshot sets, forced TestFlight uploads, Homebrew release
canaries and new-app tooling improvements can accompany the next real product work. They do
not block repository cleanup. No new shared UI library or CI redesign is part of this finish.

Backup/deployment redesign is tracked in #970 and service-scoped updates in #965.
Encrypted signing review is tracked in #967. These are separate follow-ups.

## Hosted Apple runner correction

The earlier claim that GitHub cannot provide Xcode 27.2 was incorrect: `macos-26` was checked
instead of the dedicated `xcode-27` label. The [current image inventory](https://github.com/actions/runner-images/blob/main/images/macos/xcode-27-arm64-Readme.md)
lists Xcode 27.2 (27B52) and Duo on iOS 27.2. Migrated Apple jobs use that hosted label;
Control Center's remaining `macos-26` jobs are addressed above.
The homelab runner infrastructure remains available; CI selection and delivery gates are unchanged.
