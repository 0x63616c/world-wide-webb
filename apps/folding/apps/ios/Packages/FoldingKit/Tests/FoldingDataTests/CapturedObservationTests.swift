import Darwin
import FoldingDomain
import Foundation
import Testing

@testable import FoldingData

private let captureInstallation = UUID(uuidString: "12345678-1234-4234-8234-123456789abc")!
private func captureDirectory() -> URL {
  FileManager.default.temporaryDirectory.appendingPathComponent("folding-capture-\(UUID())")
}

@Test func captureSurvivesReopenBeforeProcessingAndKeepsOriginalFacts() async throws {
  let root = captureDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: captureInstallation)
  let id = UUID()
  let captured = try await store.capture(
    .open, id: id, observedAtMS: 1000, timezoneID: "America/Los_Angeles", nowMS: 1000)
  #expect(captured.eventID == id)
  #expect(try await store.summary().folds == 0)
  #expect(try await store.captureRetryStatus().pending == 1)
  let reopened = try TrackingStore(directory: root, installationID: captureInstallation)
  let lease = try #require(try await reopened.claimCapturedObservation(nowMS: 2000))
  #expect(lease.event.eventID == id)
  #expect(lease.event.observedAtMS == 1000)
  #expect(lease.event.timezoneID == "America/Los_Angeles")
  #expect(lease.event.sequence == 1)
  _ = try await reopened.commitCapturedObservation(lease, nowMS: 2000)
  try await reopened.acknowledgeCapturedObservation(lease)
  #expect(try await reopened.summary().folds == 1)
  #expect(try await reopened.captureRetryStatus().pending == 0)
}

@Test func commitBeforeAcknowledgementReplaysWithoutDuplicateEventsOrOutboxes() async throws {
  let root = captureDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: captureInstallation)
  try await store.setCompetitionEpoch(UUID())
  _ = try await store.capture(.open, observedAtMS: 1000, timezoneID: "UTC", nowMS: 1000)
  let first = try #require(try await store.claimCapturedObservation(nowMS: 1000))
  _ = try await store.commitCapturedObservation(first, nowMS: 1000)
  let reopened = try TrackingStore(directory: root, installationID: captureInstallation)
  #expect(try await reopened.claimCapturedObservation(nowMS: 2000) == nil)
  let retry = try #require(try await reopened.claimCapturedObservation(nowMS: 31_001))
  let result = try await reopened.commitCapturedObservation(retry, nowMS: 31_001)
  #expect(result.wasRetry)
  try await store.acknowledgeCapturedObservation(first)  // stale token cannot steal the new lease
  #expect(try await reopened.captureRetryStatus().pending == 1)
  try await reopened.acknowledgeCapturedObservation(retry)
  let db = try SQLiteConnection(url: root.appendingPathComponent("journal.sqlite"))
  let rows = try db.rows("SELECT kind,count(*) AS n FROM work_outbox GROUP BY kind")
  #expect(rows.first { $0["kind"] == "mirror_event" }?["n"] == "1")
  #expect(rows.first { $0["kind"] == "competition_event" }?["n"] == "1")
  #expect(try await reopened.retainedEvents().count == 1)
}

@Test func persistentBackoffAndHeadLeasePreventLaterTransitionsOvertaking() async throws {
  let root = captureDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: captureInstallation)
  let firstID = UUID()
  _ = try await store.capture(
    .open, id: firstID, observedAtMS: 1000, timezoneID: "UTC", nowMS: 1000)
  _ = try await store.capture(.close, observedAtMS: 2000, timezoneID: "UTC", nowMS: 2000)
  let lease = try #require(try await store.claimCapturedObservation(nowMS: 2000))
  let other = try TrackingStore(directory: root, installationID: captureInstallation)
  #expect(try await other.claimCapturedObservation(nowMS: 2001) == nil)
  try await store.retryCapturedObservation(lease, nowMS: 2000)
  let reopened = try TrackingStore(directory: root, installationID: captureInstallation)
  #expect(try await reopened.claimCapturedObservation(nowMS: 2999) == nil)
  let retry = try #require(try await reopened.claimCapturedObservation(nowMS: 3000))
  #expect(retry.event.eventID == firstID)
  _ = try await reopened.commitCapturedObservation(retry, nowMS: 3000)
  try await reopened.acknowledgeCapturedObservation(retry)
  let second = try #require(try await reopened.claimCapturedObservation(nowMS: 3001))
  #expect(second.event.transition == .close)
  _ = try await reopened.commitCapturedObservation(second, nowMS: 3001)
  try await reopened.acknowledgeCapturedObservation(second)
  #expect(try await reopened.summary().folds == 2)
  #expect(try await reopened.summary().cycles == 1)
}

