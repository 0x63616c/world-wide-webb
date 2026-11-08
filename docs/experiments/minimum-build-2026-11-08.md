# Minimum supported app build — November 8, 2026

Local implementation scope: #56, under F12/#12. The owner explicitly selected a whole-app required-update screen. The deployment default remains `MINIMUM_IOS_BUILD=0`; no provider setting, production minimum, App Store submission or TestFlight distribution was changed by this work.

## Behavior

- Public policy endpoint with bounded integer build floor; authenticated business requests carry their installed build. Old/missing/malformed builds receive HTTP 426 before body/D1 work when enforcement is enabled.
- Stable authentication/privacy recovery remains available. The build header is compatibility metadata, not authentication or an anti-abuse proof.
- Whole-root update screen, per-environment cached requirement, 15-minute foreground checking and explicit retry. Unknown policy failures leave UI available; confirmed requirements persist offline. Supported new builds and successful lower-floor policy responses recover access. A stale in-flight policy response cannot clear a newer requirement.
- Fixed App Store/TestFlight destinations, six new strings in all ten locales (translations remain subject to existing localization QA), and external support access.
- Both older uploaders and the new client retain pending observations during retirement: 426 carries a one-hour retry hint, and the new uploader explicitly avoids terminal suspension.

## Local evidence

- Backend check: six domain-contract plus 25 Worker tests; native/Wasm Clippy with warnings denied, formatting, packaged Wasm and 11 workerd/D1 tests pass. The new runtime test covers policy/default-zero behavior, old/missing/malformed/current build handling, rejection before oversized-body processing and privacy recovery exemption.
- Schema validation: 13 schemas and 61 checks, including positive/error policy examples and invalid floor values.
- Configuration regeneration tests cover disabled default, explicit positive floor, rejection of negative configuration and preservation of feature gates.
- Focused app-hosted simulator suites: eight tests pass, covering unknown-policy failure, persisted requirement/offline restart, supported new builds, rollback, environment isolation, malformed policy, request build headers, JSON/image update signals and retention of pending uploads, alongside prior cooldown/cache/session tests.
- Full personal-core checks are run against a clean checkout of the implementing source; logs and simulator results are under ignored `build/update-*`.

## Outstanding

Provider deployment/default-zero policy readback and policy-aware TestFlight distribution are release acceptance in #43/#55. Raising the minimum requires a compatible replacement actually available to install; verify the chosen update destination and platform support first. Existing visual/localization/native-speaker and #47/F13 physical-device checks remain deferred, not passed.

Offline is a separate concern: stored observations and warm local reads do not establish reliable offline cold startup. The current iCloud identity check before reopening the journal is tracked in #57. This feature intentionally does not reopen unverified account history to hide that problem.
