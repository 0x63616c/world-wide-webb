# ADR 0002: Atomic local journal with private iCloud replication

Date: November 7, 2026. Status: selected implementation default; prove in work order F02.

## Context

An app, App Intent, and sync importer may write concurrently. Event identity, source sequence, reducer state, test-lease consumption, and outgoing work must commit together. A Swift actor serializes callers inside one process; it does not make separate processes share a lock. The earlier Core Data recommendation did not specify this mechanism. CloudKit-backed Core Data cannot rely on unique constraints for event deduplication.

## Decision

Use Apple's system SQLite3 in the App Group for the authoritative journal, with WAL, foreign keys, a bounded busy timeout, and `BEGIN IMMEDIATE` write transactions. Use `NSPersistentCloudKitContainer` as an asynchronous private replication mirror of immutable events/control markers. Views and widgets read journal-derived snapshots only. No one edits Core Data's underlying SQLite files.

The journal transaction records replication work. The mirror worker writes it later; incoming mirror records re-enter the journal through idempotent import. There is no claimed atomic transaction spanning both stores. Replaying work after a crash is safe. Mirror duplicates are reconciled by application event ID and immutable-content comparison.

This refines the previous “Core Data with CloudKit” recommendation while preserving private iCloud sync, offline operation, and the two-target Swift package. The additional storage mechanism is contained inside FoldingData; callers still see one recording interface.

## Consequences and gate

We own SQL migrations and explicit mirror/outbox reconciliation. This is more implementation than one container but supplies concrete uniqueness and cross-process transaction semantics. Test commit/rollback, two-process contention, process termination, locked-device access, and duplicate iCloud delivery before proceeding. Do not replace this with UserDefaults counters or an in-process lock if the spike fails; document the actual issue and smallest alternative.

Reference: [Apple's CloudKit model constraints](https://developer.apple.com/documentation/coredata/creating-a-core-data-model-for-cloudkit), [SQLite transactions](https://sqlite.org/lang_transaction.html), [SQLite WAL](https://sqlite.org/wal.html).