@Test func resetAtomicallyRemovesCapturesAndMakesOldLeasesUnusable() async throws {
  let root = captureDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: captureInstallation)
  _ = try await store.capture(.open, observedAtMS: 1000, timezoneID: "UTC", nowMS: 1000)
  let lease = try #require(try await store.claimCapturedObservation(nowMS: 1000))
  _ = try await store.reset(nowMS: 2000)
  do {
    _ = try await store.commitCapturedObservation(lease, nowMS: 2000)
    Issue.record("Reset capture restored")
  } catch CaptureError.invalidLease {}
  #expect(try await store.captureRetryStatus().pending == 0)
  #expect(try await store.summary().folds == 0)
}

@Test func capturedSetupTestIsAttributedAtCaptureAndNeverBecomesAnOrdinaryFold() async throws {
  let root = captureDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: captureInstallation)
  let attempt = try await store.beginSetupTest(expected: .open, nowMS: 1000)
  _ = try await store.capture(.open, observedAtMS: 2000, timezoneID: "UTC", nowMS: 2000)
  #expect(try await store.setupTestPassed(attempt.id))
  let lease = try #require(try await store.claimCapturedObservation(nowMS: 200_000))
  #expect(lease.event.isTest)
  _ = try await store.commitCapturedObservation(lease, nowMS: 200_000)
  try await store.acknowledgeCapturedObservation(lease)
  #expect(try await store.summary().folds == 0)
  #expect(try await store.setupTestPassed(attempt.id))
}

@Test func capturesNeverGainCompetitionEligibilityAfterJoinOrTransfer() async throws {
  let root = captureDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: captureInstallation)
  _ = try await store.capture(.open, observedAtMS: 1000, timezoneID: "UTC", nowMS: 1000)
  let epoch = UUID()
  try await store.setCompetitionEpoch(epoch)
  var lease = try #require(try await store.claimCapturedObservation(nowMS: 2000))
  #expect(lease.event.competitionEpochID == nil)
  _ = try await store.commitCapturedObservation(lease, nowMS: 2000)
  try await store.acknowledgeCapturedObservation(lease)
  _ = try await store.capture(.close, observedAtMS: 3000, timezoneID: "UTC", nowMS: 3000)
  try await store.setCompetitionEpoch(UUID())
  lease = try #require(try await store.claimCapturedObservation(nowMS: 4000))
  #expect(lease.event.competitionEpochID == epoch)
  _ = try await store.commitCapturedObservation(lease, nowMS: 4000)
  try await store.acknowledgeCapturedObservation(lease)
  #expect(try await store.pendingCompetitionEventCount() == 0)
  #expect(try await store.summary().folds == 2)
}

@Test func captureDeduplicatesAndRejectsConflictingRetriesBeforeProcessing() async throws {
  let root = captureDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: captureInstallation)
  let id = UUID()
  _ = try await store.capture(.open, id: id, observedAtMS: 1000, timezoneID: "UTC", nowMS: 1000)
  #expect(
    try await store.capture(.open, id: id, observedAtMS: 1000, timezoneID: "UTC", nowMS: 2000)
      .wasRetry)
  do {
    _ = try await store.capture(.close, id: id, observedAtMS: 1000, timezoneID: "UTC", nowMS: 2000)
    Issue.record("Conflicting capture accepted")
  } catch StoreError.identityConflict {}
  #expect(try await store.captureRetryStatus().pending == 1)
}

