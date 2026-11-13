# Consumable tip setup

`bundle exec fastlane ios setup_tips` prepares only production app `6832059501` (`app.getfolding.Folding`):

| Product ID suffix | US base price |
| --- | --- |
| `tip.small` | $0.99 |
| `tip.medium` | $2.99 |
| `tip.large` | $4.99 |

All three are consumables. They grant no feature, content, currency or leaderboard benefit. The app continues to render StoreKit's returned `displayPrice`; neither this source nor the US amounts are a substitute for the buyer's localized price.

The primary agent runs this in the existing credential session with the same App Store Connect API environment as other Fastlane lanes. The helper uses the primary-owned `FoldingAppleAccount.client` JWT, refreshing it in process as needed. No token/key is saved or logged, and no credential CLI is called. Pinned Spaceship has no v2 product-management model, so these calls use the public App Store Connect API directly.

## Reconciliation

- Reads the exact app's bundle identity before mutations.
- Locates existing products by full product ID; creates only missing consumables and updates changed reference/review text.
- Reconciles each of the ten locale names/descriptions from `tip-products.json`. Draft translations still require final language review.
- Lists/paginates Apple's returned USA price points and selects an exact decimal match. It never invents or constructs an Apple price-point ID.
- Sets the USA base schedule with Apple's automatic equalized pricing for other territories. An already-matching schedule is untouched. Existing future/manual regional schedules stop for inspection instead of being silently replaced.
- Mirrors the app's currently selected availability territories and its existing new-territory setting. If app availability has not been configured, this stage stops; it does not invent tax, trader, banking, contract or territory answers.
- Reads back locale, price and availability mutations. A repeat run reconciles Apple state; transport failures are not automatically retried as writes.

Successful per-product progress is written to ignored `build/tips/product-inventory.json`, including actual resource/price-point IDs, current Apple state, locale count, selected territories and screenshot status. This is preparation evidence, not proof of App Review readiness or approval. An interruption before a completed product's report is written is recovered by reading Apple again.

## Review screenshots

Provide actual current screenshots showing the tip UI. Do not use a fabricated product checkout, stale screenshot, personal account data or a placeholder image.

An optional JSON map associates each full product ID with a PNG path, resolved relative to the JSON file:

```json
{
  "app.getfolding.Folding.tip.small": "tip-jar.png",
  "app.getfolding.Folding.tip.medium": "tip-jar.png",
  "app.getfolding.Folding.tip.large": "tip-jar.png"
}
```

```sh
bundle exec fastlane ios setup_tips screenshots:/absolute/path/review-assets.json
```

The helper reserves the review asset, uploads only the returned byte ranges/headers to an HTTPS Apple-owned upload host, commits the checksum and reads its delivery state. API bearer tokens are never sent to the asset host. It refuses redirects, incomplete byte coverage and automatic deletion of a differing existing review asset. A pending matching reservation can resume. Apple processing may remain incomplete; `UPLOAD_COMPLETE` is not represented as `COMPLETE`. With no screenshot map, each product explicitly records `not_supplied`.

This lane never calls a review-submission endpoint. Initial in-app purchases may need association with the first app submission; that remains the release/account integration step, after screenshots and final review.

## Official API contract

Implemented against Apple's downloaded **App Store Connect OpenAPI 4.6** on November 7, 2026 and the following published resources:

- [Create v2 in-app purchases](https://developer.apple.com/documentation/appstoreconnectapi/post-v2-inapppurchases)
- [App product inventory](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-inapppurchasesv2)
- [Price schedule creation](https://developer.apple.com/documentation/appstoreconnectapi/post-v1-inapppurchasepriceschedules)
- [Purchase availability](https://developer.apple.com/documentation/appstoreconnectapi/post-v1-inapppurchaseavailabilities)
- [Review screenshot commit](https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-inapppurchaseappstorereviewscreenshots-_id_)
- [Official OpenAPI download](https://developer.apple.com/sample-code/app-store-connect/app-store-connect-openapi-specification.zip)

The helper's source/lane loading and metadata validation were checked without credentials. Live Apple writes, returned-price matching, upload-host compatibility, product readiness, StoreKit sandbox purchases and final localization review are still pending.

## App Store country policy

`fastlane/app-availability.json` owns the desired country selection: all Apple territories
except `excluded_territories` (three-letter ISO codes). Afghanistan (`AFG`) and Morocco
(`MAR`) are excluded because Apple blocks the app's contests classification there.
`available_in_new_territories` controls Apple's automatic inclusion of future storefronts.

Edit this file through a PR, then run the command below from the merged source to apply
it without building or submitting an app. Automatic App Store releases also reconcile
this policy before preparing the listing. Manual changes in App Store Connect are
overwritten on the next reconciliation. Release and pre-order dates are preserved;
legal, tax, banking and rating answers are unchanged. Readback verifies the selected set
and future-territory setting, recording the policy hash in `build/tips/app-availability.json`.
Tip availability continues to mirror the app's selected territories.

```sh
bundle exec fastlane ios configure_app_availability
bundle exec fastlane ios setup_tips
```

No POST/PATCH retries are added. A timeout after availability creation is reconciled through GET on the next invocation before any attempted create.

Tip setup emits bounded progress at each product/stage and locale (at most ten locales per product), with no URLs, headers, tokens or raw Apple response bodies. Before any product stage, and after completed substages, it checkpoints `product-inventory.json` and an attempt-specific file under `build/tips/attempts/`. The prior inventory is retained separately before a new run. Partial records distinguish in-progress stages from prepared products; IDs/localization count/resolved price-point IDs survive an interruption after their corresponding stages.

Transport errors report timeout/connection category and the current stage without a Fastlane stack dump. A stopped report stores only the request method, resource name(s), HTTP status when available and error class. An ambiguous write is never called failed remotely or automatically retried: re-run setup to read Apple's actual state first.

Live evidence received from the primary agent: the initial setup hit a localization POST read timeout. An idempotent reconciliation run subsequently reached the app-availability prerequisite, establishing why incremental evidence and a separate availability bootstrap are necessary. The implementation agent did not execute those authenticated runs.

## Reproducible review-image packaging

The isolated screenshot target now renders the same native `TipJarContent` used by the shipping view. Its reviewer-only `tipjar` scene reads the committed product metadata, shows the three configured en-US/USD rows and disables purchase execution. It does not show or simulate an Apple purchase dialog.

For a single-image unprivileged capture from a clean committed checkout:

```sh
bundle exec fastlane ios tip_review_screenshots
```

Outputs are under `build/store-assets/<commit>/production/assets/`:

- `review/tipjar-en-US-duo-outer.png`: untouched native PNG, no marketing caption.
- `tip-review-manifest.json`: commit/configuration, fixed clock, fixture/runtime/device/locale, dimensions, PNG/map/product-source hashes and explicit pending visual-review status.
- `tip-review-screenshots.json`: each of the three exact consumable IDs mapped to that PNG using a relative path.

The explicit authenticated association lane validates these files, then passes the map to `setup_tips`:

```sh
bundle exec fastlane ios setup_tip_review_assets
```

For sealed release artifacts, use `setup_tip_review_assets tag:v1.0.0`; this downloads/verifies the existing asset archive, uses its map and records resulting Apple review-asset IDs/states/hashes in the release manifest. Both paths validate the capture again after association and require the helper's source PNG SHA-256 (paired with Apple checksum readback) to match the expected PNG. They never submit products.

Normal `screenshots`/`release_assets` capture includes this one reviewer image alongside the existing full storefront matrix. Reviewer files live outside `assets/screenshots`, so deliver's storefront upload does not accidentally include the Tip jar review image. The existing locale/display/scenario completeness check is unchanged. Final visual review and real Apple asset-processing acceptance are still required; capture, association and `UPLOAD_COMPLETE` are not substitutes for either.
