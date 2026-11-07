import FoldingDomain
import Foundation
import Testing

@testable import FoldingData

private func transferRoot() -> URL {
  FileManager.default.temporaryDirectory.appendingPathComponent("folding-transfer-\(UUID())")
}
private func transferEvent(
  _ device: UUID, _ sequence: Int64, _ transition: Transition = .open,
  generation: ResetGeneration = .initial
) -> TrackingEvent {
  TrackingEvent(
    schemaVersion: 1, eventID: UUID(), deviceID: device, sequence: sequence,
    generation: generation, observedAtMS: sequence * 1000, timezoneID: "UTC",
    transition: transition, isTest: false, competitionEpochID: nil)
}

@Test func privateTransferPersistsCapturedWatermarksAndRetainsExcludedRawExport() async throws {
  let root = transferRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let identity = UUID()
  let old = UUID()
  let active = UUID()
  let unknown = UUID()
  let store = try TrackingStore(directory: root, installationID: identity)
  let oldKnown = transferEvent(old, 9)
  let oldLate = transferEvent(old, 11, .close)
  let fresh = transferEvent(active, 1)
  let unseen = transferEvent(unknown, 1)
  try await store.importEvent(oldKnown)
  try await store.importEvent(fresh)
  #expect(
    try await store.analytics(
      homeTimezone: "UTC", asOfMS: 10000,
      range: PersonalDateRange(startMS: 0, endMS: 86_400_000)
    ).needsDeviceSelection)
  let marker = try await store.selectTrackingDevice(active, nowMS: 10000)
  #expect(marker.sourceWatermarks == [old: 9])
  try await store.importEvent(oldLate)
  try await store.importEvent(unseen)
  let reopened = try TrackingStore(directory: root, installationID: identity)
  #expect(try await reopened.privateTransferMarkers() == [marker])
  let history = try await reopened.history(
    homeTimezone: "UTC", asOfMS: 20000, period: .day, offset: 0)
  #expect(history.analytics.selectedDeviceID == active)
  #expect(history.analytics.includedEventIDs == [oldKnown.eventID, fresh.eventID])
  #expect(history.bins.reduce(0) { $0 + $1.folds } == 2)
  #expect(try await reopened.summary().folds == 2)
  #expect(history.analytics.sessions.first { $0.deviceID == old }?.completeness == .incomplete)
  let service = TrackingExportService(store: reopened)
  let ticket = try await service.prepare(format: .json, homeTimezone: "UTC", nowMS: 20000)
  let json = try #require(
    JSONSerialization.jsonObject(with: Data(contentsOf: await service.shareURL(for: ticket)))
      as? [String: Any])
  #expect((json["transfer_markers"] as? [Any])?.count == 1)
  let rows = try #require(json["events"] as? [[String: Any]])
  #expect(rows.count == 4)
  #expect(rows.filter { $0["included_in_summary"] as? Bool == true }.count == 2)
  try await service.finish(ticket)
}

@Test func privateTransferResetKeepsSelectionWorkAndSourceSequenceKnowledge() async throws {
  let root = transferRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let local = UUID()
  let other = UUID()
  let store = try TrackingStore(directory: root, installationID: local)
  try await store.importEvent(transferEvent(local, 5))
  try await store.importEvent(transferEvent(other, 8))
  let first = try await store.selectTrackingDevice(other, nowMS: 9000)
  let reset = try await store.reset(nowMS: 10000)
  #expect(try await store.privateTransferMarkers() == [first])
  let leases = try await store.leaseMirrorWork(nowMS: 11000)
  #expect(leases.contains { $0.record == .transfer(first) })
  #expect(!leases.contains { if case .event = $0.record { true } else { false } })
  try await store.importEvent(transferEvent(local, 6, generation: reset))
  #expect(try await store.summary().folds == 0)
  let next = try await store.selectTrackingDevice(local, nowMS: 12000)
  #expect(next.revision == 2)
  #expect(next.sourceWatermarks[other] == 8)
  #expect(try await store.summary().folds == 1)
}