@Test func accountFenceAndInstallationReplacementCannotReplayIntoAnotherHistory() async throws {
  let root = captureDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let router = AccountPartitionRouter(directory: root)
  let accountA = PrivateAccountIdentity.local(UUID())
  let accountB = PrivateAccountIdentity.local(UUID())
  let leaseA = try router.activate(
    accountA, transition: router.suspend(), installationID: captureInstallation)
  let old = try router.openJournal(lease: leaseA, installationID: captureInstallation)
  _ = try await old.capture(.open, observedAtMS: 1000, timezoneID: "UTC", nowMS: 1000)
  let pending = try #require(try await old.claimCapturedObservation(nowMS: 1000))
  let leaseB = try router.activate(
    accountB, transition: router.suspend(), installationID: captureInstallation)
  let current = try router.openJournal(lease: leaseB, installationID: captureInstallation)
  do {
    _ = try await old.commitCapturedObservation(pending, nowMS: 2000)
    Issue.record("Old account replayed")
  } catch PartitionError.inactive {}
  #expect(try await current.captureRetryStatus().pending == 0)
  #expect(try await current.summary().folds == 0)
  let returned = try router.activate(
    accountA, transition: router.suspend(), installationID: captureInstallation)
  let reopened = try router.openJournal(lease: returned, installationID: captureInstallation)
  #expect(try await reopened.captureRetryStatus().pending == 1)
  let replacement = UUID()
  let replacementLease = try router.activate(
    accountA, transition: router.suspend(), installationID: replacement)
  let replaced = try router.openJournal(lease: replacementLease, installationID: replacement)
  #expect(try await replaced.captureRetryStatus().pending == 0)
  #expect(try await replaced.captureRetryStatus().quarantined == 1)
}

@Test func independentHandlesCaptureOneSequenceAndLeaseTheHeadOnlyOnce() async throws {
  let root = captureDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let first = try TrackingStore(directory: root, installationID: captureInstallation)
  let second = try TrackingStore(directory: root, installationID: captureInstallation)
  try await withThrowingTaskGroup(of: Void.self) { group in
    for n in 0..<40 {
      group.addTask {
        _ = try await (n.isMultiple(of: 2) ? first : second).capture(
          n.isMultiple(of: 2) ? .open : .close,
          observedAtMS: Int64(n), timezoneID: "UTC", nowMS: 1000)
      }
    }
    try await group.waitForAll()
  }
  let db = try SQLiteConnection(url: root.appendingPathComponent("journal.sqlite"))
  let rows = try db.rows(
    "SELECT COUNT(*) AS n,COUNT(DISTINCT sequence) AS unique_n,MIN(sequence) AS lo,MAX(sequence) AS hi FROM captured_observations"
  )
  #expect(rows.first?["n"] == "40")
  #expect(rows.first?["unique_n"] == "40")
  #expect(rows.first?["lo"] == "1")
  #expect(rows.first?["hi"] == "40")
  async let a = first.claimCapturedObservation(nowMS: 2000)
  async let b = second.claimCapturedObservation(nowMS: 2000)
  let leases = try await [a, b]
  #expect(leases.compactMap { $0 }.count == 1)
}

