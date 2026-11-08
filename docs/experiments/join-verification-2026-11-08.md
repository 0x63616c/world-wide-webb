# Join assertion verification — November 8, 2026

The owner reported `Unable to continue … (unauthorized)` after Apple sign-in and tapping Join in the TestFlight profile flow (reported version 0.1.8). After the owner-authorized signup reset, production aggregate readback showed a new active/not-joined account, one unrevoked production App Attest key at counter zero, one successful sign-in, one session refresh and two unused Join challenges correctly bound to that session/device/key. There was no joined epoch. This places the failure after fresh Apple sign-in/key enrollment and before committed Join; it does not establish the exact device assertion contents.

Apple documents different extension names for key attestations (`apple_validation_category_01`, `apple_bundle_version_01`) and subsequent assertions (`validationCategory`, `bundleVersion`): [Validating apps that connect to your server](https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server). The implementation reused the enrollment names for assertions. A signed Join assertion using the documented assertion names reproduced rejection in `verify_assertion_with_policy`: `Err(WrongApplication)` instead of `Ok(1)`.

The fix parses the two formats separately, requires assertion extension flags and metadata, accepts the category as a UInt32 CBOR integer or four little-endian bytes, and retains the same distribution/build allowlist. No missing-metadata fallback, App Attest bypass or plaintext proof logging was added. A structured rejection event records only the verifier error enum and fixed request purpose; the client continues to receive a generic unauthorized response.

Local verification:

- The regression failed before the fix and passed afterward.
- `scripts/check-backend` passed: seven domain contract tests, 24 Worker unit tests and nine compiled Worker/runtime tests. The new full HTTP Join test independently signs its request using Node crypto, obtains a real local Worker challenge, confirms tampered-body rejection without counter advancement, succeeds with the original body and documented metadata, and rejects replay.
- The existing historical Apple device vector and independent CryptoKit signature fixture passed. The new modern-metadata fixture is synthetic; it is not owner-device proof.

Production deployment is prepared from the exact currently deployed source `480725ecb2007c00669eb0e3ff6102eddb584566`, preserving its API behavior and existing D1 migration lineage. This intentionally excludes unrelated resource-protection/minimum-build work from other branches. Current provider settings accept builds 2–11 and use production App Attest. No account, personal journal or CloudKit changes are part of this fix.

The owner must retry Join after deployment. Keep #33 live Join acceptance open until a joined epoch and accepted assertion counter are verified. Internal TestFlight distribution, storefront review, App Store submission and deferred physical-device checks retain their existing statuses.
