# Tip product setup implementation — 2026-11-07

Added `fastlane/lib/tip_products.rb`, ten-locale `tip-products.json`, and the `setup_tips` Fastlane lane for the three exact production consumable IDs. US base prices are $0.99/$2.99/$4.99; actual returned price-point IDs are selected by decimal equality, while app display remains StoreKit-localized. Product/localization/price/availability changes reconcile current Apple state and read back results. Availability follows the existing app selection; no legal/contract/tax values are invented.

Review screenshot reservation, chunk upload, checksum commit and delivery readback use Apple's published asset API when actual PNG paths are provided. Existing mismatched review assets are not deleted automatically. No product submission endpoint is invoked. The helper never calls 1Password or performs independent credential lookup.

Implementation-only checks passed: Ruby syntax, Fastlane lane loading, exact configured product set/price mapping and ten-locale text lengths. Public Apple OpenAPI 4.6 was consulted for every request body/relationship and path. No authenticated API request, product mutation, review upload, purchase or submission was executed by the implementation agent. Live integration and language/visual review remain open.

See [tip setup runbook](../../fastlane/TIPS.md).

## Live-integration diagnostics follow-up

Primary reported a localization POST read timeout, then a reconciliation run stopping at missing app availability. Added bounded product/stage/locale progress, safe transport errors, compact Fastlane failures and per-attempt incremental evidence. No write retry was introduced. Added separate `configure_app_availability` lane using documented OpenAPI 4.6 `/v2/appAvailabilities` inline territory resources: create global availability only when absent, preserve every existing selection, and read back the exact returned territories/settings. It never changes legal answers or publishes/submits a version. Ruby syntax, helper loading and lane registration checks only; primary owns live invocation.
