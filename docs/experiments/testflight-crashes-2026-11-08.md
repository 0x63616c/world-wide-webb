# TestFlight storage suspension crashes — November 8, 2026

Issue: [#54](https://github.com/0x63616c/folding/issues/54), under F11/#12.

## Reports and diagnosis

Apple's App Store Connect API returned three crash-feedback submissions, with no
next page, for production builds 2 (0.1.1), 6 (0.1.5) and 8 (0.1.7). All three
report `EXC_CRASH (SIGKILL)` and `RUNNINGBOARD 0xdead10cc`. Build 9 (0.1.8)
was the latest processed build at investigation time. Raw logs and feedback are
kept in ignored local evidence, without committing tester information.

[Apple's termination-code reference](https://developer.apple.com/documentation/xcode/sigkill)
defines this signature as suspension while holding a file or SQLite lock.
Application frames place journal access in screen refresh (build 2), private
synchronization (build 6), and widget analytics following synchronization (build
8). Several system-library frames have visibly incorrect application symbol
names; diagnosis uses the termination code and application-image frames rather
than treating those system frames as reliable symbolication.

The screen refresh's existing background task covered only that call path.
Other callers could acquire the partition flock or SQLite lock without execution
protection. Shortcuts, sync, widget publishing, account routing and installation
identity all share these storage boundaries.

## Change

The data layer acquires a process-supplied execution lease before its synchronous
storage operations. Nested statements reuse that lease. It remains active through
statement finalization, COMMIT/ROLLBACK and file-lock release, without spanning
network requests or actor suspension. The app registers its UIKit provider when
launch finishes, and Shortcuts register it before recording.

UIKit assertion acquisition runs on the main thread, before any storage lock is
held. In the normal-launch regression, acquisition from actor executors returned
invalid identifiers; main-thread acquisition returned valid identifiers and the
app reached setup. Invalid requests refuse new storage work. Expiration cancels
new statements and interrupts executing SQLite VMs; transaction cleanup can still
roll back before ending the assertion. Closing an idle SQLite connection cannot
start an unprotected checkpoint or delete WAL files. The small C bridge exposes
SQLite's existing variadic configuration API to Swift; it adds no database schema.

Foreground upload polling stops when the scene becomes inactive, and overlapping
private-sync calls coalesce. Account-change fencing and authoritative Shortcuts
recording remain available; local history is not replaced or reset.

## Verification

- The focused regression command was run before protection was wired in:
  `swift test --package-path apps/ios/Packages/FoldingKit --filter 'databaseLocksHaveExecutionProtectionOutsideScreenRefresh|partitionLocksAreProtectedBeforeReadingTheRoute'`.
  Both tests failed, exposing unprotected SQLite read/write transactions and a
  route lock acquired despite a denied execution lease. With the fix they pass.
- Seven storage regressions cover read/write protection, denied access before
  opening files, expiration after an insert with rollback/retry, refusal of later
  statements, interruption of an executing recursive SQL query, and assertion
  lifetime through partition unlock.
- All 86 core tests passed, including existing two-process recording, private
  sync, reset, deletion and 100,000-event tests.
- Contract validation: 14 schemas and 62 fixture checks passed. Localization:
  207 keys across ten locales, plus ten localization checks, passed. Swift
  formatting and whitespace checks passed.
- All 38 app-hosted simulator tests passed. Verification includes the actual UIKit provider on actor storage
  calls, plus injected grant/denial/expiration tests. These tests verify assertion
  behavior; they do not reproduce an actual device suspension termination.

Local logs are ignored under `build/` or `/tmp/folding-crash-*`. Temporary
`[DEBUG-crash-54]` probes were removed before release.

Physical Duo suspension/Shortcuts confirmation remains deferred under #47/F13.
No physical crash-resolution or push/account-sync acceptance is claimed. CI,
storefront review and App Store submission remain deferred.
