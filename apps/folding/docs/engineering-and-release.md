# Engineering, quality, and release

> Historical planning notes. The consolidated [v1 review specification](review-spec.md) supersedes proposals and unresolved choices below. Retained for rationale and traceability.

## Native application

**Agreed:** follow current iOS 27 and iPhone Duo guidance, standard native components, appropriate Liquid Glass, and purposeful animations. Support both displays, themes, accent colors, configurable statistics, and widgets.

**Proposed first-party foundation:** SwiftUI, Swift Charts, WidgetKit, App Intents, CloudKit, AuthenticationServices, DeviceCheck/App Attest, UserNotifications, and StoreKit. Exact deployment target, persistence layer, architecture, and Xcode version remain undecided.

Library candidates researched, not adopted:

- Swift Snapshot Testing for visual regression checks.
- Swift Dependencies for deterministic clocks, service responses, and authentication fixtures.

Use Swift Package Manager and pinned dependency resolution. Check maintenance, licensing, compatibility, and actual need before adding packages. Native animation is the default; no third-party UI/animation framework has been selected.

## Quality and independent review

**Agreed:** meaningful CI checks and an independent agent reviewing the actual UI against the intended design.

Proposed review gates:

- Both display layouts and transitions, supported appearances, and accent variants.
- Dynamic Type, VoiceOver labels, contrast, Reduce Motion, and non-color-only status indicators.
- Guided setup including handoff, interruption, failure, and successful physical verification.
- Empty, offline, loading, error, syncing, and pending-reset states.
- Widgets, leaderboard history, podiums, settings, and export/reset flows.
- Localized layouts, especially long text and narrow display conditions.

The independent reviewer should inspect screenshots and recordings, identify actionable deviations, and re-review fixes. This review has not yet run. Define the design brief before implementation so review is against concrete criteria.

## GitHub CI — required outcome, proposed job design

- PR checks: build, formatting/linting, core tests, backend tests, localization completeness, infrastructure validation, and relevant UI snapshots.
- Domain tests: duplicate/out-of-order events, session pairing, midnight/DST, stale sync after reset, offline uploads, ties, bans, period finalization, and idempotent notifications.
- Security tests: rejected invalid authentication/attestation, replayed submissions, unauthorized admin access, and production rejection of development fixtures.
- UI automation: setup state machine, navigation, settings, and screenshot scenarios. Real-device trigger tests remain a separate gate.
- Use deterministic fixtures and fixed clocks for screenshots and tests.
- Pin toolchain/dependencies and verify the runner supports the required SDK and simulator.
- Keep production secrets away from untrusted pull-request code.
- Archive failures and reviewable screenshot differences as CI artifacts.

Separate development and production data, keys, Cloudflare resources, and competition identities. Allow development fixtures for routine work; test real authentication, purchases, and App Attest on supported devices/TestFlight before release. TestFlight App Attest environment handling must follow Apple's distribution rules.

## Infrastructure as code

**Agreed:** Cloudflare infrastructure configuration lives in the repository; provision staging and production reproducibly. An admin subdomain is desired. The owner subsequently purchased getfolding.app; current provisioning work is described in the delivery plan.

**Proposed:** Terraform/OpenTofu for supported infrastructure resources plus versioned Worker deployment configuration and database migrations. Select runtime/storage/scheduler/queue services after defining workload, privacy, and costs. Keep credentials and sensitive state out of Git. Plan rollback, database recovery, logs, and cost alerts.

No infrastructure has been provisioned and no monthly budget is agreed.

## App Store and release automation

**Agreed:** maintain listing content and release automation in the repository using fastlane where supported. Generate screenshots from the app on GitHub releases. Automatically publish after Apple approves.

Repository-owned assets/configuration:

- Localized names, subtitles, descriptions, keywords, release notes, and screenshot captions.
- Review instructions and relevant support/privacy URLs and disclosures.
- Screenshot UI tests, deterministic demo fixtures, and reproducible presentation templates if marketing frames are used.
- Fastlane lanes, GitHub workflows, signing setup instructions, and release versioning rules.
- Tip product definitions/configuration where API/tool support permits.

Proposed pipeline:

1. Select a tagged, validated release commit and assign version/build numbers.
2. Run release checks and generate current localized screenshots across required device configurations.
3. Package screenshot previews and outputs as GitHub artifacts/release assets; source and generation configuration remain in Git.
4. Archive/sign the app and upload to TestFlight.
5. Upload the matching listing and screenshots, submit the intended build for review, and configure automatic release after approval.
6. Preserve commit, build, metadata, screenshot, and submission provenance.

Use fastlane snapshot for capture, deliver for listing/upload/submission, and suitable signing/TestFlight actions after configuration. Do not assume every App Store field is supported by fastlane: use official APIs or document unavoidable manual steps.

Developer enrollment, agreements, credentials, product/account configuration, and Apple's review decision require external setup or action. Verify required screenshot sizes and Duo simulator support before committing a capture matrix. A release must not silently upload stale screenshots if generation fails.

## Localization pipeline

The accepted launch set is in product-requirements.md. Maintain String Catalogs, translator context, and a glossary. AI can draft translations; validate terminology, placeholders, plurals, local formatting, and actual system labels.

Generate both in-app screenshots and App Store localized assets from the same release. Add missing-string and placeholder checks to CI, plus layout checks in each launch language. Stage server notifications using localization keys/arguments or an equivalent versioned approach that respects the user's app language.
