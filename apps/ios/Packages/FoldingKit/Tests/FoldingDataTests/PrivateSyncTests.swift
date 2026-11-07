import CoreData
import FoldingDomain
import Foundation
import Testing

@testable import FoldingData

private func directory() throws -> URL {
  let url = FileManager.default.temporaryDirectory.appendingPathComponent(
    "folding-mirror-\(UUID())")
  try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

private func event(
  _ sequence: Int64 = 1, id: UUID = UUID(), device: UUID = UUID(),
  transition: Transition = .open, generation: ResetGeneration = .initial
) -> TrackingEvent {
  TrackingEvent(
    schemaVersion: 1, eventID: id, deviceID: device, sequence: sequence,
    generation: generation, observedAtMS: sequence * 1000, timezoneID: "UTC",
    transition: transition, isTest: false, competitionEpochID: nil)
}

@Test func persistentMirrorHistoryDeduplicatesLocalSaveAndResumesToken() async throws {
  let root = try directory()
  defer { try? FileManager.default.removeItem(at: root) }
  let mirror = try await PrivateCloudMirror(directory: root, containerIdentifier: nil)
  let record = MirrorRecord.event(event())
  try await mirror.save(record)
  try await mirror.save(record)
  let first = try await mirror.history(after: nil)
  #expect(first.records == [record])
  let token = try #require(first.checkpoint)
  #expect(try await mirror.history(after: token).records.isEmpty)
  try await mirror.close()
  let reopened = try await PrivateCloudMirror(directory: root, containerIdentifier: nil)
  #expect(reopened.storeID == mirror.storeID)
  #expect(try await reopened.history(after: token).records.isEmpty)
  try await reopened.close()
}

@Test func mirrorSaveCrashReplayAndSecondJournalConverge() async throws {
  let root = try directory()
  defer { try? FileManager.default.removeItem(at: root) }
  let source = try TrackingStore(
    directory: root.appendingPathComponent("source"), installationID: UUID())
  let mirror = try await PrivateCloudMirror(
    directory: root.appendingPathComponent("mirror"), containerIdentifier: nil)
  _ = try await source.record(
    Observation(generation: .initial, transition: .open, observedAtMS: 1000, timezoneID: "UTC"),
    nowMS: 1000)
  let lease = try #require(await source.leaseMirrorWork(nowMS: 1000).first)
  try await mirror.save(lease.record)
  // Simulate process loss after mirror save, before journal acknowledgment.
  let coordinator = PrivateSyncCoordinator(journal: source, mirror: mirror)
  let report = try #require(await coordinator.synchronize(nowMS: 61000))
  #expect(report.localMirrorSaves == 1)
  #expect(try await source.summary().folds == 1)
  #expect(try await mirror.history(after: nil).records.count == 1)
  let target = try TrackingStore(
    directory: root.appendingPathComponent("target"), installationID: UUID())
  let targetSync = PrivateSyncCoordinator(journal: target, mirror: mirror)
  _ = try await targetSync.synchronize(nowMS: 62000)
  #expect(try await target.summary().folds == 1)
  #expect(try await target.leaseMirrorWork(nowMS: 62000).isEmpty)
  let reset = try await target.reset(nowMS: 63000)
  _ = try await targetSync.synchronize(nowMS: 63000)
  _ = try await coordinator.synchronize(nowMS: 64000)
  #expect(try await source.currentGeneration() == reset)
  #expect(try await source.summary().folds == 0)
  try await coordinator.stop()
  do {
    _ = try await coordinator.synchronize(nowMS: 65000)
    Issue.record("Stopped coordinator ran")
  } catch MirrorError.closed {}
}

@Test func futureGenerationWaitsForMarkerAndCheckpointIsDurable() async throws {
  let root = try directory()
  defer { try? FileManager.default.removeItem(at: root) }
  let identity = UUID()
  let store = try TrackingStore(directory: root, installationID: identity)
  let reset = ResetGeneration(revision: 2, resetID: UUID())
  let future = event(generation: reset)
  let token = Data("first".utf8)
  try await store.importMirrorBatch([.event(future)], storeID: "mirror", checkpoint: token)
  #expect(try await store.summary().folds == 0)
  #expect(try await store.mirrorCheckpoint(storeID: "mirror") == token)
  let reopened = try TrackingStore(directory: root, installationID: identity)
  try await reopened.importMirrorBatch(
    [.reset(reset, createdAtMS: 100)], storeID: "mirror", checkpoint: Data("second".utf8))
  #expect(try await reopened.summary().folds == 1)
  #expect(try await reopened.currentGeneration() == reset)
}

@Test func conflictingMirrorPayloadsAreQuarantinedWithoutInventingSession() async throws {
  let root = try directory()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: UUID())
  let device = UUID()
  let open = event(device: device)
  let close = event(2, device: device, transition: .close)
  try await store.importMirrorBatch(
    [.event(open), .event(close)], storeID: "m", checkpoint: Data([1]))
  #expect(try await store.summary().completeDurationMS == 1000)
  let conflict = event(id: open.eventID, device: device, transition: .close)
  try await store.importMirrorBatch([.event(conflict)], storeID: "m", checkpoint: Data([2]))
  #expect(try await store.quarantinedRecordCount() == 1)
  #expect(try await store.summary().folds == 1)
  #expect(try await store.summary().completeDurationMS == 0)
  #expect(try await store.retainedEvents().count == 2)
  try await store.importMirrorBatch(
    [.event(open), .event(conflict)], storeID: "m", checkpoint: Data([3]))
  #expect(try await store.summary().folds == 1)
}

