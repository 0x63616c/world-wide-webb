# FoldingKit

`FoldingDomain` replays immutable observations into fold counts and sessions without UI, database or network dependencies. `FoldingData` now owns the transactional SQLite journal, setup leases, reset/import handling and mirror-work leases. Private CloudKit transport, calendar summaries, transfer policy, export and app integration remain pending.

Run from the repository root:

```sh
swift test --package-path apps/ios/Packages/FoldingKit
```

The test target consumes the canonical repository fixtures directly and checks both original and reversed arrival order. Keep the package in the monorepo so those fixtures remain available. Tests also cover conflicting identities/sequences, device separation, reset exclusion/ordering, invalid numeric ranges and canonical JSON encoding.

`TrackingReducer.reduce` takes the selected reset generation explicitly. It never stitches sessions across devices. Its input must be the retained replay stream, including interruption markers; pre-filtering the stream to a calendar day can change interpretation. Private-transfer inclusion and calendar allocation are separate pending domain operations. Equivalent travel is a formula (180 degrees, 0.1 m radius per fold), not a sensor measurement.

## Journal integration

Resolve one installation identity with `InstallationIdentity.loadOrCreate(service:accessGroup:directory:)` using the app's entitled shared Keychain group and a dedicated App Group identity directory. This directory is excluded from backup; it must be shared by app and intents and separate from account-partitioned journals. Pass that identity to `TrackingStore(directory:installationID:)`. The Keychain item is device-only; the local sentinel distinguishes reinstall from a normal launch. Restoring a journal under a new installation retires the old session, starts a new source sequence and clears its public grant. Retired open handles reject writes. Real entitlement/backup/locked-device tests remain deferred.

Initialize the store off the main actor. Each private iCloud account namespace gets its own journal directory. The future account coordinator must close/discard old handles when switching account partitions; a directory path is not an authentication boundary by itself.

Capture an `Observation` once, including the current generation and epoch, and preserve it for retries. A stale generation fails instead of resurrecting cleared data. After confirmed server enrollment, persist its epoch with `setCompetitionEpoch`; leaving clears it. Recording creates public work only when the captured epoch still matches durable enrollment. Importing private data never creates public event work.

Capture `interruption(reason:nowMS:)` once, then call `recordInterruption` with the same immutable marker across retries. Ordinary app launch must not manufacture an interruption. Adopt remote reset markers before their associated event batch. The greatest reset wins and, if enrolled, carries a durable public-reset obligation.

Mirror workers lease bounded batches and acknowledge only after a local mirror save. The lease token fences expired workers. `mirrored_locally` does not certify cloud upload or convergence. CloudKit history batching, conflict quarantine and checkpoints remain to be implemented before this becomes a functioning sync service.

`FoldingJournalProbe` is a local test executable, never an app/widget dependency. The two-process test exercises the actual public recording interface. Additional integration tests cover write rollback, reopening, setup consumption/expiry, reset races, restored interruptions and stale lease acknowledgments. Summaries currently replay retained rows within a read transaction; caches/paging are still needed for large histories.
