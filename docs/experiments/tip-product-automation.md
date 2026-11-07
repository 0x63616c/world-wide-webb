# Tip product setup implementation — 2026-11-07

Added `fastlane/lib/tip_products.rb`, ten-locale `tip-products.json`, and the `setup_tips` Fastlane lane for the three exact production consumable IDs. US base prices are $0.99/$2.99/$4.99; actual returned price-point IDs are selected by decimal equality, while app display remains StoreKit-localized. Product/localization/price/availability changes reconcile current Apple state and read back results. Availability follows the existing app selection; no legal/contract/tax values are invented.

Review screenshot reservation, chunk upload, checksum commit and delivery readback use Apple's published asset API when actual PNG paths are provided. Existing mismatched review assets are not deleted automatically. No product submission endpoint is invoked. The helper never calls 1Password or performs independent credential lookup.

Implementation-only checks passed: Ruby syntax, Fastlane lane loading, exact configured product set/price mapping and ten-locale text lengths. Public Apple OpenAPI 4.6 was consulted for every request body/relationship and path. No authenticated API request, product mutation, review upload, purchase or submission was executed by the implementation agent. Live integration and language/visual review remain open.

See [tip setup runbook](../../fastlane/TIPS.md).
