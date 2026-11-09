# CloudKit schema tooling implementation — 2026-11-07

Added a DEBUG-only Core Data schema initialization seam and explicit app bootstrap launch mode. It validates Development runtime configuration and a committed source identity, requires an available iCloud account, uses an isolated disposable mirror, bypasses normal tracking tasks and emits a compiled-model receipt. Release contains neither initializer nor bootstrap UI.

Added local logical-ID fetch indexes while retaining optional attributes and generation indexes; no new entity, unique constraint, raw-payload format or destructive migration. Core Data remains responsible for its remote schema and mirroring indexes. The actual additive index migration still needs final validation.

Added `schema_bootstrap_build` (build-only) and a restricted `cktool` wrapper for immutable development export, validation, development import and production readback. Production promotion remains the documented CloudKit Console administrator action; no undocumented production-import API or schema reset is used. Source/model/container/hash fences prevent promoting a stale or mismatched artifact. No actual Apple schema file is fabricated or committed.

Implementation-only evidence: Python syntax/help, Ruby syntax, plist lint. Regenerated combined Debug simulator build succeeded (`/tmp/folding-schema-comparison-build.log`), including the bootstrap view, initializer, model descriptor and updated project configuration. Live bootstrap, exported schema, migration, token authentication, Console promotion and real private sync remain unverified. The normal simulator has synthetic development entitlements; opt-in bootstrap simulator entitlements have been provided, but live iCloud acceptance is still required and may require a signed Debug device bootstrap.

The primary agent separately requested a `setup_signing` Fastlane lane; it delegates to the primary-owned `FoldingAppleAccount.bootstrap_signing(context:)` helper. No signing/authenticated operation ran in this batch.

See [CloudKit runbook](../../cloudkit/README.md).
