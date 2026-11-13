# Minimum supported iOS build

Owner decision, November 8, 2026: once a confirmed minimum exceeds the installed build, replace the **entire app UI** with an update screen. This supersedes the earlier rule that release handshakes never disable private UI. Saved history and background observations are not erased; an update requirement must not turn queued uploads into terminal failures. This is compatibility management, not proof of the caller's installed binary.

## Wire policy

- `GET /v1/client-policy` is public and returns `{minimum_ios_build: integer, request_id: UUID}` with `Cache-Control: no-store`. It remains reachable by unsupported clients.
- Operations (`/admin/config`) owns the minimum build in the singleton administrative configuration row. Values are integers from 0 through 2,147,483,647; 0 disables enforcement. Access authentication, CSRF, expected revision, idempotent operation IDs and before/after audit records protect changes. There is no deployment-variable override. Migration 0020 defaults the value to 0.
- Public policy and business enforcement share a 60-second isolate cache of the database value. Successful admin saves invalidate the handling isolate immediately; other isolates refresh within one minute. Failures are never cached or used to extend an expired value; unavailable/invalid policy fails closed for business endpoints. Recovery exemptions still bypass policy loading.
- App requests send `X-Folding-Build`, using monotonically increasing integer `CFBundleVersion`, not the marketing version string. These headers are client-asserted and never replace authentication/App Attest.
- With an active minimum, missing/malformed/older headers receive HTTP 426 `{code: "app_update_required", request_id, retryable: true, retry_after_seconds: 3600, minimum_ios_build}` and `X-Folding-Minimum-Build`, before reading the request body or opening business/account data (a cache miss reads the shared policy row). `Retry-After: 3600` preserves older uploaders’ queued data instead of triggering their terminal-error path; retryability also permits a policy rollback. The API still rejects unsupported builds. The existing network burst controls still run first.
- Policy, health/capabilities, authentication, leave/delete, deletion status and avatar/push removal retain their small stable recovery/privacy contracts. The server can retire older **business** APIs; this does not authorize removing privacy recovery without a replacement.

## Client behavior

The composition root checks policy on launch and foreground, at most once per 15 minutes. A 426 from a business request also updates the cached requirement. All checks use the configured environment's fixed HTTPS origin. The policy supplies neither arbitrary display text nor a remote destination URL.

A confirmed minimum is persisted per environment and survives cold/offline launch and sign-out. A failed or malformed check cannot clear it. Installing a build at or above the cached floor immediately removes the cached gate; a successful policy response can lower the floor for rollback. With no known requirement, network failure leaves the app UI available: an unseen server decision cannot be enforced offline.

The update screen replaces the root rather than stacking a dismissible sheet, so navigation/deep links cannot dismiss it. It offers a single requirement heading, Update and external support, without a manual recheck or repeated explanatory copy. App Store destination is the registered Folding app ID 6832059501; sandbox-receipt/TestFlight and staging installs use the public TestFlight landing page. Verify that the device opens the expected update destination before enabling a floor. The updated translations are drafts under existing localization QA rules.

Background upload errors with `app_update_required` retain their operation/event data and retry later; they do not permanently suspend competition. Local recording and iCloud replication are independent of this UI policy. Offline cold startup follows the separate account-witness contract in storage-and-tracking.md and #57; update-policy tests do not establish account/device acceptance.

## Activation and rollback

1. Apply migration 0020 and deploy the compatible policy endpoint. Its persisted minimum defaults to 0, so existing clients remain allowed.
2. Ship the policy-aware app through the existing Fastlane process. Keep old/current API compatibility during store processing. Builds that predate the gate cannot display the new screen; HTTP 426 only stops their business API calls.
3. Only after an installable, compatible replacement exists, open Operations, set Minimum build to its build number, provide a reason and Save. Validate staging first and verify the public policy readback after cache propagation. No redeploy is needed. Never set a floor higher than the available replacement or require a version unsupported on the user's device without a retirement plan.
4. To recover from a mistaken floor, lower Minimum build or set `0` in Operations; affected clients recover on their next successful check. Offline clients with a known requirement remain blocked until they reconnect or install a supported build.

The minimum is intentionally disabled by default. Provider activation, a new TestFlight build and post-submission device acceptance are not established by local tests or a Git push.

## Build observability

All app transport requests, avatar reads and policy checks send `X-Folding-Build` from `CFBundleVersion`. Request logs emit an object-valued `client_build` numeric field alongside route/status/backend version. Missing, malformed and out-of-range values become null; arbitrary header text, bearer tokens and histories are never logged. The value is self-reported compatibility metadata, not attested proof of a binary. Marketing version strings are not sent separately; map builds to the release manifests when needed. Generated configuration samples 10% of invocations, so version/endpoint breakdowns are sampled estimates, not exact per-user counts. Logging requires the updated Worker/config to be deployed.