@Test func checkpointFailureRollsBackImportedResetAndEvents() async throws {
  let root = try directory()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: UUID())
  try await store.importEvent(event())
  let db = try SQLiteConnection(url: root.appendingPathComponent("journal.sqlite"))
  try db.execute(
    "CREATE TRIGGER reject_checkpoint BEFORE INSERT ON sync_checkpoints BEGIN SELECT RAISE(ABORT, 'failure'); END"
  )
  let reset = ResetGeneration(revision: 1, resetID: UUID())
  do {
    try await store.importMirrorBatch(
      [.reset(reset, createdAtMS: 1), .event(event(generation: reset))], storeID: "m",
      checkpoint: Data([1]))
    Issue.record("Checkpoint failure acknowledged")
  } catch { #expect(error as? StoreError == .database(19)) }
  #expect(try await store.currentGeneration() == .initial)
  #expect(try await store.summary().folds == 1)
  #expect(try await store.mirrorCheckpoint(storeID: "m") == nil)
}

@Test func replacementMirrorRequeuesLocallySavedWork() async throws {
  let root = try directory()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(
    directory: root.appendingPathComponent("journal"), installationID: UUID())
  _ = try await store.record(
    Observation(generation: .initial, transition: .open, observedAtMS: 1, timezoneID: "UTC"),
    nowMS: 1)
  let first = try await PrivateCloudMirror(
    directory: root.appendingPathComponent("first"), containerIdentifier: nil)
  let firstSync = PrivateSyncCoordinator(journal: store, mirror: first)
  _ = try await firstSync.synchronize(nowMS: 1)
  #expect(try await store.leaseMirrorWork(nowMS: 2).isEmpty)
  try await firstSync.stop()
  let second = try await PrivateCloudMirror(
    directory: root.appendingPathComponent("second"), containerIdentifier: nil)
  let secondSync = PrivateSyncCoordinator(journal: store, mirror: second)
  let report = try #require(await secondSync.synchronize(nowMS: 3))
  #expect(report.localMirrorSaves == 1)
  #expect(try await second.history(after: nil).records.count == 1)
  try await secondSync.stop()
}

@Test func historyBatchesDoNotSkipTransactions() async throws {
  let root = try directory()
  defer { try? FileManager.default.removeItem(at: root) }
  let mirror = try await PrivateCloudMirror(directory: root, containerIdentifier: nil)
  var expected = Set<UUID>()
  for _ in 0..<12 {
    let next = event()
    expected.insert(next.eventID)
    try await mirror.save(.event(next))
  }
  var checkpoint: Data?
  var actual = Set<UUID>()
  for _ in 0..<5 {
    let batch = try await mirror.history(after: checkpoint, limit: 3)
    actual.formUnion(batch.records.map(\.logicalID))
    if let next = batch.checkpoint { checkpoint = next } else { break }
  }
  #expect(actual == expected)
  try await mirror.close()
}

