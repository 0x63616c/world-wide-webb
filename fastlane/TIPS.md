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
