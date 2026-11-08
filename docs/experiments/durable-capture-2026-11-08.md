# Durable capture and persistent retries — November 8, 2026

Deliverable: [#59](https://github.com/0x63616c/folding/issues/59), under F02/#3. Scope is implementation, local verification and a reviewable PR. Merge and shipping are separate; no provider deployment, TestFlight upload or App Store submission was performed.

## Behavior

Shortcuts acknowledge an immutable observation saved in the protected account-partitioned journal before cloud initialization or derived maintenance. The schema v9 inbox binds source sequence, observation time/timezone, generation, competition epoch and setup-test status in one transaction. Persisted FIFO leases/backoff allow recovery after process death. Canonical event/outbox commit and idempotent daily notification evaluation precede inbox acknowledgement. Reset removes pending captures atomically; account authority and installation quarantine prevent replay into another history. No missed observations or public eligibility are fabricated.

## Local evidence

- All **105 core tests** pass, including 16 capture tests. Coverage includes actual child-process SIGKILL after capture commit and after canonical commit before acknowledgement, reopen with original facts, outbox deduplication, two independent writer handles, lease expiry/token ownership, clock rollback, persisted FIFO backoff, rollback under an injected SQLite abort, setup attribution, reset, account fencing, installation quarantine, conflicting import quarantine, competition epoch eligibility and schema 8 migration.
- All **43 app-hosted simulator tests** pass. Runtime coverage includes durable acknowledgement while the FIFO head is leased, reopening a fresh runtime to replay, and draining more than one bounded batch. Existing account switching, setup, notifications and storage protection tests remain passing.
- Final native invocation: `xcodebuild ... -scheme Folding -configuration Debug -destination platform=iOS\ Simulator,id=<temporary-device> -parallel-testing-enabled NO build test`, using iOS 27.2 Duo simulator. Local results: ignored `build/capture-tests/native-final.xcresult` and `native-final.log`. The temporary simulator was terminated, shut down and deleted; pre-existing review devices were preserved. Simulator boot reported a migration warning despite the test suite succeeding; this is not device evidence.
- Required repository checks cover contracts, localization, generated icons, Swift formatting, infrastructure formatting and the full core suite. No hosted CI or live provider acceptance is claimed.

## Rollout and limits

Schema v9 cannot be opened by the currently shipped schema-v8 binary. Rollback requires a compatible forward-fix build; never erase or downgrade the journal. This task changed only test databases, not an installed user's journal.

A capture needs available protected storage and a valid persisted account fence. It cannot recover observations never delivered by Shortcuts or promise background execution during suspension. Offline foreground account resolution remains #57. Physical locked/terminated/restart/overnight Shortcuts acceptance remains deferred to #47/F13 after submission. Broader runtime integration (#27) and release (#43) remain open.
