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

Tendr retains its listing, screenshot, submission and storefront handlers. Automatic standard
delivery requires `STANDARD_IOS_DELIVERY_ENABLED`; manual dispatch remains available. New apps
keep delivery disabled until their account/signing setup is ready. Root lanes reject Folding,
Callkeep and Control Center; use their own handlers.

Folding owns `apps/folding/Gemfile`, Fastlane, immutable build ledger, backend compatibility
and build-policy receipts. Successful trusted-main CI selects backend/native inputs independently.
`FOLDING_DELIVERY_ENABLED` controls automatic delivery. Signed artifacts and manifests remain
in authenticated GitHub draft releases in WWW, including after Apple submission. Legacy tag
readers also target WWW; the deleted Folding repository had no GitHub releases. Legacy records
remain read-only. Preview captures are separate from App Store screenshot sets. Follow the
[product instructions](../apps/folding/AGENTS.md) for current App Review and device deferrals.

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
