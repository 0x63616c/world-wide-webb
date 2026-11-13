import FoldingDomain
import Foundation
import Testing

@testable import FoldingData

private let testInstallation = UUID(uuidString: "12345678-1234-4234-8234-123456789abc")!

private func temporaryDirectory() throws -> URL {
  let url = FileManager.default.temporaryDirectory.appendingPathComponent("folding-test-\(UUID())")
  try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

private func observation(
  _ transition: Transition, at: Int64,
  generation: ResetGeneration = .initial, epoch: UUID? = nil,
  id: UUID = UUID()
) -> Observation {
  Observation(
    id: id, generation: generation, transition: transition, observedAtMS: at,
    timezoneID: "UTC", competitionEpochID: epoch)
}

@Test func recordingSurvivesReopenAndRetryIsAtomic() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let first = try TrackingStore(directory: directory, installationID: testInstallation)
  let epoch = UUID()
  try await first.setCompetitionEpoch(epoch)
  let open = observation(.open, at: 1000, epoch: epoch)
  let receipt = try await first.record(open, nowMS: 1000)
  let reopened = try TrackingStore(directory: directory, installationID: testInstallation)
  #expect(first.deviceID == reopened.deviceID)
  let retry = try await reopened.record(open, nowMS: 2000)
  #expect(retry.wasRetry)
  #expect(retry.event == receipt.event)
  let close = try await reopened.record(observation(.close, at: 61000), nowMS: 61000)
  #expect(close.event.sequence == 2)
  let summary = try await reopened.summary()
  #expect(summary.folds == 2)
  #expect(summary.completeDurationMS == 60000)
  let db = try SQLiteConnection(url: directory.appendingPathComponent("journal.sqlite"))
  #expect(try db.rows("SELECT count(*) AS n FROM work_outbox").first?["n"] == "3")
  do {
    _ = try await reopened.record(observation(.close, at: 1000, id: open.id), nowMS: 3000)
    Issue.record("Conflicting retry accepted")
  } catch { #expect(error as? StoreError == .identityConflict) }
  #expect(try await reopened.retainedEvents().count == 2)
}

@Test func setupLeaseIsDurableSingleUseAndExpires() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let first = try TrackingStore(directory: directory, installationID: testInstallation)
  let attempt = try await first.beginSetupTest(expected: .open, nowMS: 1000)
  let second = try TrackingStore(directory: directory, installationID: testInstallation)
  let opposite = try await second.record(observation(.close, at: 2000), nowMS: 2000)
  #expect(!opposite.event.isTest)
  let test = try await second.record(observation(.open, at: 3000), nowMS: 3000)
  #expect(test.event.isTest)
  #expect(try await first.setupTestPassed(attempt.id))
  let real = try await second.record(observation(.open, at: 4000), nowMS: 4000)
  #expect(!real.event.isTest)
  let expired = try await first.beginSetupTest(expected: .close, nowMS: 5000)
  let late = try await second.record(observation(.close, at: 6000), nowMS: expired.expiresAtMS)
  #expect(!late.event.isTest)
  #expect(try await !first.setupTestPassed(expired.id))
  #expect(try await second.summary().folds == 3)
}

@Test func resetRejectsStaleRetriesAndKeepsSequence() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try TrackingStore(directory: directory, installationID: testInstallation)
  let old = observation(.open, at: 1)
  let recorded = try await store.record(old, nowMS: 1)
  try await store.setCompetitionEpoch(UUID())
  let reset = try await store.reset(nowMS: 2)
  try await store.importEvent(recorded.event)
  #expect(try await store.summary().folds == 0)
  do {
    _ = try await store.record(old, nowMS: 3)
    Issue.record("Stale retry resurrected history")
  } catch { #expect(error as? StoreError == .staleGeneration) }
  let current = try await store.record(observation(.close, at: 4, generation: reset), nowMS: 4)
  #expect(current.event.sequence == 2)
  #expect(try await store.summary().cycles == 0)
  let winner = ResetGeneration(revision: reset.revision + 1, resetID: UUID())
  try await store.importReset(winner, createdAtMS: 0)
  #expect(try await store.currentGeneration() == winner)
  #expect(try await store.retainedEvents().isEmpty)
  let db = try SQLiteConnection(url: directory.appendingPathComponent("journal.sqlite"))
  #expect(
    try db.rows("SELECT count(*) AS n FROM work_outbox WHERE kind='competition_event'").first?["n"]
      == "0")
}

