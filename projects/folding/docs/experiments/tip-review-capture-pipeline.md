# Tip review screenshot pipeline — 2026-11-07

Added a reviewer-only `tipjar` scenario to the capture plan: en-US, light, Duo outer display. Full captures include it in addition to all existing storefront scenes/locales/displays. A separate `tip_review_screenshots` lane captures only that image without Apple credentials. Packaging preserves the native PNG bytes, emits a commit/configuration/fixture/runtime/product-source-bound manifest and maps all three exact product IDs to the image. Reviewer files stay outside the storefront upload directory.

The iOS agent owns the actual shared TipJarContent extraction, bundled product metadata and UI test. This batch owns Fastlane plan, capture/package validation, immutable release-asset hashes and explicit `setup_tip_review_assets` association. The latter verifies image identity before/after setup and records Apple IDs/states/hashes when invoked with a release tag. It never submits a purchase or creates a fake Apple purchase dialog.

Ruby helper/Fastfile syntax and lane registration checks passed. No screenshot capture, image review, Apple asset association or final storefront acceptance ran in this implementation batch. The iOS screenshot build-for-testing check is separately reported by its owning agent. Final visual review and live asset processing remain pending.
