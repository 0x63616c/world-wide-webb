# FoldingKit

The first implemented target, `FoldingDomain`, replays immutable observations into fold counts and sessions. It has no UI, database or network dependency. App Group persistence, private CloudKit replication, calendar summaries and app integration remain pending.

Run from the repository root:

```sh
swift test --package-path apps/ios/Packages/FoldingKit
```

The test target consumes the canonical repository fixtures directly and checks both original and reversed arrival order. Keep the package in the monorepo so those fixtures remain available. Tests also cover conflicting identities/sequences, device separation, reset exclusion/ordering, invalid numeric ranges and canonical JSON encoding.

`TrackingReducer.reduce` takes the selected reset generation explicitly. It never stitches sessions across devices. Its input must be the retained replay stream, including interruption markers; pre-filtering the stream to a calendar day can change interpretation. Private-transfer inclusion and calendar allocation are separate pending domain operations. Equivalent travel is a formula (180 degrees, 0.1 m radius per fold), not a sensor measurement.