@Test func interruptionPersistsAndImportDoesNotUploadPublicly() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let first = try TrackingStore(directory: directory, installationID: testInstallation)
  _ = try await first.record(observation(.open, at: 100), nowMS: 100)
  let marker = try await first.interruption(reason: .deviceRestart, nowMS: 200)
  try await first.recordInterruption(marker)
  try await first.recordInterruption(marker)
  let second = try TrackingStore(directory: directory, installationID: testInstallation)
  _ = try await second.record(observation(.close, at: 300), nowMS: 300)
  #expect(try await second.summary().incompleteSessions == 1)
  #expect(try await second.summary().completeDurationMS == 0)
  let remote = TrackingEvent(
    schemaVersion: 1, eventID: UUID(), deviceID: UUID(), sequence: 1,
    generation: .initial, observedAtMS: 400, timezoneID: "UTC", transition: .open,
    isTest: false, competitionEpochID: UUID())
  try await second.importEvent(remote)
  try await second.importEvent(remote)
  #expect(try await second.summary().folds == 3)
  let db = try SQLiteConnection(url: directory.appendingPathComponent("journal.sqlite"))
  #expect(
    try db.rows(
      "SELECT count(*) AS n FROM work_outbox WHERE entity_id=?",
      [.text(remote.eventID.uuidString.lowercased())]
    ).first?["n"] == "0")
}

#if os(macOS)
  @Test func independentProcessesAllocateUniqueSequences() async throws {
    let directory = try temporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directory) }
    var package = URL(fileURLWithPath: #filePath)
    for _ in 0..<3 { package.deleteLastPathComponent() }
    let binary = package.appendingPathComponent(".build/debug/FoldingJournalProbe")
    let processes = (0..<2).map { _ in
      let process = Process()
      process.executableURL = binary
      process.arguments = [directory.path, "25"]
      return process
    }
    for process in processes { try process.run() }
    for process in processes {
      process.waitUntilExit()
      #expect(process.terminationStatus == 0)
    }
    let store = try TrackingStore(directory: directory, installationID: testInstallation)
    let events = try await store.retainedEvents()
    #expect(events.count == 50)
    #expect(Set(events.map(\.sequence)) == Set((1...50).map(Int64.init)))
    #expect(Set(events.map(\.deviceID)).count == 1)
    let db = try SQLiteConnection(url: directory.appendingPathComponent("journal.sqlite"))
    #expect(try db.rows("SELECT count(*) AS n FROM work_outbox").first?["n"] == "50")
  }

#endif

@Test func expiredMirrorLeaseCannotAcknowledgeNewOwner() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try TrackingStore(directory: directory, installationID: testInstallation)
  _ = try await store.record(observation(.open, at: 1), nowMS: 1)
  let first = try #require(await store.leaseMirrorWork(nowMS: 1).first)
  #expect(try await store.leaseMirrorWork(nowMS: 2).isEmpty)
  let second = try #require(await store.leaseMirrorWork(nowMS: 60001).first)
  #expect(first.workID == second.workID)
  #expect(first.token != second.token)
  try await store.acknowledgeMirror(first)
  try await store.retryMirror(second, atMS: 70000)
  #expect(try await store.leaseMirrorWork(nowMS: 69999).isEmpty)
  let third = try #require(await store.leaseMirrorWork(nowMS: 70000).first)
  try await store.acknowledgeMirror(third)
  #expect(try await store.leaseMirrorWork(nowMS: 200000).isEmpty)
}

