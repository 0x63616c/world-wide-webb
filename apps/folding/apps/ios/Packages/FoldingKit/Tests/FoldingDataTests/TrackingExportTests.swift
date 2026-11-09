import FoldingDomain
import Foundation
import Testing

@testable import FoldingData

private func exportRoot() -> URL {
  FileManager.default.temporaryDirectory.appendingPathComponent("folding-export-\(UUID())")
}
private func record(_ store: TrackingStore, _ transition: Transition = .open, at: Int64 = 1000)
  async throws
{
  _ = try await store.record(
    Observation(generation: .initial, transition: transition, observedAtMS: at, timezoneID: "UTC"),
    nowMS: at)
}
private actor ExportGate {
  var entered = false
  var continuation: CheckedContinuation<Void, Never>?
  func wait() async {
    entered = true
    await withCheckedContinuation { continuation = $0 }
  }
  func open() {
    continuation?.resume()
    continuation = nil
  }
  func waitForEntry() async throws {
    let deadline = ContinuousClock.now + .seconds(5)
    while !entered {
      guard ContinuousClock.now < deadline else { throw TrackingExportError.filesystem }
      try await Task.sleep(for: .milliseconds(1))
    }
  }
}

@Test func exportJSONStreamsSameWireDocumentAndCleansAfterSharing() async throws {
  let root = exportRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: UUID())
  try await record(store)
  try await record(store, .close, at: 2000)
  let service = TrackingExportService(store: store)
  let ticket = try await service.prepare(format: .json, homeTimezone: "UTC", nowMS: 3000)
  let url = try await service.shareURL(for: ticket)
  let actual = try #require(
    JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? NSDictionary)
  let snapshot = try await store.captureExportSnapshot()
  let expected = try PersonalExport.document(
    events: snapshot.events, interruptions: snapshot.interruptions,
    generation: snapshot.generation, homeTimezone: "UTC", exportedAtMS: 3000,
    uploadStates: snapshot.uploadStates, excludedEventIDs: snapshot.excludedEventIDs)
  #expect(
    actual
      == (try JSONSerialization.jsonObject(with: PersonalExport.json(expected)) as? NSDictionary))
  let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
  #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
  #expect(
    try store.exportDirectory.resourceValues(forKeys: [.isExcludedFromBackupKey])
      .isExcludedFromBackup == true)
  try await service.finish(ticket)
  #expect(!FileManager.default.fileExists(atPath: url.path))
}

@Test func exportSnapshotStaysConsistentWhenNewObservationArrives() async throws {
  let root = exportRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: UUID())
  try await record(store)
  let gate = ExportGate()
  let service = TrackingExportService(store: store, beforeWriting: { await gate.wait() })
  let work = Task { try await service.prepare(format: .json, homeTimezone: "UTC", nowMS: 3000) }
  try await gate.waitForEntry()
  try await record(store, .close, at: 2000)
  await gate.open()
  let ticket = try await work.value
  let json = try #require(
    JSONSerialization.jsonObject(with: Data(contentsOf: await service.shareURL(for: ticket)))
      as? [String: Any])
  #expect((json["events"] as? [Any])?.count == 1)
  #expect(try await store.retainedEvents().count == 2)
  try await service.finish(ticket)
}

@Test func resetDuringExportInvalidatesOutputAndPurgesTemporaryFiles() async throws {
  let root = exportRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: UUID())
  try await record(store)
  let gate = ExportGate()
  let service = TrackingExportService(store: store, beforeWriting: { await gate.wait() })
  let work = Task { try await service.prepare(format: .json, homeTimezone: "UTC", nowMS: 2000) }
  try await gate.waitForEntry()
  _ = try await store.reset(nowMS: 3000)
  await gate.open()
  do {
    _ = try await work.value
    Issue.record("Reset export was published")
  } catch {}
  #expect(!FileManager.default.fileExists(atPath: store.exportDirectory.path))
}

@Test func resetAndAccountChangeFenceAlreadyPreparedShareURLs() async throws {
  let root = exportRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let router = AccountPartitionRouter(directory: root)
  let installation = UUID()
  let lease = try router.activate(
    .local(UUID()), transition: router.suspend(), installationID: installation)
  let store = try router.openJournal(lease: lease, installationID: installation)
  try await record(store)
  let service = TrackingExportService(store: store)
  let first = try await service.prepare(format: .json, homeTimezone: "UTC", nowMS: 2000)
  let firstURL = try await service.shareURL(for: first)
  _ = try await store.reset(nowMS: 3000)
  #expect(!FileManager.default.fileExists(atPath: firstURL.path))
  do {
    _ = try await service.shareURL(for: first)
    Issue.record("Reset file shared")
  } catch TrackingExportError.staleSnapshot {}
  let second = try await service.prepare(format: .json, homeTimezone: "UTC", nowMS: 4000)
  let secondURL = try await service.shareURL(for: second)
  _ = try router.suspend()
  #expect(!FileManager.default.fileExists(atPath: secondURL.path))
  do {
    _ = try await service.shareURL(for: second)
    Issue.record("Inactive account file shared")
  } catch PartitionError.inactive {}
}