@Test func privateTransferBackDoesNotBridgeSessionsAcrossHandover() async throws {
  let root = transferRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let a = UUID()
  let b = UUID()
  let store = try TrackingStore(directory: root, installationID: b)
  try await store.importEvent(transferEvent(a, 1))
  _ = try await store.selectTrackingDevice(b, nowMS: 1500)
  try await store.importEvent(transferEvent(a, 2, .close))
  _ = try await store.selectTrackingDevice(a, nowMS: 3000)
  let summary = try await store.summary()
  #expect(summary.folds == 2)
  #expect(summary.cycles == 0)
  #expect(summary.sessions.first?.completeness == .incomplete)
}

@Test func concurrentPrivateTransfersConvergeRegardlessOfArrivalAndClock() async throws {
  let root = transferRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let a = try TrackingStore(directory: root.appendingPathComponent("a"), installationID: UUID())
  let b = try TrackingStore(directory: root.appendingPathComponent("b"), installationID: UUID())
  let first = try await a.selectTrackingDevice(a.deviceID, nowMS: 900000)
  let second = try await b.selectTrackingDevice(b.deviceID, nowMS: 1)
  try await a.importMirrorBatch(
    [.transfer(second), .transfer(first)], storeID: "m", checkpoint: Data([1]))
  try await b.importMirrorBatch(
    [.transfer(first), .transfer(second)], storeID: "m", checkpoint: Data([1]))
  let expected = try PrivateTransferPolicy.winner([first, second])
  #expect(try PrivateTransferPolicy.winner(await a.privateTransferMarkers()) == expected)
  #expect(try await a.privateTransferMarkers() == b.privateTransferMarkers())
  let next = try await a.selectTrackingDevice(a.deviceID, nowMS: 0)
  #expect(next.revision == 2)
}

@Test func privateTransferConflictIsRejectedAcrossResetAndReplay() async throws {
  let root = transferRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let a = try TrackingStore(directory: root.appendingPathComponent("a"), installationID: UUID())
  let b = try TrackingStore(directory: root.appendingPathComponent("b"), installationID: UUID())
  let marker = try await a.selectTrackingDevice(a.deviceID, nowMS: 1000)
  let conflict = PrivateTransferMarker(
    transferID: marker.transferID, revision: marker.revision,
    activeDeviceID: b.deviceID, sourceWatermarks: [:], createdAtMS: 1000)
  try await a.importMirrorBatch([.transfer(conflict)], storeID: "m", checkpoint: nil)
  try await b.importMirrorBatch(
    [.transfer(conflict), .transfer(marker)], storeID: "m", checkpoint: nil)
  #expect(try await a.privateTransferMarkers().isEmpty)
  #expect(try await b.privateTransferMarkers().isEmpty)
  _ = try await a.reset(nowMS: 2000)
  try await a.importMirrorBatch([.transfer(marker)], storeID: "m", checkpoint: nil)
  #expect(try await a.privateTransferMarkers().isEmpty)
  #expect(
    try await a.leaseMirrorWork(nowMS: 3000).allSatisfy {
      if case .transfer = $0.record { false } else { true }
    })
}

@Test func privateTransfersSurviveMirrorSaveCrashReplacementAndPrunedHistoryRecovery() async throws
{
  let root = transferRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let source = try TrackingStore(
    directory: root.appendingPathComponent("source"), installationID: UUID())
  let marker = try await source.selectTrackingDevice(source.deviceID, nowMS: 1000)
  let mirror = try await PrivateCloudMirror(
    directory: root.appendingPathComponent("mirror"), containerIdentifier: nil)
  let lease = try #require(await source.leaseMirrorWork(nowMS: 1000).first)
  try await mirror.save(lease.record)
  let coordinator = PrivateSyncCoordinator(journal: source, mirror: mirror)
  _ = try await coordinator.synchronize(nowMS: 61000)
  #expect(try await mirror.history(after: nil).records == [.transfer(marker)])
  try await mirror.pruneHistory(before: Date().addingTimeInterval(60))
  let destination = try TrackingStore(
    directory: root.appendingPathComponent("destination"), installationID: UUID())
  let importer = PrivateSyncCoordinator(journal: destination, mirror: mirror)
  _ = try await importer.synchronize(nowMS: 62000)
  #expect(try await destination.privateTransferMarkers() == [marker])
  let replacement = try await PrivateCloudMirror(
    directory: root.appendingPathComponent("replacement"), containerIdentifier: nil)
  let newCoordinator = PrivateSyncCoordinator(journal: source, mirror: replacement)
  _ = try await newCoordinator.synchronize(nowMS: 63000)
  #expect(try await replacement.history(after: nil).records == [.transfer(marker)])
  try await replacement.close()
  try await mirror.close()
}

