# Private CloudKit schema

Apple-generated Development exports, bootstrap receipts and hashed manifests are sealed under `schemas/production/v1`. Exact matching Production exports and verification receipts are under `readbacks/production/v1`. Generate future versions from Apple's initialized development environment; do not handwrite Core Data's `CD_` records or internal fields. This directory is for reviewed immutable schema exports/receipts, not records, credentials or private database dumps.

The app has four mirror entities: `ReplicatedEvent`, `ResetMarker`, `TrackingInterruption`, `TransferMarker`. All attributes remain optional. There are no CloudKit uniqueness constraints. Transfer-conflict tombstones share the existing transfer entity. Generation fields exist on events/interruption records only; payload remains authoritative. `logicalIDIndex` and `generationIndex` are **local Core Data** fetch indexes. The app does not query user-defined fields directly in CloudKit, so no speculative remote QUERYABLE/SORTABLE indexes are added. Preserve Apple's generated mirroring/system indexes in the full exported schema.

## Prerequisites

Primary agent only: use the existing persistent credential session. CloudKit management authentication is separate from the App Store Connect API key. `cktool` reads `CLOUDKIT_MANAGEMENT_TOKEN` from that session or its supported Mac Keychain store; never use `--token`, a command literal, or a committed token file. Store recovery credentials in 1Password through the primary agent.

- Team `X9E4HG27NK`; registered container/bundle associations and iCloud capability.
- An iCloud test account signed into the development simulator/device. Account status must be available.
- Development-signing access for a device bootstrap if simulator CloudKit access is unavailable.
- CloudKit Console management token for export/validation/import, and administrator privilege for production promotion.
- Pinned Xcode and `cktool 1.0.23001`.

Only `iCloud.app.getfolding.Folding` is supported. Its Apple Development and Production environments remain distinct. Bootstrap Development, then promote its schema before distribution builds use Production. The staging app is removed; Apple does not support deleting existing container identifiers.

## Initialize the exact compiled model

Commit the app/model changes first. Build-only lane:

```sh
bundle exec fastlane ios schema_bootstrap_build environment:production
```

The production-container development build uses `environment:production`. This lane does not run the app or initialize CloudKit. It supplies the exact committed source SHA and coherent Development environment values, then builds Debug with an opt-in simulator CloudKit entitlement file. Normal simulator signing stays unchanged. Actual live iCloud access with those simulator entitlements must be confirmed; build success is insufficient.

On a dedicated simulator already signed into the test iCloud account, install the resulting `build/cloudkit-bootstrap/<target>/Build/Products/Debug-iphonesimulator/Folding.app`, then explicitly launch it with:

```text
--folding-initialize-cloudkit-schema
```

This mode bypasses the normal tracking, cloud-sync, purchases and competition tasks. It uses a disposable mirror store with the same compiled Core Data model. Initialization creates/removes Apple's representative records; it does not import a person's history. Successful completion writes `Documents/cloudkit-schema-bootstrap.json` inside the app sandbox. Copy that receipt using the simulator app-container path or Xcode's container download. It contains model attributes/indexes/version hashes, container, source commit and completion time, not private data.

If a device bootstrap is needed, build Debug with the corresponding Development profile and the same configuration values; the app's Info `FoldingSourceCommit` must be the exact clean commit SHA. Never use a distribution profile or alter the app's production entitlements to bypass the guard. The initializer and bootstrap UI are compiled out of Release. A CloudKit account failure is an error, not a local/offline success.

## Export, validate and retain

After copying the receipt, keep all generated output outside Git until the snapshot is complete:

```sh
python3 scripts/cloudkit-schema.py snapshot --target production \
  --receipt /absolute/path/cloudkit-schema-bootstrap.json \
  --output build/cloudkit/production-schema-v1
python3 scripts/cloudkit-schema.py validate --artifact build/cloudkit/production-schema-v1
```

The wrapper exports the complete Apple schema, rejects missing current fields, and writes `manifest.json` with schema format version, team/container, commit, exact model-source hashes, tool version and receipt/schema hashes. Snapshots cannot be overwritten. Copy the complete reviewed directory into `cloudkit/schemas/<target>/<version>/` and commit it. Never claim the local model descriptor is an exported Apple schema.

A deliberate development-only restore/import is available after validation:

```sh
python3 scripts/cloudkit-schema.py import-development --artifact cloudkit/schemas/production/v1
```

This wrapper intentionally has no `reset-schema` command and no production import. Do not reset an environment to make a migration pass. Production changes must be additive; retain old fields/types and reset/conflict tombstones.

## Promote and verify

After final schema review and development integration acceptance, the primary agent opens [CloudKit Console](https://icloud.developer.apple.com/) in the authorized browser, selects the exact team/container, chooses **Deploy Schema Changes**, inspects the additive changes and deploys. The installed `cktool` offers no documented production-deploy command. Promotion copies record types, fields and indexes, not user records.

Then obtain machine-readable readback:

```sh
python3 scripts/cloudkit-schema.py verify-production \
  --artifact cloudkit/schemas/production/v1 \
  --output build/cloudkit/production-production-readback-v1
```

This exports the actual Production schema and compares tokens against the sealed Development export, ignoring only whitespace/comments. Differences stop confirmation, including ordering differences: inspect an explicit diff instead of weakening the gate silently. Retain the export and `verification.json` alongside the release evidence. Repeat for the production container.

A matching schema is not sync acceptance. Final integration still requires actual save/import/reset/transfer/account-change convergence in the right container. Promotion/readback must finish before TestFlight distribution relies on private iCloud sync.

## Sources

- [Apple: Core Data model initialization and production evolution](https://developer.apple.com/documentation/coredata/creating-a-core-data-model-for-cloudkit)
- [Apple: textual schema workflow](https://developer.apple.com/documentation/cloudkit/integrating-a-text-based-schema-into-your-workflow)
- [Apple: production schema deployment and administrator role](https://developer.apple.com/documentation/cloudkit/deploying-an-icloud-container-s-schema)
- [Apple: cktool authentication and development commands](https://developer.apple.com/icloud/ck-tool/)

Installed command help was inspected on November 7, 2026. The primary agent created the management token, initialized both Development containers, sealed/validated their exports, promoted both schemas in Console and verified exact Production readback that day. Live record sync acceptance remains pending; see `docs/experiments/live-integration-2026-11-07.md`.