@Test func cancelledExportRemovesPartialWorkAndCannotBeSharedByAnotherService() async throws {
  let root = exportRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: UUID())
  let gate = ExportGate()
  let paused = TrackingExportService(store: store, beforeWriting: { await gate.wait() })
  let work = Task { try await paused.prepare(format: .csv, homeTimezone: "UTC", nowMS: 1000) }
  try await gate.waitForEntry()
  work.cancel()
  await gate.open()
  do {
    _ = try await work.value
    Issue.record("Cancelled export published")
  } catch is CancellationError {}
  let leftover =
    (try? FileManager.default.contentsOfDirectory(atPath: store.exportDirectory.path)) ?? []
  #expect(leftover.isEmpty)
  let first = TrackingExportService(store: store)
  let second = TrackingExportService(store: store)
  let ticket = try await first.prepare(format: .json, homeTimezone: "UTC", nowMS: 2000)
  do {
    _ = try await second.shareURL(for: ticket)
    Issue.record("Foreign ticket shared")
  } catch TrackingExportError.wrongOwner {}
  #expect(FileManager.default.fileExists(atPath: try await first.shareURL(for: ticket).path))
  try await first.finish(ticket)
}

@Test func staleTemporaryExportsAreRemovedAfterTwentyFourHours() async throws {
  let root = exportRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: UUID())
  let service = TrackingExportService(store: store)
  let ticket = try await service.prepare(format: .json, homeTimezone: "UTC", nowMS: 1000)
  let url = try await service.shareURL(for: ticket)
  try await service.cleanupExpired(nowMS: 86_401_000)
  #expect(FileManager.default.fileExists(atPath: url.path))
  try await service.cleanupExpired(nowMS: 86_401_001)
  #expect(!FileManager.default.fileExists(atPath: url.path))
}

@Test func exportRetainsQuarantinedEventWithoutCountingOrExposingEvidence() async throws {
  let root = exportRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: UUID())
  let receipt = try await store.record(
    Observation(generation: .initial, transition: .open, observedAtMS: 1000, timezoneID: "UTC"),
    nowMS: 1000)
  let original = receipt.event
  let conflicting = TrackingEvent(
    schemaVersion: 1, eventID: original.eventID, deviceID: original.deviceID,
    sequence: original.sequence,
    generation: original.generation, observedAtMS: 2000, timezoneID: "UTC", transition: .close,
    isTest: false, competitionEpochID: nil)
  try await store.importMirrorBatch([.event(conflicting)], storeID: "test", checkpoint: nil)
  let service = TrackingExportService(store: store)
  let ticket = try await service.prepare(format: .json, homeTimezone: "UTC", nowMS: 3000)
  let raw = try #require(
    JSONSerialization.jsonObject(with: Data(contentsOf: await service.shareURL(for: ticket)))
      as? [String: Any])
  let events = try #require(raw["events"] as? [[String: Any]])
  #expect(events.count == 1)
  #expect(events[0]["included_in_summary"] as? Bool == false)
  #expect(events[0]["reason"] == nil)
  #expect(raw["quarantines"] == nil)
  let days = try #require(raw["daily_summaries"] as? [[String: Any]])
  #expect(days[0]["folds"] as? Int == 0)
  try await service.finish(ticket)
}

#if os(macOS)
  @Test func streamedCSVZipMatchesDomainFilesUsingIndependentUnzip() async throws {
    let root = exportRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let store = try TrackingStore(directory: root, installationID: UUID())
    try await record(store)
    try await record(store, .close, at: 2000)
    let service = TrackingExportService(store: store)
    let ticket = try await service.prepare(format: .csv, homeTimezone: "UTC", nowMS: 3000)
    let url = try await service.shareURL(for: ticket)
    let output = root.appendingPathComponent("unzipped")
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/unzip")
    process.arguments = ["-qq", url.path, "-d", output.path]
    try process.run()
    process.waitUntilExit()
    #expect(process.terminationStatus == 0)
    let snapshot = try await store.captureExportSnapshot()
    let expected = try PersonalExport.document(
      events: snapshot.events, interruptions: snapshot.interruptions,
      generation: snapshot.generation,
      homeTimezone: "UTC", exportedAtMS: 3000, uploadStates: snapshot.uploadStates)
    for file in PersonalExport.csvFiles(expected) {
      #expect(try Data(contentsOf: output.appendingPathComponent(file.name)) == file.data)
    }
    try await service.finish(ticket)
  }
#endif
