# Minimum supported iOS build

Owner decision, November 8, 2026: once a confirmed minimum exceeds the installed build, replace the **entire app UI** with an update screen. This supersedes the earlier rule that release handshakes never disable private UI. Saved history and background observations are not erased; an update requirement must not turn queued uploads into terminal failures. This is compatibility management, not proof of the caller's installed binary.

## Wire policy

- `GET /v1/client-policy` is public and returns `{minimum_ios_build: integer, request_id: UUID}` with `Cache-Control: no-store`. It remains reachable by unsupported clients.
- `MINIMUM_IOS_BUILD` is a deployment-owned string representing an integer from 0 through 2,147,483,647. Omitted/0 disables enforcement; invalid configured values fail closed. The configuration generator accepts this optional field and preserves reviewed feature gates.
- App requests send `X-Folding-Build`, using monotonically increasing integer `CFBundleVersion`, not the marketing version string. These headers are client-asserted and never replace authentication/App Attest.
- With an active minimum, missing/malformed/older headers receive HTTP 426 `{code: "app_update_required", request_id, retryable: true, retry_after_seconds: 3600, minimum_ios_build}` and `X-Folding-Minimum-Build`, before reading the request body or opening D1. `Retry-After: 3600` preserves older uploaders’ queued data instead of triggering their terminal-error path; retryability also permits a policy rollback. The API still rejects unsupported builds. The existing network burst controls still run first.
- Policy, health/capabilities, authentication, leave/delete, deletion status and avatar/push removal retain their small stable recovery/privacy contracts. The server can retire older **business** APIs; this does not authorize removing privacy recovery without a replacement.

## Client behavior

The composition root checks policy on launch and foreground, at most once per 15 minutes; “Check again” forces a retry. A 426 from a business request also updates the cached requirement. All checks use the configured environment's fixed HTTPS origin. The policy supplies neither arbitrary display text nor a remote destination URL.

A confirmed minimum is persisted per environment and survives cold/offline launch and sign-out. A failed or malformed check cannot clear it. Installing a build at or above the cached floor immediately removes the cached gate; a successful policy response can lower the floor for rollback. With no known requirement, network failure leaves the app UI available: an unseen server decision cannot be enforced offline.

The update screen replaces the root rather than stacking a dismissible sheet, so navigation/deep links cannot dismiss it. It offers Update app, Check again and external support. App Store destination is the registered Folding app ID 6832059501; sandbox-receipt/TestFlight and staging installs use the public TestFlight landing page. Verify that the device opens the expected update destination before enabling a floor. The updated translations are drafts under existing localization QA rules.

Background upload errors with `app_update_required` retain their operation/event data and retry later; they do not permanently suspend competition. Local recording and iCloud replication are independent of this UI policy. Fully offline cold startup has a separate known account-identity dependency in #57 and must not be claimed verified by this feature.

## Activation and rollback

1. Deploy the compatible default-zero policy endpoint first; all existing clients remain allowed. No schema migration is needed for this policy feature (resource-protection migration 0019 remains a separate prerequisite for that Worker branch).
2. Ship the policy-aware app through the existing Fastlane process. Keep old/current API compatibility during store processing. Builds that predate the gate cannot display the new screen; HTTP 426 only stops their business API calls.
3. Only after an installable, compatible replacement exists, set `MINIMUM_IOS_BUILD` to its build number in the reviewed public deployment configuration and redeploy. Validate staging first, preserve current secrets/bindings/feature gates, and verify production readback. Never set a floor higher than the available replacement or require a version unsupported on the user's device without a retirement plan.
4. To recover from a mistaken floor, lower it or set `0` and redeploy; affected clients recover on their next successful check. Offline clients with a known requirement remain blocked until they reconnect or install a supported build.

The minimum is intentionally disabled by default. Provider activation, a new TestFlight build and post-submission device acceptance are not established by local tests or a Git push.
