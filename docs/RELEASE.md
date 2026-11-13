# Releases

Each product has a publication owner. The [CI selection policy](../scripts/ci/units.json)
chooses verification separately from delivery candidates; passing checks or changing
shared documentation does not publish an unrelated product. Required checks must
pass before merge, and a delivery is complete only when its external result is
verified.

| Product | Main delivery | Release or activation |
| --- | --- | --- |
| Tendr, Folding | Selected changes reach internal TestFlight after successful main CI and Apple processing. | `tendr/vX.Y.Z` or `folding/vX.Y.Z` at the tested commit submits that processed build to App Review. |
| Callkeep | Selected main CI produces a signed, notarized app. | Product delivery publishes `callkeep/v1.0.N` and updates its Homebrew cask. |
| Homelab CLI | Selected Homelab CI builds release archives. | `homelab/vVERSION` updates its Homebrew formula. |
| Control Center | Native TestFlight and immutable server image use separate publishers. | Server promotion proposes a digest for Homelab; `deploy/homelab` activates checked host state. |
| Tendr website | Selected site changes publish to Cloudflare. | The public `/`, `/privacy/` and `/support/` pages are checked after deployment. |
| Folding website | Site publisher is gated by `FOLDING_SITE_DELIVERY_ENABLED`. | Its own tested artifact and Cloudflare configuration are used. |
| Golink for Safari | Product CI verifies builds and behavior. | No automatic app publication. |

[Callkeep](../projects/callkeep/README.md#release-automation),
[Control Center](../projects/control-center/README.md),
[Homelab](../projects/homelab/docs/releases.md) and [sites](../sites/README.md) retain their
product-specific commands and recovery steps.

## How App Store releases work

Tendr and Folding share the event selector, exact-source beta receipt validation,
per-app publisher lock and review-state rules. Tendr uses the root Fastlane bundle;
Folding keeps its own immutable archive, Worker prerequisites and Fastlane bundle.

1. Set the new marketing version in `projects/<app>/app.yml` before merging the app
   change. Several TestFlight builds may share that version; each has a different
   build number.
2. Merge to `main`. Wait for successful exact-source CI, internal TestFlight
   delivery and Apple processing. Selected Folding backend changes deploy the
   tested Worker before native beta delivery. A docs-only merge does not upload
   either app.
3. Pick that tested main commit and its processed beta receipt. Push an annotated
   `tendr/vX.Y.Z` or `folding/vX.Y.Z` tag at the commit. Its version must match
   `app.yml` and the processed binary. The tag job captures and verifies current
   store screenshots, prepares listing and ready purchases, then submits the
   **existing build**. It does not archive, sign or upload another binary.
4. Confirm **Waiting for Review** or **In Review** in App Store Connect. Both apps
   request release automatically after approval. Approval and public availability
   are different results; verify the public storefront separately.

For example, after a processed Tendr beta for version 1.2.3, set
`TESTED_MAIN_COMMIT` to the commit SHA recorded by that beta's receipt:

```sh
git tag -a tendr/v1.2.3 "$TESTED_MAIN_COMMIT" -m 'Tendr 1.2.3'
git push origin tendr/v1.2.3
```

The shared `release.yml` workflow calls `testflight.yml` and the product delivery
handler. Each processed beta has an `ios-beta-<app>-<source>` receipt retained for
90 days; Folding also keeps its durable private archive and build ledger. See
[Folding operations](../projects/folding/fastlane/RELEASE.md) for its release details.

### If Apple already has a version

| Apple state | What the tag run does |
| --- | --- |
| TestFlight only or editable draft | Prepares the tagged processed build when the existing draft is compatible with its version. |
| **Waiting for Review** | A *new version* tag defers; it does not override the waiting submission. The handler can replace a pipeline-owned waiting submission for the **same** marketing version after preparing new assets, but the normal one-tag-per-version flow does not create a second tag for that case. Replacement loses the review queue position. |
| **In Review** or another active review transition | Preserves the current submission and defers the new tag. It never interrupts an in-review app automatically. |
| Rejected app or purchase | Inspect Apple's feedback. Resolve the affected item, prepare a new processed build for a code fix, and retry only when Apple state permits it. |
| Approved or live | Use a strictly higher marketing version for the next App Store release. Approval can precede public availability. |

Apple allows developers to remove an app from review, but resubmission starts review
again. This pipeline leaves an in-review submission intact. See Apple's
[review statuses](https://developer.apple.com/help/app-store-connect/reference/app-information/app-and-submission-statuses/)
and [removal behavior](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/remove-a-submission-from-review).

### Version, source and retry rules

- Increase the marketing version for each new App Store version. Do not tag
  `v0.2.0` after `v0.2.1` has been released, or reuse a released version. Set
  `app.yml` before the beta build; the handlers compare the tagged version with
  Apple's records. Apple requires an [incremental version](https://developer.apple.com/help/app-store-connect/update-your-app/create-a-new-version).
- A tag names one tested main commit and one processed beta receipt. An older main
  commit can be selected while newer *untagged* betas continue; the tag never
  silently selects the latest beta. Do not move or force-push release tags.
- Invalid tags, non-main commits, version mismatches, missing or expired receipts,
  failed source CI and unprocessed builds fail before submission. Per-app locks
  serialize publishers. Ambiguous Apple results are read back before another write.
- If a tag job fails, inspect its recorded state and rerun that GitHub Actions run
  after resolving the cause. Another push of the same tag does not start a fresh
  run. The read-only status watcher does not submit untagged main changes.

For a Tendr listing-only correction, the root handler is
`bundle exec fastlane ios metadata app:tendr skip_screenshots:true`. It neither
uploads a binary nor requests review. Check live page URLs before uploading them.

## Other publication boundaries

Callkeep's public ZIP and symbols are verified before its separate `homebrew-tap`
cask changes. The Homelab CLI formula also downloads WWW release archives.
Control Center's native beta, server image and host activation have separate
owners; a service image is not a deployed host revision. Host promotion depends
on `HOMELAB_DELIVERY_ENABLED`. Home Cloudflare infrastructure applies require
`OPEN_TOFU_DEPLOY_ENABLED` and the retained encrypted state. Tendr and Folding
websites publish independently; site changes do not ship app binaries.

Use product-scoped credentials and existing private signing storage. Keep secret
values and release evidence out of source. An upload is not proof of a processed
build; a submitted build is not proof of an approved or public app. Verify the
specific result affected by the change.

## Local hooks

`.wtp.yml` runs `lefthook install --force` when `wtp add` creates a worktree.
The installed pre-commit checks cover staged files, formatting and secrets. A
clone or worktree made another way needs `lefthook install`. Local hooks cannot
query Apple's future review state and are not release authorization; GitHub CI
and the Apple preflight enforce the release checks.
