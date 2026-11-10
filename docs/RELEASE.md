# Releases

Publish from WWW using the product’s handler and verified source. Repository consolidation
is complete; the [migration record](plans/monorepo-migration-progress.md) records ownership.
WWW and its Callkeep/CLI release downloads are currently public.

## Product handlers

Tendr and standard iOS apps use the root locked Ruby bundle and explicit app selection:

```sh
bundle install
ruby scripts/check-release.rb
bundle exec fastlane ios verify app:tendr
bundle exec fastlane ios beta app:tendr
```

## Tendr and Folding

`release.yml` is the event owner. It calls the shared reusable `testflight.yml` coordinator,
which verifies source/selection once and calls the Tendr or Folding reusable delivery handler.
Existing reusable product CI remains the verification owner. There are no app delivery
enablement variables.

- A successful trusted main `CI` run delivers affected apps to internal TestFlight. Tests/docs
  and unrelated products do not request app uploads. Folding backend inputs deploy the exact
  tested Worker before the native beta, retaining recovery bookmarks and compatibility checks.
- Each processed beta retains an `ios-beta-<app>-<source>` artifact for 90 days. Its receipt
  names the app, source, marketing version, build and successful source CI attempt. Folding’s
  immutable build ledger and private archive remain the durable product owner.
- Push `tendr/vX.Y.Z` or `folding/vX.Y.Z` at that tested main commit to submit its existing
  processed build for App Review. The tag must match the binary’s version in `app.yml`.
  Promotion captures/verifies store assets and submits ready purchases with the app. It does
  not archive, sign or upload another binary. Public release follows Apple approval.

For example, after main delivery confirms Tendr 1.1.1:

```sh
git tag -a tendr/v1.1.1 <tested-main-commit> -m 'Tendr 1.1.1'
git push origin tendr/v1.1.1
```

A release tag can select an older main commit even while newer betas continue. Both channels
share one publisher lock per app. Moved tags, mismatched versions, missing/expired beta receipts,
failed source CI and builds that Apple has not processed fail visibly. Preserve an active Apple
review; a tag retry can reconcile an already submitted build. The status watcher is read-only
and never submits newer untagged main changes.

Tendr uses the root locked Ruby bundle, signing setup and listing/screenshot handlers. Folding
keeps its product bundle, Match signing, backend/build-policy receipts and private immutable
archives. Root lanes reject Folding, Callkeep and Control Center. Existing physical-device
acceptance deferrals remain recorded in Folding’s product instructions.

Callkeep publishes signed/notarized universal ZIPs and symbols from selected main CI under
`callkeep/v1.0.N`. The publisher updates only Callkeep’s cask in the separate `homebrew-tap`
repository, using an ordinary release URL and SHA-256. Homebrew owns updates; no private Git
transport, appcast or migration enable gate is required. See the [product README](../apps/callkeep/README.md).

Homelab CLI publishes `homelab/vVERSION` archives from successful selected Homelab CI and
updates its Homebrew formula. Install with `brew install 0x63616c/tap/homelab`. Both the formula
and Callkeep’s cask download WWW releases. See the [CLI README](../homelab/cli/README.md).

Control Center’s `Apple Panel TestFlight` workflow follows successful main `CI`, selects native
publication and archives with Xcode 27.2. It waits for Apple processing, records the source/build
receipt and announces the processed build through the private API. Its native/image publishers
have no temporary migration enable gates. Backend delivery publishes the tested immutable image;
`deploy-mini.yml` proposes its digest in `homelab/services/control-center/release.json`, then
normal Homelab CI/promotion and the mini updater activate it. `HOMELAB_DELIVERY_ENABLED` controls
host promotion; authoring `main` and deployment `deploy/homelab` remain distinct.

## Credentials and publication

Use the existing product-scoped credentials and approved signing stores. Load secrets only in
steps that need them; do not copy a complete vault into job-wide environment variables. All
operator credential access reuses the primary agent’s persistent shell. Never print secret values.
Signing repositories and encrypted recovery storage remain separate from source retirement.

Required checks must pass before merge/delivery. Verify the affected outcome: Apple processing,
installation, or the deployed service revision as appropriate. An upload alone is not a processed
build. Reuse valid evidence for unchanged mechanisms rather than repeating unrelated acceptance.
Delegated reviews require an explicit owner request.

Verification and delivery selection are separate. Test/docs changes and forced verification do
not authorize app releases. Use one quiet watcher and report meaningful changes or failures.

## Websites and infrastructure

Folding’s production/staging websites publish from `sites/folding` through `Sites`, controlled by
`FOLDING_SITE_DELIVERY_ENABLED`. OpenTofu applies retained home infrastructure through the
`Apply Cloudflare` workflow with `OPEN_TOFU_DEPLOY_ENABLED`; it reuses existing encrypted state.

Tendr’s former `apps/gh-pages` host was deleted at the owner’s request. The legacy publisher
is removed; existing app/listing links need replacement Cloudflare URLs in [#1007](https://github.com/0x63616c/world-wide-webb/issues/1007).
Until that follow-up lands, static Tendr source still builds locally/CI but has no maintained
publication destination. See [sites](../sites/README.md). Do not restore the deleted repository
or describe the old URLs as supported.