#if os(macOS)
  @Test func killedProcessRecoversCaptureBeforeProcessingAndAfterCommitBeforeAck() async throws {
    for mode in ["--capture-wait", "--capture-commit-wait"] {
      let root = captureDirectory()
      defer { try? FileManager.default.removeItem(at: root) }
      var package = URL(fileURLWithPath: #filePath)
      for _ in 0..<3 { package.deleteLastPathComponent() }
      let process = Process()
      process.executableURL = package.appendingPathComponent(".build/debug/FoldingJournalProbe")
      process.arguments = [mode, root.path]
      try process.run()
      defer {
        if process.isRunning {
          kill(process.processIdentifier, SIGKILL)
          process.waitUntilExit()
        }
      }
      let deadline = ContinuousClock.now + .seconds(10)
      while !FileManager.default.fileExists(
        atPath: root.appendingPathComponent("capture-ready").path)
      {
        guard process.isRunning, ContinuousClock.now < deadline else { throw PartitionError.busy }
        try await Task.sleep(for: .milliseconds(5))
      }
      kill(process.processIdentifier, SIGKILL)
      process.waitUntilExit()
      #expect(process.terminationReason == .uncaughtSignal)
      let store = try TrackingStore(directory: root, installationID: captureInstallation)
      let lease = try #require(try await store.claimCapturedObservation(nowMS: 40_000))
      #expect(lease.event.eventID == UUID(uuidString: "aaaaaaaa-0000-4000-8000-000000000001"))
      #expect(lease.event.observedAtMS == 1234)
      let receipt = try await store.commitCapturedObservation(lease, nowMS: 40_000)
      #expect(receipt.wasRetry == (mode == "--capture-commit-wait"))
      try await store.acknowledgeCapturedObservation(lease)
      #expect(try await store.summary().folds == 1)
      #expect(try await store.captureRetryStatus().pending == 0)
    }
  }
#endif

@Test func migrationFromVersionEightPreservesHistoryAndSequenceForDurableCapture() async throws {
  let root = captureDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let old = try TrackingStore(directory: root, installationID: captureInstallation)
  _ = try await old.record(
    Observation(generation: .initial, transition: .open, observedAtMS: 1000, timezoneID: "UTC"),
    nowMS: 1000)
  let db = try SQLiteConnection(url: root.appendingPathComponent("journal.sqlite"))
  try db.transaction {
    try db.execute("DROP TABLE captured_observations")
    try db.execute("PRAGMA user_version=8")
  }
  let upgraded = try TrackingStore(directory: root, installationID: captureInstallation)
  #expect(try await upgraded.summary().folds == 1)
  _ = try await upgraded.capture(.close, observedAtMS: 2000, timezoneID: "UTC", nowMS: 2000)
  let lease = try #require(try await upgraded.claimCapturedObservation(nowMS: 2000))
  #expect(lease.event.sequence == 2)
  _ = try await upgraded.commitCapturedObservation(lease, nowMS: 2000)
  try await upgraded.acknowledgeCapturedObservation(lease)
  #expect(try await upgraded.summary().folds == 2)
  #expect(try await upgraded.summary().cycles == 1)
}

@Test func uncommittedCaptureCannotBeAcknowledgedAndInvalidInputIsNotAccepted() async throws {
  let root = captureDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: captureInstallation)
  _ = try await store.capture(.open, observedAtMS: 1000, timezoneID: "UTC", nowMS: 1000)
  let lease = try #require(try await store.claimCapturedObservation(nowMS: 1000))
  do {
    try await store.acknowledgeCapturedObservation(lease)
    Issue.record("Unprocessed capture acknowledged")
  } catch StoreError.invalidInput {}
  #expect(try await store.captureRetryStatus().pending == 1)
  do {
    _ = try await store.capture(.open, observedAtMS: -1, timezoneID: "UTC", nowMS: 1000)
    Issue.record("Invalid capture accepted")
  } catch {}
  #expect(try await store.captureRetryStatus().pending == 1)
}

@Test func capturedConflictsAreQuarantinedAndCannotFeedCompetition() async throws {
  let root = captureDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: captureInstallation)
  let id = UUID()
  try await store.setCompetitionEpoch(UUID())
  _ = try await store.capture(.open, id: id, observedAtMS: 1000, timezoneID: "UTC", nowMS: 1000)
  let lease = try #require(try await store.claimCapturedObservation(nowMS: 1000))
  let conflict = TrackingEvent(
    schemaVersion: 1, eventID: id, deviceID: captureInstallation,
    sequence: lease.event.sequence, generation: .initial, observedAtMS: 1000, timezoneID: "UTC",
    transition: .close, isTest: false, competitionEpochID: lease.event.competitionEpochID)
  _ = try await store.importMirrorBatch([.event(conflict)], storeID: "conflict", checkpoint: nil)
  do {
    _ = try await store.commitCapturedObservation(lease, nowMS: 1000)
    Issue.record("Conflicted capture committed")
  } catch StoreError.identityConflict {}
  try await store.retryCapturedObservation(lease, nowMS: 1000, quarantine: true)
  #expect(try await store.captureRetryStatus().quarantined == 1)
  #expect(try await store.summary().folds == 0)
  #expect(try await store.pendingCompetitionEventCount() == 0)
}

