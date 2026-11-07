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

## Capability configuration

Fastlane `ios configure_capabilities` successfully enabled and read back App
Groups, Push Notifications, iCloud (Xcode 6 compatible) and Sign in with Apple
(primary app) on both app identifiers. In-App Purchase was already enabled.
Both widget identifiers now have App Groups enabled. No existing services were
removed. Group/container registration and association still remain pending.

The App Attest creation request failed with `Spaceship::UnexpectedResponse`;
subsequent inventory showed App Groups had succeeded before that failure. The
lane now configures the supported services independently; App Attest remains an
explicit separate setup requirement, not silently considered enabled.

Apple account references were saved in the Folding vault as “Folding Apple
account references”. This references the existing team credential rather than
copying its secret material into another item.

## Match repository bootstrap

Created `https://github.com/0x63616c/folding-signing` and verified `isPrivate: true` using GitHub on November 7, 2026. This is the dedicated encrypted Fastlane match store; currently empty. Certificate/profile generation, encryption password recovery in 1Password and archive signing remain pending. Repository creation alone does not prove signing readiness.

## App Attest portal completion

Enabled App Attest for `app.getfolding.Folding` and `app.getfolding.Folding.Staging` through the already-authenticated Developer portal. Saved staging UI readback shows App Attest checked. Subsequent Fastlane/Spaceship inventory independently returns `APP_ATTEST` for both app bundle IDs. The portal explicitly identifies `X9E4HG27NK` as the Team ID. This verifies capability configuration only; device attestation remains deferred to the owner-approved physical checks. App Group and iCloud container associations, profiles/certificates and signed archive remain outstanding.

## Registered shared-storage identifiers

Created distinct identifiers through the Apple Developer portal:

| Environment | App Group | Apple resource ID | iCloud container | Apple resource ID |
| --- | --- | --- | --- | --- |
| Production | `group.app.getfolding.Folding` | `ND28K7SM46` | `iCloud.app.getfolding.Folding` | `3A2263A6Z8` |
| Staging | `group.app.getfolding.Folding.Staging` | `7D9MAABJ26` | `iCloud.app.getfolding.Folding.Staging` | `3M7HAWNTYF` |

Both app identifiers were assigned only their environment's group/container and saved. Both widget identifiers were also assigned their matching App Groups and saved; staging widget readback shows one enabled group. Final signed-profile inspection must confirm the corresponding entitlements. Registering a container does not deploy its CloudKit production schema or prove live sync.

## Distribution signing setup

`fastlane ios setup_signing` completed successfully on November 7. Match generated/imported distribution certificate `BT34CHX6H5`, created all four App Store profiles and pushed encrypted assets to private `0x63616c/folding-signing` at `85dcb487173509652d7ee9c9521df4a1e4b76716`. The temporary keychain was deleted. The setup helper parsed every resulting profile and checked exact bundle/team/App Group, plus each app's iCloud container, production App Attest permission and production APNs environment. This is profile validation, not a signed archive or physical-device pass.

Encryption-password recovery: Folding vault item `nwphu5b7fycuyloxgh6nw33bla`. The encrypted repository bundle is also stored in the vault as **Folding encrypted signing repository recovery**. Nonsecret profile inventory is generated at `build/signing/profile-inventory.json`.
