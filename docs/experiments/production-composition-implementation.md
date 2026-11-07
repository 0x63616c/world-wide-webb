# Production composition — 2026-11-07

Replaced the blanket Release compile error with a fail-closed runtime configuration boundary. The existing `CloudTrackingConnection`, account-partition router, private mirror and competition transport remain the single production composition; no second journal or transport builder was introduced.

`ProductionConfiguration` accepts only the registered production or staging app identifier, matching App Group/container, exact HTTPS API origin and complete Apple signing-environment tuple. Distribution uses `Production` CloudKit and `production` App Attest/APNs, including the staging TestFlight app. Debug device builds may use the coherent development tuple. Missing or partial configuration throws through the existing unavailable UI state.

The isolated `FoldingDevelopment` journal is compiled only for an all-unconfigured Debug simulator. It cannot be selected by a Release/device build, by a cloud/account/network failure, or by a partially configured Debug build. A verified no-iCloud-account state can still use the normal private local partition through the account router; unresolved account identity pauses rather than guessing. Existing account-transition fencing and clearing behavior is preserved.

The device screenshot-launch-argument rejection remains. Screenshot fixtures remain in their isolated simulator target. Fastlane's archive inspection now checks the runtime App Group/container and all distribution Info values against the signed identities, and rejects a development-storage/fixture marker in the device executable.

Only compilation is being checked in this implementation batch. Signed archive execution, real CloudKit account transitions, App Attest and physical device behavior remain final-validation/F13 work; no successful simulator compile is evidence of those outcomes.

Evidence: regenerated Xcode project, then the complete `Folding` scheme built successfully in Release for the generic iOS simulator destination (both simulator architectures), including the concurrent transfer integration. Build log: `/tmp/folding-release-composition-build.log`. Ruby syntax checks passed for the updated release helpers. No UI/device test or signed archive was run. The confirmed public Apple Team ID `X9E4HG27NK` is now pinned in release configuration and its hash; an environment override must match.
