import CoreData
import FoldingDomain
import Foundation
import Testing

@testable import FoldingData

private func cleanupRoot() -> URL {
  FileManager.default.temporaryDirectory.appendingPathComponent("folding-cleanup-\(UUID())")
}
private func cleanupEvent(_ generation: ResetGeneration = .initial) -> TrackingEvent {
  TrackingEvent(
    schemaVersion: 1, eventID: UUID(), deviceID: UUID(), sequence: 1,
    generation: generation, observedAtMS: 1, timezoneID: "UTC", transition: .open,
    isTest: false, competitionEpochID: nil)
}
private func retainedMirrorRecords(_ mirror: PrivateCloudMirror) async throws -> [MirrorRecord] {
  let snapshot = try await mirror.recoverySnapshot()
  var records: [MirrorRecord] = []
  while let page = try await snapshot.next() { records += page }
  return records
}

@Test func mirrorCleanupRequiresSavedResetAndPreservesCurrentFutureAndControlRecords() async throws
{
  let root = cleanupRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let mirror = try await PrivateCloudMirror(directory: root, containerIdentifier: nil)
  let current = ResetGeneration(
    revision: 2, resetID: UUID(uuidString: "77777777-7777-4777-8777-777777777777")!)
  let future = ResetGeneration(revision: 3, resetID: UUID())
  let lowerTie = MirrorRecord.event(
    cleanupEvent(
      ResetGeneration(
        revision: 2,
        resetID: UUID(uuidString: "11111111-1111-4111-8111-111111111111")!)))
  let higherTie = MirrorRecord.event(
    cleanupEvent(
      ResetGeneration(
        revision: 2,
        resetID: UUID(uuidString: "99999999-9999-4999-8999-999999999999")!)))
  let old = MirrorRecord.event(cleanupEvent())
  let active = MirrorRecord.event(cleanupEvent(current))
  let pending = MirrorRecord.event(cleanupEvent(future))
  let reset = MirrorRecord.reset(current, createdAtMS: 2)
  let olderReset = MirrorRecord.reset(ResetGeneration(revision: 1, resetID: UUID()), createdAtMS: 1)
  let transfer = MirrorRecord.transfer(
    PrivateTransferMarker(
      transferID: UUID(), revision: 1,
      activeDeviceID: UUID(), sourceWatermarks: [:], createdAtMS: 1))
  let rejection = MirrorRecord.transferRejection(UUID())
  let interruption = MirrorRecord.interruption(
    TrackingInterruption(
      interruptionID: UUID(),
      deviceID: UUID(), generation: .initial, afterSequence: 0, reason: .deviceRestart,
      observedAtMS: 1))
  for record in [
    old, active, pending, olderReset, transfer, rejection, interruption, lowerTie, higherTie,
  ] {
    try await mirror.save(record)
  }
  #expect(try await mirror.cleanup(before: current).deletedRecords == 0)
  #expect(try await retainedMirrorRecords(mirror).count == 9)
  try await mirror.save(reset)
  #expect(try await mirror.cleanup(before: current, limit: 1).deletedRecords == 1)
  try await mirror.close()
  let reopened = try await PrivateCloudMirror(directory: root, containerIdentifier: nil)
  #expect(try await reopened.cleanup(before: current, limit: 2).deletedRecords == 2)
  let remaining = try await retainedMirrorRecords(reopened)
  #expect(remaining.count == 7)
  for record in [active, pending, reset, olderReset, transfer, rejection, higherTie] {
    #expect(remaining.contains(record))
  }
  #expect(try await reopened.cleanup(before: current).deletedRecords == 0)
  try await reopened.close()
}

@Test func delayedOldMirrorRecordCannotResurrectAfterCleanupAndFullJournalRecovery() async throws {
  let root = cleanupRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(
    directory: root.appendingPathComponent("journal"), installationID: UUID())
  let mirror = try await PrivateCloudMirror(
    directory: root.appendingPathComponent("mirror"), containerIdentifier: nil)
  let old = MirrorRecord.event(cleanupEvent())
  try await mirror.save(old)
  let sync = PrivateSyncCoordinator(journal: store, mirror: mirror)
  _ = try await sync.synchronize(nowMS: 1)
  #expect(try await store.summary().folds == 1)
  let reset = try await store.reset(nowMS: 2)
  _ = try await sync.synchronize(nowMS: 3)
  #expect(
    try await retainedMirrorRecords(mirror).allSatisfy {
      if case .event = $0 { false } else { true }
    })
  try await mirror.save(old)
  let fresh = try TrackingStore(
    directory: root.appendingPathComponent("fresh"), installationID: UUID())
  let recover = PrivateSyncCoordinator(journal: fresh, mirror: mirror)
  _ = try await recover.synchronize(nowMS: 4)
  #expect(try await fresh.currentGeneration() == reset)
  #expect(try await fresh.summary().folds == 0)
  #expect(try await fresh.retainedEvents().isEmpty)
  #expect(
    try await retainedMirrorRecords(mirror).allSatisfy {
      if case .event = $0 { false } else { true }
    })
  try await mirror.close()
}