@Test func unmirroredConflictEvidenceConvergesAcrossJournals() async throws {
  let root = try directory()
  defer { try? FileManager.default.removeItem(at: root) }
  let first = try TrackingStore(directory: root.appendingPathComponent("a"), installationID: UUID())
  let receipt = try await first.record(
    Observation(generation: .initial, transition: .open, observedAtMS: 1000, timezoneID: "UTC"),
    nowMS: 1000)
  let second = try TrackingStore(
    directory: root.appendingPathComponent("b"), installationID: UUID())
  let conflict = event(
    id: receipt.event.eventID, device: receipt.event.deviceID, transition: .close)
  let mirror = try await PrivateCloudMirror(
    directory: root.appendingPathComponent("m"), containerIdentifier: nil)
  try await mirror.save(.event(conflict))
  let firstSync = PrivateSyncCoordinator(journal: first, mirror: mirror)
  let secondSync = PrivateSyncCoordinator(journal: second, mirror: mirror)
  _ = try await secondSync.synchronize(nowMS: 2000)
  #expect(try await second.summary().folds == 1)
  _ = try await firstSync.synchronize(nowMS: 3000)
  _ = try await secondSync.synchronize(nowMS: 4000)
  #expect(try await first.quarantinedRecordCount() == 1)
  #expect(try await second.quarantinedRecordCount() == 1)
  #expect(try await first.summary().folds == 0)
  #expect(try await second.summary().folds == 0)
  try await firstSync.stop()
}

@Test func conflictingResetDoesNotPoisonCheckpointOrOverwriteTombstone() async throws {
  let root = try directory()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: UUID())
  let first = ResetGeneration(revision: 1, resetID: UUID())
  try await store.importMirrorBatch(
    [.reset(first, createdAtMS: 1)], storeID: "m", checkpoint: Data([1]))
  let conflict = ResetGeneration(revision: 99, resetID: first.resetID)
  try await store.importMirrorBatch(
    [.reset(conflict, createdAtMS: 2), .event(event(generation: first))], storeID: "m",
    checkpoint: Data([2]))
  #expect(try await store.currentGeneration() == first)
  #expect(try await store.summary().folds == 1)
  #expect(try await store.quarantinedRecordCount() == 1)
  #expect(try await store.mirrorCheckpoint(storeID: "m") == Data([2]))
  try await store.importMirrorBatch(
    [.reset(conflict, createdAtMS: 2)], storeID: "m", checkpoint: Data([3]))
  #expect(try await store.currentGeneration() == first)
}

@Test func rejectedResetRecordsDoNotWaitForeverOrCreateReplicationLoop() async throws {
  let root = try directory()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: UUID())
  let id = UUID()
  let first = ResetGeneration(revision: 1, resetID: id)
  let bad = ResetGeneration(revision: 2, resetID: id)
  let future = MirrorRecord.event(event(generation: bad))
  try await store.importMirrorBatch([future], storeID: "m", checkpoint: Data([1]))
  try await store.importMirrorBatch(
    [.reset(first, createdAtMS: 1), .reset(bad, createdAtMS: 2)], storeID: "m",
    checkpoint: Data([2]))
  let db = try SQLiteConnection(url: root.appendingPathComponent("journal.sqlite"))
  #expect(try db.rows("SELECT count(*) AS n FROM deferred_imports").first?["n"] == "0")
  #expect(try await store.quarantinedRecordCount() == 2)
  #expect(try await store.leaseMirrorWork(nowMS: 3).isEmpty)
}