@Test func restoredInterruptionPreventsFabricatedDuration() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try TrackingStore(directory: directory, installationID: testInstallation)
  let device = UUID()
  for (sequence, kind, time) in [(Int64(2), Transition.close, Int64(5000)), (1, .open, 1000)] {
    try await store.importEvent(
      TrackingEvent(
        schemaVersion: 1, eventID: UUID(), deviceID: device,
        sequence: sequence, generation: .initial, observedAtMS: time, timezoneID: "UTC",
        transition: kind, isTest: false, competitionEpochID: nil))
  }
  try await store.importInterruption(
    TrackingInterruption(
      interruptionID: UUID(), deviceID: device,
      generation: .initial, afterSequence: 1, reason: .deviceRestart, observedAtMS: 2000))
  #expect(try await store.summary().folds == 2)
  #expect(try await store.summary().completeDurationMS == 0)
  #expect(try await store.summary().incompleteSessions == 1)
  #expect(try await store.leaseMirrorWork(nowMS: 5000).isEmpty)
}

@Test func outboxFailureRollsBackEventSequenceAndTestConsumption() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try TrackingStore(directory: directory, installationID: testInstallation)
  let attempt = try await store.beginSetupTest(expected: .open, nowMS: 1)
  let db = try SQLiteConnection(url: directory.appendingPathComponent("journal.sqlite"))
  try db.execute(
    """
    CREATE TRIGGER reject_outbox BEFORE INSERT ON work_outbox
    BEGIN SELECT RAISE(ABORT, 'injected outbox write failure'); END
    """)
  let open = observation(.open, at: 2)
  do {
    _ = try await store.record(open, nowMS: 2)
    Issue.record("Recording acknowledged despite outbox failure")
  } catch { #expect(error as? StoreError == .database(19)) }
  #expect(try await store.retainedEvents().isEmpty)
  #expect(try await !store.setupTestPassed(attempt.id))
  try db.execute("DROP TRIGGER reject_outbox")
  let receipt = try await store.record(open, nowMS: 3)
  #expect(receipt.event.sequence == 1)
  #expect(receipt.event.isTest)
  #expect(try await store.setupTestPassed(attempt.id))
}

@Test func importedWinnerRetainsPublicResetObligation() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try TrackingStore(directory: directory, installationID: testInstallation)
  try await store.setCompetitionEpoch(UUID())
  let local = try await store.reset(nowMS: 1)
  let winner = ResetGeneration(revision: local.revision + 1, resetID: UUID())
  try await store.importReset(winner, createdAtMS: 2)
  let db = try SQLiteConnection(url: directory.appendingPathComponent("journal.sqlite"))
  let pending = try db.rows("SELECT entity_id FROM work_outbox WHERE kind='competition_reset'")
  #expect(pending.count == 1)
  #expect(pending.first?["entity_id"] == winner.resetID.uuidString.lowercased())
}

@Test func interruptionRetryCannotCrossReset() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try TrackingStore(directory: directory, installationID: testInstallation)
  _ = try await store.record(observation(.open, at: 1), nowMS: 1)
  let interruption = try await store.interruption(reason: .deviceRestart, nowMS: 2)
  try await store.recordInterruption(interruption)
  let reset = try await store.reset(nowMS: 3)
  _ = try await store.record(observation(.open, at: 4, generation: reset), nowMS: 4)
  do {
    try await store.recordInterruption(interruption)
    Issue.record("Old interruption accepted into new generation")
  } catch { #expect(error as? StoreError == .staleGeneration) }
  _ = try await store.record(observation(.close, at: 10, generation: reset), nowMS: 10)
  #expect(try await store.summary().completeDurationMS == 6)
  #expect(try await store.summary().cycles == 1)
}

