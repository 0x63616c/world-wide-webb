# Remaining coding backlog: local completion evidence

November 7, 2026. Scope is the owner's replacement coding goal. Provider setup, deployment, publishing, visual acceptance and physical-device checks remain in [deferred shipping work](../deferred-shipping-work.md).

## Delivered

- Persist exact App Attest enrollment proof/operation before sending; replay after response loss, replace invalid keys, fence cleared sessions and retry authentication once.
- Suspend private account access and clear personal presentation before remote cleanup; invalidate stale history, auth/profile and transport responses.
- Preserve typed upload failures and retry guidance; durable backoff, stale epoch reconciliation, wait for authoritative private reset markers, and permanent/restricted suspension.
- Register `folding` URL scheme and allowlist the two URLs emitted by widgets; preserve setup while selecting the destination.
- Use effective app localization for notifications with English fallback.
- Atomically purge reset raw observations while retaining operation receipts and generation fences.
- Allow audited automatic-quarantine approval with generation, enrollment/device, setup, timing and ordering checks. Historical awards still require explicit corrections.
- Capture named local release checks with source/command/output binding; verify exact workflow/job for supported CI evidence.
- Prepare/read back the app and three tip versions in one Apple review submission. Observe ambiguous submission attempts instead of resubmitting.
- Audit signing-only retries; ambiguous archive attempts require a fresh globally reserved build number and retain retired outputs.
- Preserve reviewed deployment readiness through an explicit source/bindings/evidence-bound overlay; bootstrap remains disabled.
- Seal asset candidates with all manifest hashes and reject changed retry inputs.

## Executed validation

| Check | Result |
| --- | --- |
| Swift package suite | 74 tests passed; final suspension change also passed its focused persistence/reopen regression |
| iOS app-hosted simulator suite | 28 tests passed, including lost enrollment response/restart, stale session rejection, widget routing, locale fallback and stale history rejection |
| Generic iOS simulator build | Passed |
| Rust host suites | 28 tests passed, including quarantine eligibility boundaries |
| Pinned release Wasm Worker build | Passed |
| Local workerd/D1 runtime | 7 tests passed, including actual auth/session/queue-retention flows and atomic reset purge with receipt preservation |
| Ruby release regressions | 6 tests / 15 assertions passed: exact tip items, unrelated drafts, evidence tampering, named CI job mismatch, signing preparation retry, asset retry hashes |
| Deployment overlay regression | Passed: bootstrap disabled, repeat generation identical, changed evidence/version rejected |
| Contract validation | 12 schemas / 55 example checks passed |
| Localization validation | 215 semantic keys × 10 locales passed |

The simulator result bundle is `build/coding-validation/Logs/Test/Test-Folding-2026.11.07_12-44-45--0800.xcresult`. Build/test logs are local under `/tmp/folding-coding-*`; rerunnable checks and focused tests are committed. No local result asserts live Apple/Cloudflare acceptance. IAP review calls are modeled against the downloaded Apple OpenAPI specification and tested with synthetic responses; actual first-release submission/readback is deferred. The new signing replacement path preserves the existing requirement to hold the distribution concurrency lock.