@Test func recoverySnapshotPinsPagesAndReplaysConcurrentWrites() async throws {
  let root = try directory()
  defer { try? FileManager.default.removeItem(at: root) }
  let mirror = try await PrivateCloudMirror(directory: root, containerIdentifier: nil)
  var expected: Set<UUID> = []
  for _ in 0..<7 {
    let record = event()
    expected.insert(record.eventID)
    try await mirror.save(.event(record))
  }
  let snapshot = try await mirror.recoverySnapshot()
  var seen: Set<UUID> = []
  let first = try #require(await snapshot.next(limit: 2))
  seen.formUnion(first.map(\.logicalID))
  let concurrent = event()
  try await mirror.save(.event(concurrent))
  while let page = try await snapshot.next(limit: 2) {
    #expect(page.count <= 2)
    seen.formUnion(page.map(\.logicalID))
  }
  #expect(seen == expected)
  let tail = try await mirror.history(after: snapshot.checkpoint)
  #expect(tail.records == [.event(concurrent)])
}

@Test func expiredHistoryRecoversRetainedRowsBeforeAdvancingCheckpoint() async throws {
  let root = try directory()
  defer { try? FileManager.default.removeItem(at: root) }
  let mirror = try await PrivateCloudMirror(
    directory: root.appendingPathComponent("mirror"), containerIdentifier: nil)
  let journal = try TrackingStore(
    directory: root.appendingPathComponent("journal"), installationID: UUID())
  let original = event()
  try await mirror.save(.event(original))
  let old = try #require(await mirror.history(after: nil).checkpoint)
  try await journal.importMirrorBatch([], storeID: mirror.storeID, checkpoint: old)
  try await mirror.save(.event(event()))
  try await mirror.pruneHistory(before: Date().addingTimeInterval(60))
  // Real Core Data history pruning expires a previously captured token; rows survive.
  do {
    _ = try await mirror.history(after: old)
    Issue.record("History token unexpectedly survived pruning")
  } catch {
    #expect((error as NSError).code == NSPersistentHistoryTokenExpiredError)
  }
  let coordinator = PrivateSyncCoordinator(journal: journal, mirror: mirror)
  _ = try await coordinator.synchronize(nowMS: 1000)
  #expect(try await journal.retainedEvents().count == 2)
  let subsequent = event()
  try await mirror.save(.event(subsequent))
  _ = try await coordinator.synchronize(nowMS: 2000)
  #expect(try await journal.retainedEvents().count == 3)
}

