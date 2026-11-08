import FoldingDomain
import Foundation
import Testing

@testable import FoldingData

private func setupStore() throws -> (URL, TrackingStore, UUID) {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(
    "folding-setup-\(UUID())")
  let identity = UUID()
  return (root, try TrackingStore(directory: root, installationID: identity), identity)
}

@Test func guidedSetupAdvancesOnlyFromCommittedMatchingReceiptsAndSurvivesReopen() async throws {
  let (root, store, identity) = try setupStore()
  defer { try? FileManager.default.removeItem(at: root) }
  #expect(try await store.setupProgress(nowMS: 1).step == .welcome)
  _ = try await store.advanceSetup(.next, nowMS: 1)
  _ = try await store.advanceSetup(.next, nowMS: 1)
  let waiting = try await store.advanceSetup(.test, nowMS: 2)
  #expect(waiting.step == .awaitingOpening)
  _ = try await store.record(
    Observation(generation: .initial, transition: .close, observedAtMS: 3, timezoneID: "UTC"),
    nowMS: 3)
  #expect(try await store.setupProgress(nowMS: 3).step == .awaitingOpening)
  let opened = try await store.record(
    Observation(generation: .initial, transition: .open, observedAtMS: 4, timezoneID: "UTC"),
    nowMS: 4)
  #expect(opened.event.isTest)
  let reopened = try TrackingStore(directory: root, installationID: identity)
  let passed = try await reopened.setupProgress(nowMS: 150000)
  #expect(passed.step == .openingPassed)
  #expect(passed.openingEventID == opened.event.eventID)
  _ = try await reopened.advanceSetup(.next, nowMS: 150000)
  _ = try await reopened.advanceSetup(.next, nowMS: 150000)
  _ = try await reopened.advanceSetup(.test, nowMS: 150001)
  let closed = try await reopened.record(
    Observation(generation: .initial, transition: .close, observedAtMS: 150002, timezoneID: "UTC"),
    nowMS: 150002)
  let completed = try await reopened.advanceSetup(.next, nowMS: 150003)
  #expect(completed.step == .complete)
  #expect(completed.lastCompletion?.closingEventID == closed.event.eventID)
  #expect(try await reopened.summary().folds == 1)
  let restarted = try await reopened.advanceSetup(.restart, nowMS: 150004)
  #expect(restarted.step == .welcome)
  #expect(restarted.lastCompletion == completed.lastCompletion)
  #expect(restarted.flowID != completed.flowID)
}

@Test func setupDismissExpiryAndResetNeverManufacturePassedState() async throws {
  let (root, store, _) = try setupStore()
  defer { try? FileManager.default.removeItem(at: root) }
  _ = try await store.advanceSetup(.next, nowMS: 1)
  _ = try await store.advanceSetup(.next, nowMS: 1)
  _ = try await store.advanceSetup(.test, nowMS: 2)
  #expect(try await store.setupProgress(nowMS: 120002).step == .openingRetry)
  _ = try await store.advanceSetup(.retry, nowMS: 120002)
  _ = try await store.advanceSetup(.test, nowMS: 120003)
  _ = try await store.advanceSetup(.dismiss, nowMS: 120004)
  let real = try await store.record(
    Observation(generation: .initial, transition: .open, observedAtMS: 120005, timezoneID: "UTC"),
    nowMS: 120005)
  #expect(!real.event.isTest)
  #expect(try await store.setupProgress(nowMS: 120005).step == .openingReady)
  _ = try await store.advanceSetup(.test, nowMS: 120006)
  _ = try await store.reset(nowMS: 120007)
  #expect(try await store.setupProgress(nowMS: 120008).step == .openingReady)
}

@Test func setupLeaseAndFlowRollbackTogetherOnProgressWriteFailure() async throws {
  let (root, store, _) = try setupStore()
  defer { try? FileManager.default.removeItem(at: root) }
  _ = try await store.advanceSetup(.next, nowMS: 1)
  _ = try await store.advanceSetup(.next, nowMS: 1)
  let db = try SQLiteConnection(url: root.appendingPathComponent("journal.sqlite"))
  try db.execute(
    "CREATE TRIGGER reject_setup BEFORE INSERT ON settings WHEN NEW.key='setup_progress' BEGIN SELECT RAISE(ABORT,'failure'); END"
  )
  do {
    _ = try await store.advanceSetup(.test, nowMS: 2)
    Issue.record("Failed progress write accepted")
  } catch { #expect(error as? StoreError == .database(19)) }
  #expect(
    try db.rows("SELECT count(*) AS n FROM setup_attempt WHERE status='waiting'").first?["n"] == "0"
  )
}

@Test func quarantinedPassedReceiptRequiresRetestBeforeCompletingSetup() async throws {
  let (root, store, _) = try setupStore()
  defer { try? FileManager.default.removeItem(at: root) }
  _ = try await store.advanceSetup(.next, nowMS: 1)
  _ = try await store.advanceSetup(.next, nowMS: 1)
  let waiting = try await store.advanceSetup(.test, nowMS: 2)
  let receipt = try await store.record(
    Observation(generation: .initial, transition: .open, observedAtMS: 3, timezoneID: "UTC"),
    nowMS: 3)
  #expect(try await store.setupProgress(nowMS: 4).step == .openingPassed)
  let event = receipt.event
  let conflict = TrackingEvent(
    schemaVersion: 1, eventID: event.eventID, deviceID: event.deviceID, sequence: event.sequence,
    generation: event.generation, observedAtMS: event.observedAtMS + 1,
    timezoneID: event.timezoneID, transition: event.transition, isTest: true,
    competitionEpochID: nil)
  try await store.importMirrorBatch([.event(conflict)], storeID: "test", checkpoint: nil)
  #expect(try await store.setupProgress(nowMS: 5).step == .openingReady)
  #expect(try await store.setupTestPassed(waiting.attemptID!) == false)
  do {
    _ = try await store.advanceSetup(.next, nowMS: 5)
    Issue.record("Invalidated pass advanced setup")
  } catch { #expect(error as? StoreError == .invalidInput) }
}

@Test func journalAnalyticsReadsCurrentGenerationAndExcludesSetupEvents() async throws {
  let (root, store, _) = try setupStore()
  defer { try? FileManager.default.removeItem(at: root) }
  _ = try await store.beginSetupTest(expected: .open, nowMS: 1)
  _ = try await store.record(
    Observation(generation: .initial, transition: .open, observedAtMS: 2, timezoneID: "UTC"),
    nowMS: 2)
  _ = try await store.record(
    Observation(generation: .initial, transition: .close, observedAtMS: 3, timezoneID: "UTC"),
    nowMS: 3)
  let snapshot = try await store.analytics(
    homeTimezone: "UTC", asOfMS: 4, range: PersonalDateRange(startMS: 0, endMS: 86_400_000))
  #expect(snapshot.lifetime.folds == 1)
  #expect(snapshot.days.first?.folds == 1)
  let reset = try await store.reset(nowMS: 5)
  let empty = try await store.analytics(
    homeTimezone: "UTC", asOfMS: 6, range: PersonalDateRange(startMS: 0, endMS: 86_400_000))
  #expect(empty.generation == reset)
  #expect(empty.lifetime.folds == 0)
}
