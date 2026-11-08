# Shortcuts partition-busy failure — November 8, 2026

Issue: [#58](https://github.com/0x63616c/folding/issues/58), under F05/#6;
related runtime #27, private-sync #29, suspension crash fix #54.

The owner reported an overnight **Log Duo Opened** failure displaying
`FoldingData.PartitionError error 3`. Bridging the actual enum identifies code 3
as `busy`; inactive/superseded account fences have different codes. The error
message alone cannot distinguish two busy paths. Both were reproduced locally:

- Eight simultaneous same-account connection requests: seven failed with the
  exact reported domain/code while the first request asynchronously loaded its
  mirror. The prior `reconciling` boolean rejected overlapping callers.
- The actual account-route lock held for 1.2 seconds: the runtime's recording
  entry failed at the one-second lock deadline and committed zero observations.

Build 10 protects storage locks against suspension, but did not coalesce opening
requests or retry this partition-level contention.

## Fix and boundaries

Verified requests for the same account now await one shared opening task and
receive the same journal. A different account cannot join that opening.
Invalidation fences the route first, cancels the pending task, changes its
revision, and prevents an older task from publishing over the new account.
One caller's cancellation does not cancel another caller's shared initialization.

Recording retries `PartitionError.busy` at most twice, with 150/300 ms waits
outside storage locks. The physical observation's UUID, timestamp and timezone
are captured once at entry. Once its journal/generation/competition context has
been acquired, that context is retained across retries. Account-revision checks
stop a retry across account change; stale generations and genuine filesystem or
protected-data failures are not converted to success. A persistent busy lock
still returns failure without acknowledging an unwritten observation.

No history is invented for the owner's earlier failed invocation. Local tests
cannot establish whether Shortcuts or a later real event recovered that attempt.

## Local verification

Before the fix, the targeted core command failed with seven occurrences of the
exact reported domain/code:

`swift test --package-path apps/ios/Packages/FoldingKit --filter simultaneousVerifiedAccountConnectionsShareTheOpeningJournal`

The pre-fix app-hosted suite also failed the brief-contention recording test:
`busy`, zero committed events instead of one. After the fix:

- All **89 core tests** pass, including shared opening, deterministic invalidation
  during mirror opening, and rejection of a concurrent different account.
- All **41 app-hosted simulator tests** pass, including the real UIKit storage
  provider, one committed fold with its original timestamp after a brief lock,
  account change during retry, and bounded failure without a committed event
  while a lock remains unavailable.
- Swift formatting and whitespace checks pass. The ordinary push hook also runs
  the required core, contract and localization checks before publication.

Evidence logs are ignored at `/tmp/folding-shortcut-*` and `build/shortcuts-busy/`.
Actual overnight, locked-Duo and physical Shortcuts confirmation remains deferred
under #47/F13. CI, storefront review and App Store submission remain deferred.

## Internal distribution

Fastlane signed, uploaded and distributed **0.1.10 (build 11)** from
`da0ac00aa2608686d847f5a1d1084b4b3a7c7a96`. Apple returned exact build
`a9dfa54a-0b2b-4d0e-aaa0-4e2d11b08dfe`, **VALID**, non-exempt encryption `false`.
Independent API readback verified that exact build in **Folding Internal**.
The manifest is revision 10, state `processed`. Signed archive, IPA,
dSYMs, manifest revisions and verification receipts are retained in the private
[release](https://github.com/0x63616c/folding/releases/tag/v0.1.10).
IPA SHA-256: `1547ec727e9c5eabb0f25b92f6d3aedc7982c362e7e64160ab3b96cf4d58bae5`.

Production configuration was read before the update and verified afterwards.
Only build 11 was added to the App Attest build allowlist, retaining builds 2–10,
all other bindings/settings and six secrets. The config-only Cloudflare version
is `1185681c-71b3-41e2-8e7c-77310df67ad3`; Worker source remains
`480725ecb2007c00669eb0e3ff6102eddb584566`, and production health passed.
No backend code, database schema, infrastructure or CloudKit state was changed.

#58 is complete for reproduction, code, stated local verification and internal
distribution. Actual overnight/locked-Duo/Shortcuts confirmation remains deferred
under #47/F13. No App Store submission or physical-device pass is claimed.
