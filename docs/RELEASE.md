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

### How App Store releases work

1. Set a new marketing version in `apps/<app>/app.yml` before merging the intended
   app changes. A version may have several TestFlight builds; each main delivery has
   its own build number.
2. Merge to `main`. Successful exact-source CI delivers selected Tendr/Folding changes
   to the internal TestFlight group. Wait for the delivery job and Apple's build
   processing to finish. A docs-only merge does not deliver an app. Folding backend
   changes also deploy the tested Worker before its native beta.
3. Choose the tested main commit and its processed beta receipt. Create and push an
   annotated `tendr/vX.Y.Z` or `folding/vX.Y.Z` tag at that commit, with the version
   exactly matching its `app.yml`. The tag run captures and verifies current App Store
   screenshots, prepares listing and purchase review assets, and submits the existing
   build. It does **not** rebuild or upload a new binary.
4. Check the App delivery result and App Store Connect for **Waiting for Review** or
   **In Review**. Submission is not approval. Both apps request automatic App Store
   release after approval; check public availability separately.

Run these from a checkout with the tested commit available, substituting the app,
version and commit:

```sh
git tag -a tendr/v1.1.2 <tested-main-commit> -m 'Tendr 1.1.2'
git push origin tendr/v1.1.2
```

The two apps share the same event selection, source/receipt validation, per-app
publisher lock and Apple review policy. Tendr uses the root Fastlane handler; Folding
uses its product-owned immutable archive and Worker checks. See
[Folding release operations](../apps/folding/fastlane/RELEASE.md) for those details.

### When a release is already at Apple

| Previous version | New tag behavior |
| --- | --- |
| TestFlight only, or an editable App Store draft | Select the tagged processed build and prepare its review submission. A prior draft must be compatible with the tagged version. |
| **Waiting for Review** | A tag for a *new* App Store version defers; it does not override the waiting version. The handler can replace a pipeline-owned waiting submission only when the tagged build has that **same** marketing version, all new assets are ready and Apple has not advanced review. The normal one-tag-per-version flow does not produce a second tag for this case. A replacement would lose its place in the review queue. |
| **In Review** or later review transition | Preserve Apple's current submission. The new tag run defers; it does not automatically interrupt review or replace its build. Retry the deferred run after the review resolves, if that version is still eligible. |
| Approved or live | Use a strictly higher marketing version for the next App Store release. Approval can precede public availability. |

Apple permits a developer to remove an app in review, but doing so restarts review.
This pipeline deliberately leaves an in-review submission intact. If Apple rejects
the app or an included purchase, inspect the feedback and resolve the affected item
before retrying. A code fix needs a new processed build; do not treat a successful
upload or an expired receipt as a releasable build.

### Version and retry rules

- Increase the App Store marketing version for each new public version. Do not tag
  `v0.2.0` after `v0.2.1`, or reuse a version already released. Set the new value in
  `app.yml` **before** its TestFlight build. Apple requires an incremental version;
  the release handlers compare it with Apple versions and fail when the tagged
  version cannot be used. Several beta builds may share one marketing version while
  it remains unreleased.
- A release tag names one tested commit and one processed beta receipt. Do not move
  or force-push tags. If the tag run fails before submission, rerun that GitHub Actions
  run after fixing an external prerequisite; inspect its recorded state first. Do
  not create a second tag or assume another push of the same tag starts a new run.
- If main has moved on, a tag can still select an older main commit and its beta.
  Newer untagged main changes never silently replace the selected build. If Apple
  has already advanced the selected version, the tag cannot roll the store back.
- A tag with a malformed name, non-main commit, mismatched `app.yml` version, missing
  or expired beta receipt, unsuccessful source CI or unprocessed build fails before
  submission. Publisher locks serialize runs for each app, and ambiguous Apple
  submission outcomes are reconciled before another write.

Git hooks are local checks, not a release authorization boundary. This repo's
`.wtp.yml` runs `lefthook install --force` when `wtp add` creates a worktree, so the
configured **pre-commit** checks are installed there by default. They check staged
files, formatting and secrets; they do not check a future tag against live Apple
state. A missing `lefthook` binary or failed setup needs attention, and a clone or
worktree made without `wtp` needs `lefthook install`. GitHub CI plus the Apple
preflight provide the release checks even when local hooks are absent.

`release.yml` owns the event and calls the shared `testflight.yml` coordinator and the
product delivery handler. Product CI owns verification. There are no app delivery
enablement variables. A processed beta has an `ios-beta-<app>-<source>` receipt kept
for 90 days; Folding also retains its durable private archive and build ledger. The
read-only status watcher observes Apple and the public store without submitting
untagged changes.

Apple's [version guidance](https://developer.apple.com/help/app-store-connect/update-your-app/create-a-new-version),
[review statuses](https://developer.apple.com/help/app-store-connect/reference/app-information/app-and-submission-statuses/)
and [removal behavior](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/remove-a-submission-from-review)
explain the external constraints behind these rules.

Tendr uses the root locked Ruby bundle and listing/screenshot handlers. Its TestFlight job reads the existing Apple Distribution identity and App Store profile from private `certificates` branch `tendr` with read-only Match. Folding
keeps its product bundle, readonly Match signing from private `certificates` branch `folding`,
backend/build-policy receipts and private immutable
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

Tendr publishes the existing static site to `https://tendr.worldwidewebb.co/` through `Sites`
on selected main pushes, using `TENDR_SITE_DEPLOY_TOKEN`. Its app/listing URLs point to this host;
the normal Tendr pipeline delivers the binary and uploads metadata through `ios finish_release`.
For a listing-only update, the existing handler is `bundle exec fastlane ios metadata app:tendr skip_screenshots:true`. This does not submit an app or upload a binary. Verify the
live website before uploading its URLs. See [sites](../sites/README.md) for configuration and
ownership. Old GitHub Pages links in installed builds require an app update.