/// Reproduce the shipped two-attribute model; populate in bounded batches without loading its rows.
private func createLegacyMirror(at directory: URL, eventCount: Int) async throws {
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  let model = NSManagedObjectModel()
  model.entities = ["ReplicatedEvent", "ResetMarker", "TrackingInterruption", "TransferMarker"].map
  { name in
    let entity = NSEntityDescription()
    entity.name = name
    entity.managedObjectClassName = NSStringFromClass(NSManagedObject.self)
    let id = NSAttributeDescription()
    id.name = "logicalID"
    id.attributeType = .stringAttributeType
    id.isOptional = true
    id.preservesValueInHistoryOnDeletion = true
    let payload = NSAttributeDescription()
    payload.name = "payload"
    payload.attributeType = .binaryDataAttributeType
    payload.isOptional = true
    entity.properties = [id, payload]
    return entity
  }
  let container = NSPersistentContainer(name: "FoldingPrivateMirror", managedObjectModel: model)
  let description = NSPersistentStoreDescription(
    url: directory.appendingPathComponent("mirror.sqlite"))
  description.setOption(true as NSNumber, forKey: NSPersistentHistoryTrackingKey)
  container.persistentStoreDescriptions = [description]
  try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
    container.loadPersistentStores { _, error in
      if let error { continuation.resume(throwing: error) } else { continuation.resume() }
    }
  }
  let event = cleanupEvent()
  let data = try JSONEncoder().encode(MirrorRecord.event(event))
  let context = container.newBackgroundContext()
  for start in stride(from: 0, to: eventCount, by: 1000) {
    let count = min(1000, eventCount - start)
    try await context.perform {
      let rows: [[String: Any]] = Array(
        repeating: ["logicalID": event.eventID.uuidString.lowercased(), "payload": data],
        count: count)
      _ = try context.execute(NSBatchInsertRequest(entityName: "ReplicatedEvent", objects: rows))
    }
  }
  for store in container.persistentStoreCoordinator.persistentStores {
    try container.persistentStoreCoordinator.remove(store)
  }
}

@Test func legacyHundredThousandRowsBackfillAndCleanupStayBoundedAcrossRestartAndInsert()
  async throws
{
  let root = cleanupRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  try await createLegacyMirror(at: root, eventCount: 100_000)
  var mirror = try await PrivateCloudMirror(directory: root, containerIdentifier: nil)
  let reset = ResetGeneration(revision: 1, resetID: UUID())
  try await mirror.save(.reset(reset, createdAtMS: 1))
  let first = try await mirror.cleanup(before: reset, limit: 1000)
  #expect(first.indexedRecords == 1000)
  #expect(first.deletedRecords == 0)
  try await mirror.close()
  mirror = try await PrivateCloudMirror(directory: root, containerIdentifier: nil)
  let current = MirrorRecord.event(cleanupEvent(reset))
  try await mirror.save(current)
  var indexed = first.indexedRecords
  var deleted = 0
  var passes = 1
  while true {
    let report = try await mirror.cleanup(before: reset, limit: 1000)
    #expect(report.indexedRecords + report.deletedRecords <= 1000)
    indexed += report.indexedRecords
    deleted += report.deletedRecords
    passes += 1
    if report.indexedRecords + report.deletedRecords == 0 { break }
    #expect(passes <= 202)
    if passes > 202 { break }
  }
  #expect(indexed == 100_000)
  #expect(deleted == 100_000)
  #expect(try await retainedMirrorRecords(mirror).contains(current))
  #expect(try await retainedMirrorRecords(mirror).count == 2)
  try await mirror.close()
}

@Test func cleanupConcurrentSaveDoesNotSkipCurrentOrLateOldRows() async throws {
  let root = cleanupRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let mirror = try await PrivateCloudMirror(directory: root, containerIdentifier: nil)
  let reset = ResetGeneration(revision: 1, resetID: UUID())
  try await mirror.save(.reset(reset, createdAtMS: 1))
  for _ in 0..<20 { try await mirror.save(.event(cleanupEvent())) }
  let current = MirrorRecord.event(cleanupEvent(reset))
  async let deletion = mirror.cleanup(before: reset, limit: 10)
  async let insertion: Void = mirror.save(current)
  _ = try await (deletion, insertion)
  try await mirror.save(.event(cleanupEvent()))
  while try await mirror.cleanup(before: reset, limit: 10).deletedRecords > 0 {}
  #expect(try await retainedMirrorRecords(mirror).count == 2)
  #expect(try await retainedMirrorRecords(mirror).contains(current))
  try await mirror.close()
}
