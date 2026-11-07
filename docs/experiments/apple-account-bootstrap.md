# Apple account bootstrap — November 7, 2026

## Verified state

Fastlane `ios register_bundles` registered four isolated identifiers. A subsequent
`ios apple_inventory` read confirmed both app records and all four identifiers
using the existing App Store Connect API key from 1Password.

| Environment | Store name | App Store ID | Bundle ID resource | Widget resource |
| --- | --- | --- | --- | --- |
| Production | Folding: Duo Fold Tracker | 6832059501 | JZ5YH676H5 | 8NMX786T84 |
| Staging | Folding Staging | 6832060416 | G6PGFZUAG5 | 7K238DP2K4 |

Bundle strings, SKUs and planned group/container names are recorded in
`fastlane/app-identifiers.json`. The returned bundle seed prefix is `X9E4HG27NK`;
this is not yet independent verification of the Developer membership team ID.

The plain store name “Folding” was unavailable. The production record uses the
previously agreed descriptor naming approach. Both records visibly show iOS 1.0
“Prepare for Submission”. They have no submitted build. Production currently has
automatic release after approval selected; release automation must verify this
again at submission. Staging is for TestFlight, never public submission.

Initial app records were created in the authorized App Store Connect browser
session because Fastlane's documented API-key support does not include `produce`.
Bundle registration and readback use Fastlane. This bootstrap exception does not
replace Fastlane signing, screenshots, metadata, upload or submission automation.

## Credential handling

The primary agent reused one persistent secret shell. The existing team key was
read from the Private vault's “App Store Connect API” item and its PEM attachment;
no new team key was created. Secret values are neither stored here nor written to
Fastlane artifacts. Request logging is disabled and debug/proxy overrides rejected
for these account lanes. Exceptions report only their class.

## Remaining acceptance

- Verify Developer team membership and capabilities.
- Register/associate the planned app groups and private CloudKit containers.
- Enable required iCloud, push, App Attest and Sign in with Apple capabilities.
- Create scoped signing recovery storage and readonly-match release configuration.
- Configure production and staging entitlements and CloudKit schemas.
- Build the actual production composition, validate signed archives and upload.
- Generate localized assets/listing; verify submission and publication separately.

No simulator result proves live CloudKit, device App Attest or physical tracking.

References: [Fastlane API-key support](https://docs.fastlane.tools/app-store-connect-api/),
[create_app_online](https://docs.fastlane.tools/actions/create_app_online/).