@Test func restoredJournalUsesNewInstallationWithoutReusingPublicGrant() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let original = try TrackingStore(directory: directory, installationID: testInstallation)
  let epoch = UUID()
  try await original.setCompetitionEpoch(epoch)
  let old = try await original.record(observation(.open, at: 1, epoch: epoch), nowMS: 1)
  let replacementID = UUID()
  let restored = try TrackingStore(directory: directory, installationID: replacementID)
  #expect(try await restored.currentCompetitionEpoch() == nil)
  let new = try await restored.record(observation(.close, at: 2), nowMS: 2)
  #expect(new.event.deviceID == replacementID)
  #expect(new.event.sequence == 1)
  #expect(new.event.deviceID != old.event.deviceID)
  #expect(try await restored.summary().incompleteSessions == 1)
  #expect(try await restored.summary().cycles == 0)
}

@Test func retiredHandleCannotWriteOrReenroll() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let old = try TrackingStore(directory: directory, installationID: testInstallation)
  _ = try TrackingStore(directory: directory, installationID: UUID())
  do {
    _ = try await old.record(observation(.open, at: 1), nowMS: 1)
    Issue.record("Retired installation wrote an event")
  } catch { #expect(error as? StoreError == .installationChanged) }
  do {
    try await old.setCompetitionEpoch(UUID())
    Issue.record("Retired installation re-enrolled")
  } catch { #expect(error as? StoreError == .installationChanged) }
}

@Test func publicRetryAndTerminalSuspensionSurviveReopenWithoutErasingPrivateEvents() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try TrackingStore(directory: directory, installationID: testInstallation)
  let epoch = UUID()
  try await store.setCompetitionEpoch(epoch)
  _ = try await store.record(observation(.open, at: 1000, epoch: epoch), nowMS: 1000)
  let work = try #require(await store.leaseCompetitionUpload(nowMS: 1000))
  try await store.retryCompetitionUpload(work, atMS: 90000)
  let reopened = try TrackingStore(directory: directory, installationID: testInstallation)
  #expect(try await reopened.leaseCompetitionUpload(nowMS: 89999) == nil)
  let retry = try #require(await reopened.leaseCompetitionUpload(nowMS: 90000))
  #expect(retry.operationID == work.operationID)
  #expect(retry.body == work.body)
  #expect(retry.attempts == 1)
  try await reopened.stopCompetitionUpload(retry, reason: "restricted")
  let again = try TrackingStore(directory: directory, installationID: testInstallation)
  #expect(try await again.leaseCompetitionUpload(nowMS: 1_000_000) == nil)
  #expect(try await again.retainedEvents().count == 1)
  let generation = try await again.reset(nowMS: 1_000_001)
  let reset = try #require(await again.leaseCompetitionUpload(nowMS: 1_000_002))
  #expect(reset.isReset)
  #expect(reset.generation == generation)
}

@Test func competitionBatchCooldownIsSharedAcrossReopensAndCombinesTransitions() async throws {
  let directory = try temporaryDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try TrackingStore(directory: directory, installationID: testInstallation)
  let epoch = UUID()
  try await store.setCompetitionEpoch(epoch)
  _ = try await store.record(observation(.open, at: 1000, epoch: epoch), nowMS: 1000)
  let first = try #require(await store.leaseCompetitionUpload(nowMS: 1000))
  try await store.acknowledgeCompetitionUpload(first, dispositions: ["accepted"])
  let reopened = try TrackingStore(directory: directory, installationID: testInstallation)
  _ = try await reopened.record(observation(.close, at: 2000, epoch: epoch), nowMS: 2000)
  _ = try await reopened.record(observation(.open, at: 3000, epoch: epoch), nowMS: 3000)
  #expect(try await reopened.leaseCompetitionUpload(nowMS: 60_999) == nil)
  let combined = try #require(await reopened.leaseCompetitionUpload(nowMS: 61_000))
  #expect(combined.eventIDs.count == 2)
}