@Test func recoveryRetriesFetchedButUncommittedPagesAndCheckpointFailure() async throws {
  let root = try directory()
  defer { try? FileManager.default.removeItem(at: root) }
  let mirror = try await PrivateCloudMirror(
    directory: root.appendingPathComponent("mirror"), containerIdentifier: nil)
  let journalURL = root.appendingPathComponent("journal")
  let journal = try TrackingStore(directory: journalURL, installationID: UUID())
  try await mirror.save(.event(event()))
  let old = try #require(await mirror.history(after: nil).checkpoint)
  try await journal.importMirrorBatch([], storeID: mirror.storeID, checkpoint: old)
  try await mirror.save(.event(event()))
  try await mirror.pruneHistory(before: Date().addingTimeInterval(60))
  // Ensure the recovery baseline has a token after pruning.
  try await mirror.save(.event(event()))
  let db = try SQLiteConnection(url: journalURL.appendingPathComponent("journal.sqlite"))
  try db.execute(
    "CREATE TRIGGER reject_event BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'failure'); END")
  let coordinator = PrivateSyncCoordinator(journal: journal, mirror: mirror)
  do {
    _ = try await coordinator.synchronize(nowMS: 1)
    Issue.record("Failed recovery page acknowledged")
  } catch { #expect(error as? StoreError == .database(19)) }
  #expect(try await journal.retainedEvents().isEmpty)
  #expect(try await journal.mirrorCheckpoint(storeID: mirror.storeID) == old)
  try db.execute("DROP TRIGGER reject_event")
  try db.execute(
    "CREATE TRIGGER reject_checkpoint BEFORE INSERT ON sync_checkpoints BEGIN SELECT RAISE(ABORT, 'failure'); END"
  )
  do {
    _ = try await coordinator.synchronize(nowMS: 2)
    Issue.record("Failed recovery checkpoint acknowledged")
  } catch { #expect(error as? StoreError == .database(19)) }
  #expect(try await journal.retainedEvents().count == 3)
  #expect(try await journal.mirrorCheckpoint(storeID: mirror.storeID) == old)
  try db.execute("DROP TRIGGER reject_checkpoint")
  _ = try await coordinator.synchronize(nowMS: 3)
  #expect(try await journal.retainedEvents().count == 3)
  #expect(try await journal.mirrorCheckpoint(storeID: mirror.storeID) != old)
}

@Test func freshJournalImportsMirrorRowsWhoseHistoryWasPruned() async throws {
  let root = try directory()
  defer { try? FileManager.default.removeItem(at: root) }
  let mirror = try await PrivateCloudMirror(directory: root, containerIdentifier: nil)
  let original = event()
  try await mirror.save(.event(original))
  try await mirror.pruneHistory(before: Date().addingTimeInterval(60))
  let journal = try TrackingStore(
    directory: root.appendingPathComponent("journal"), installationID: UUID())
  let coordinator = PrivateSyncCoordinator(journal: journal, mirror: mirror)
  _ = try await coordinator.synchronize(nowMS: 1)
  #expect(try await journal.retainedEvents() == [original])
}

@Test func deferredQueueDrainsEligibleRowsInBoundedBatchesWithoutNewHistory() async throws {
  let root = try directory()
  defer { try? FileManager.default.removeItem(at: root) }
  let journal = try TrackingStore(directory: root, installationID: UUID())
  let generation = ResetGeneration(revision: 1, resetID: UUID())
  let future = ResetGeneration(revision: 2, resetID: UUID())
  let waiting = (0..<1100).map { _ in MirrorRecord.event(event(generation: generation)) }
  try await journal.importMirrorBatch(
    waiting + [.event(event(generation: future))], storeID: "m", checkpoint: nil)
  let count = try await journal.importMirrorBatch(
    [.reset(generation, createdAtMS: 1)], storeID: "m", checkpoint: nil)
  #expect(count == 500)
  #expect(try await journal.retainedEvents().count == 500)
  let mirror = try await PrivateCloudMirror(
    directory: root.appendingPathComponent("mirror"), containerIdentifier: nil)
  let coordinator = PrivateSyncCoordinator(journal: journal, mirror: mirror)
  _ = try await coordinator.synchronize(nowMS: 2)
  #expect(try await journal.retainedEvents().count == 1100)
  let db = try SQLiteConnection(url: root.appendingPathComponent("journal.sqlite"))
  #expect(try db.rows("SELECT count(*) AS n FROM deferred_imports").first?["n"] == "1")
}

@Test func versionThreeDeferredQueueMigratesWithoutLosingWaitingRecords() async throws {
  let root = try directory()
  defer { try? FileManager.default.removeItem(at: root) }
  let identity = UUID()
  let journal = try TrackingStore(directory: root, installationID: identity)
  let generation = ResetGeneration(revision: 1, resetID: UUID())
  let waiting = event(generation: generation)
  try await journal.importMirrorBatch([.event(waiting)], storeID: "m", checkpoint: nil)
  let db = try SQLiteConnection(url: root.appendingPathComponent("journal.sqlite"))
  // Restore the exact previous deferred-table shape, retaining its encoded payload.
  try db.transaction {
    try db.execute(
      "CREATE TABLE old_deferred (payload_hash TEXT PRIMARY KEY,payload_json TEXT NOT NULL)")
    try db.execute(
      "INSERT INTO old_deferred SELECT payload_hash,payload_json FROM deferred_imports")
    try db.execute("DROP TABLE deferred_imports")
    try db.execute("ALTER TABLE old_deferred RENAME TO deferred_imports")
    try db.execute("DROP TRIGGER remember_source_sequence")
    try db.execute("DROP TABLE known_source_sequences")
    try db.execute("DROP TABLE rejected_transfer_ids")
    try db.execute("DROP TABLE transfer_markers")
    try db.execute("PRAGMA user_version=3")
  }
  let reopened = try TrackingStore(directory: root, installationID: identity)
  #expect(try db.rows("PRAGMA user_version").first?["user_version"] == "6")
  try await reopened.importMirrorBatch(
    [.reset(generation, createdAtMS: 1)], storeID: "m", checkpoint: nil)
  #expect(try await reopened.retainedEvents() == [waiting])
}