@Test func clockRollbackDoesNotStrandAPersistedCaptureLease() async throws {
  let root = captureDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: captureInstallation)
  _ = try await store.capture(.open, observedAtMS: 1000, timezoneID: "UTC", nowMS: 1000)
  let first = try #require(try await store.claimCapturedObservation(nowMS: 1_000_000))
  let recovered = try #require(try await store.claimCapturedObservation(nowMS: 2000))
  do {
    _ = try await store.commitCapturedObservation(first, nowMS: 1_000_001)
    Issue.record("Reclaimed lease committed")
  } catch CaptureError.invalidLease {}
  _ = try await store.commitCapturedObservation(recovered, nowMS: 2000)
  try await store.acknowledgeCapturedObservation(recovered)
  #expect(try await store.summary().folds == 1)
}

@Test func captureAppliesDailyPreferencesBeforeReservingSequenceAndClaimIsRetrySafe() async throws {
  let root = captureDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: captureInstallation)
  _ = try await store.capture(
    .open, observedAtMS: 1000, timezoneID: "UTC", nowMS: 1000,
    dailyLimitPreferences: DailyLimitPreferences(enabled: true, threshold: 1))
  let captured = try #require(try await store.claimCapturedObservation(nowMS: 1000))
  let receipt = try await store.commitCapturedObservation(captured, nowMS: 1000)
  _ = try await store.evaluateDailyLimit(
    afterEventID: receipt.event.eventID, homeTimezone: "UTC", nowMS: 1000)
  _ = try await store.evaluateDailyLimit(
    afterEventID: receipt.event.eventID, homeTimezone: "UTC", nowMS: 1001)
  try await store.acknowledgeCapturedObservation(captured)
  let notification = try #require(try await store.leaseDailyLimitNotification(nowMS: 1002))
  #expect(notification.claim.folds == 1)
  try await store.acknowledgeDailyLimitNotification(notification)
  #expect(try await store.leaseDailyLimitNotification(nowMS: 1003) == nil)
}

@Test func failedCaptureRollsBackPayloadSequenceAndSetupReceiptTogether() async throws {
  let root = captureDirectory()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = try TrackingStore(directory: root, installationID: captureInstallation)
  let attempt = try await store.beginSetupTest(expected: .open, nowMS: 1000)
  let db = try SQLiteConnection(url: root.appendingPathComponent("journal.sqlite"))
  try db.execute(
    "CREATE TRIGGER fail_capture AFTER UPDATE ON setup_attempt WHEN NEW.status='consumed' BEGIN SELECT RAISE(ABORT,'injected capture fault'); END"
  )
  do {
    _ = try await store.capture(.open, observedAtMS: 2000, timezoneID: "UTC", nowMS: 2000)
    Issue.record("Failed transaction acknowledged")
  } catch StoreError.database {}
  #expect(try await store.captureRetryStatus().pending == 0)
  #expect(try await store.setupTestPassed(attempt.id) == false)
  try db.execute("DROP TRIGGER fail_capture")
  _ = try await store.capture(.open, observedAtMS: 2000, timezoneID: "UTC", nowMS: 2000)
  let lease = try #require(try await store.claimCapturedObservation(nowMS: 2000))
  #expect(lease.event.sequence == 1)
  #expect(lease.event.isTest)
  #expect(try await store.setupTestPassed(attempt.id))
}