@Test func privateTransferPartitionIsolationFencesSelectionImportAndExport() async throws {
  let root = transferRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let router = AccountPartitionRouter(directory: root)
  let installation = UUID()
  let accountA = PrivateAccountIdentity.iCloud(containerIdentifier: "test", userRecordName: "a")
  let accountB = PrivateAccountIdentity.iCloud(containerIdentifier: "test", userRecordName: "b")
  let leaseA = try router.activate(
    accountA, transition: router.suspend(), installationID: installation)
  let a = try router.openJournal(lease: leaseA, installationID: installation)
  let marker = try await a.selectTrackingDevice(installation, nowMS: 1000)
  let leaseB = try router.activate(
    accountB, transition: router.suspend(), installationID: installation)
  let b = try router.openJournal(lease: leaseB, installationID: installation)
  #expect(try await b.privateTransferMarkers().isEmpty)
  #expect(try await b.leaseMirrorWork(nowMS: 2000).isEmpty)
  await #expect(throws: PartitionError.inactive) {
    _ = try await a.selectTrackingDevice(UUID(), nowMS: 2000)
  }
  await #expect(throws: PartitionError.inactive) { _ = try await a.privateTransferMarkers() }
  await #expect(throws: PartitionError.inactive) { _ = try await a.captureExportSnapshot() }
  await #expect(throws: PartitionError.inactive) {
    _ = try await a.importMirrorBatch([.transfer(marker)], storeID: "old", checkpoint: nil)
  }
  let returned = try router.activate(
    accountA, transition: router.suspend(), installationID: installation)
  let reopened = try router.openJournal(lease: returned, installationID: installation)
  #expect(try await reopened.privateTransferMarkers() == [marker])
}

@Test func versionFourTransferMigrationPreservesEventsAndResetSequenceKnowledge() async throws {
  let root = transferRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let identity = UUID()
  let other = UUID()
  let store = try TrackingStore(directory: root, installationID: identity)
  try await store.importEvent(transferEvent(identity, 7))
  let reset = try await store.reset(nowMS: 8000)
  try await store.importEvent(transferEvent(other, 3, generation: reset))
  let db = try SQLiteConnection(url: root.appendingPathComponent("journal.sqlite"))
  try db.transaction {
    try db.execute("DROP TRIGGER remember_source_sequence")
    try db.execute("DROP TABLE known_source_sequences")
    try db.execute("DROP TABLE rejected_transfer_ids")
    try db.execute("DROP TABLE transfer_markers")
    try db.execute("PRAGMA user_version=4")
  }
  let reopened = try TrackingStore(directory: root, installationID: identity)
  #expect(try db.rows("PRAGMA user_version").first?["user_version"] == "7")
  let marker = try await reopened.selectTrackingDevice(other, nowMS: 9000)
  #expect(marker.sourceWatermarks == [identity: 7])
  #expect(try await reopened.retainedEvents().count == 1)
  #expect(try await reopened.currentGeneration() == reset)
}

@Test func crossJournalMirrorTransferCarriesWatermarksBoundariesAndLateExclusions() async throws {
  let root = transferRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let a = try TrackingStore(directory: root.appendingPathComponent("a"), installationID: UUID())
  let b = try TrackingStore(directory: root.appendingPathComponent("b"), installationID: UUID())
  let mirror = try await PrivateCloudMirror(
    directory: root.appendingPathComponent("mirror"), containerIdentifier: nil)
  let syncA = PrivateSyncCoordinator(journal: a, mirror: mirror)
  let syncB = PrivateSyncCoordinator(journal: b, mirror: mirror)
  _ = try await a.record(
    Observation(generation: .initial, transition: .open, observedAtMS: 1000, timezoneID: "UTC"),
    nowMS: 1000)
  _ = try await syncA.synchronize(nowMS: 1100)
  _ = try await syncB.synchronize(nowMS: 1200)
  let selection = try await b.selectTrackingDevice(b.deviceID, nowMS: 1300)
  #expect(selection.sourceWatermarks[a.deviceID] == 1)
  _ = try await a.record(
    Observation(generation: .initial, transition: .close, observedAtMS: 1400, timezoneID: "UTC"),
    nowMS: 1400)
  _ = try await syncB.synchronize(nowMS: 1500)
  _ = try await syncA.synchronize(nowMS: 1600)
  _ = try await syncB.synchronize(nowMS: 1700)
  #expect(try await a.privateTransferMarkers() == b.privateTransferMarkers())
  #expect(try await a.summary() == b.summary())
  #expect(try await a.summary().folds == 1)
  #expect(try await b.retainedEvents().count == 2)
  #expect(try await a.summary().sessions.first?.completeness == .incomplete)
  _ = try await b.selectTrackingDevice(a.deviceID, nowMS: 1800)
  _ = try await syncB.synchronize(nowMS: 1900)
  _ = try await syncA.synchronize(nowMS: 2000)
  #expect(try await a.summary().folds == 2)
  #expect(try await a.summary().cycles == 0)
  #expect(try await a.summary() == b.summary())
  try await mirror.close()
}

@Test func unmirroredTransferConflictReplicatesMonotonicRejectionAndRebuildsIt() async throws {
  let root = transferRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let a = try TrackingStore(directory: root.appendingPathComponent("a"), installationID: UUID())
  let b = try TrackingStore(directory: root.appendingPathComponent("b"), installationID: UUID())
  let original = try await a.selectTrackingDevice(a.deviceID, nowMS: 1)
  let conflict = PrivateTransferMarker(
    transferID: original.transferID, revision: 1,
    activeDeviceID: b.deviceID, sourceWatermarks: [:], createdAtMS: 1)
  let mirror = try await PrivateCloudMirror(
    directory: root.appendingPathComponent("mirror"), containerIdentifier: nil)
  try await mirror.save(.transfer(conflict))
  let syncA = PrivateSyncCoordinator(journal: a, mirror: mirror)
  let syncB = PrivateSyncCoordinator(journal: b, mirror: mirror)
  _ = try await syncB.synchronize(nowMS: 1000)
  #expect(try await b.privateTransferMarkers() == [conflict])
  _ = try await syncA.synchronize(nowMS: 2000)
  _ = try await syncB.synchronize(nowMS: 3000)
  _ = try await syncA.synchronize(nowMS: 4000)
  #expect(try await a.privateTransferMarkers().isEmpty)
  #expect(try await b.privateTransferMarkers().isEmpty)
  #expect(try await a.quarantinedRecordCount() == 1)
  #expect(try await b.quarantinedRecordCount() == 1)
  #expect(
    try await mirror.history(after: nil).records.contains(.transferRejection(original.transferID)))
  // Duplicate tombstones do not create an endless replication loop.
  #expect(try await syncA.synchronize(nowMS: 5000)?.localMirrorSaves == 0)
  _ = try await a.reset(nowMS: 6000)
  let replacement = try await PrivateCloudMirror(
    directory: root.appendingPathComponent("replacement"), containerIdentifier: nil)
  let rebuild = PrivateSyncCoordinator(journal: a, mirror: replacement)
  _ = try await rebuild.synchronize(nowMS: 7000)
  #expect(
    try await replacement.history(after: nil).records.contains(
      .transferRejection(original.transferID)))
  try await replacement.save(.transfer(original))
  let c = try TrackingStore(directory: root.appendingPathComponent("c"), installationID: UUID())
  let syncC = PrivateSyncCoordinator(journal: c, mirror: replacement)
  _ = try await syncC.synchronize(nowMS: 8000)
  #expect(try await c.privateTransferMarkers().isEmpty)
  #expect(try await c.quarantinedRecordCount() == 1)
  try await replacement.close()
  try await mirror.close()
}

@Test func selectingUnknownPrivateSourceFailsWithoutCreatingWork() async throws {
  let root = transferRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: UUID())
  await #expect(throws: StoreError.invalidInput) {
    _ = try await store.selectTrackingDevice(UUID(), nowMS: 1)
  }
  #expect(try await store.privateTransferMarkers().isEmpty)
  #expect(try await store.leaseMirrorWork(nowMS: 2).isEmpty)
}
