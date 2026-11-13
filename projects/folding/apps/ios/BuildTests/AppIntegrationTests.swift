import Darwin
import FoldingData
import FoldingDomain
import XCTest

@testable import Folding

@MainActor final class AppIntegrationTests: XCTestCase {
  func testShortcutRecordingRetriesBriefPartitionContentionWithoutChangingObservationTime()
    async throws
  {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let installation = UUID()
    let router = AccountPartitionRouter(directory: root)
    let lease = try router.activate(
      .local(UUID()), transition: router.suspend(), installationID: installation)
    let journal = try router.openJournal(lease: lease, installationID: installation)
    let runtime = TrackingRuntime(journal: journal)
    let descriptor = open(root.appendingPathComponent("route.lock").path, O_RDWR)
    XCTAssertGreaterThanOrEqual(descriptor, 0)
    guard descriptor >= 0 else { return }
    defer { close(descriptor) }
    XCTAssertEqual(flock(descriptor, LOCK_EX | LOCK_NB), 0)
    let started = TrackingRuntime.nowMS
    let unlock = Task.detached {
      try await Task.sleep(for: .milliseconds(1200))
      flock(descriptor, LOCK_UN)
    }
    var failure: Error?
    do { try await runtime.record(.open) } catch { failure = error }
    try await unlock.value
    XCTAssertNil(failure, "Log Duo Opened must survive brief partition contention")
    await runtime.replayCapturedObservations()
    let events = try await journal.retainedEvents()
    XCTAssertEqual(events.count, 1)
    if let event = events.first {
      XCTAssertGreaterThanOrEqual(event.observedAtMS, started)
      XCTAssertLessThan(event.observedAtMS, started + 500)
    }
  }

  func testShortcutRetryDoesNotCrossAnAccountChange() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let installation = UUID()
    let router = AccountPartitionRouter(directory: root)
    let lease = try router.activate(
      .local(UUID()), transition: router.suspend(), installationID: installation)
    let journal = try router.openJournal(lease: lease, installationID: installation)
    let runtime = TrackingRuntime(journal: journal)
    let descriptor = open(root.appendingPathComponent("route.lock").path, O_RDWR)
    guard descriptor >= 0 else {
      XCTFail("Could not open route lock")
      return
    }
    defer { close(descriptor) }
    XCTAssertEqual(flock(descriptor, LOCK_EX | LOCK_NB), 0)
    let unlock = Task.detached {
      try await Task.sleep(for: .milliseconds(1200))
      flock(descriptor, LOCK_UN)
    }
    let change = Task {
      try await Task.sleep(for: .milliseconds(100))
      try await runtime.suspendForAccountChange(revision: UUID())
    }
    var failure: Error?
    do { try await runtime.record(.open) } catch { failure = error }
    try await unlock.value
    try await change.value
    XCTAssertEqual(failure as? PartitionError, .superseded)
    let events = try await journal.retainedEvents()
    XCTAssertTrue(events.isEmpty)
  }

  func testShortcutDoesNotAcknowledgeAnObservationWhilePartitionStaysBusy() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let installation = UUID()
    let router = AccountPartitionRouter(directory: root)
    let lease = try router.activate(
      .local(UUID()), transition: router.suspend(), installationID: installation)
    let journal = try router.openJournal(lease: lease, installationID: installation)
    let runtime = TrackingRuntime(journal: journal)
    let descriptor = open(root.appendingPathComponent("route.lock").path, O_RDWR)
    guard descriptor >= 0 else {
      XCTFail("Could not open route lock")
      return
    }
    defer { close(descriptor) }
    XCTAssertEqual(flock(descriptor, LOCK_EX | LOCK_NB), 0)
    // If retry accidentally becomes unbounded, release the test lock so the test
    // fails on an acknowledged observation instead of hanging the entire suite.
    let safetyRelease = Task.detached {
      try await Task.sleep(for: .seconds(6))
      flock(descriptor, LOCK_UN)
    }
    var failure: Error?
    do { try await runtime.record(.open) } catch { failure = error }
    safetyRelease.cancel()
    _ = try? await safetyRelease.value
    flock(descriptor, LOCK_UN)
    XCTAssertEqual(failure as? PartitionError, .busy)
    let events = try await journal.retainedEvents()
    XCTAssertTrue(events.isEmpty)
  }

  func testRecordingAcknowledgesDurableCaptureWhileProcessingIsLeasedAndRestartResumes()
    async throws
  {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let installation = UUID()
    let journal = try TrackingStore(directory: directory, installationID: installation)
    let now = TrackingRuntime.nowMS
    _ = try await journal.capture(.open, observedAtMS: now, timezoneID: "UTC", nowMS: now)
    let claimed = try await journal.claimCapturedObservation(nowMS: now)
    let held = try XCTUnwrap(claimed)
    let runtime = TrackingRuntime(journal: journal)
    try await runtime.record(.close)
    let pending = try await journal.captureRetryStatus()
    XCTAssertEqual(pending.pending, 2)
    let before = try await journal.summary()
    XCTAssertEqual(before.folds, 0)
    // Stop the old owner before simulating a later process; its unstructured
    // best-effort task must not race the new owner in this integration fixture.
    try await runtime.suspendForAccountChange(revision: UUID())
    // A later process has only the on-disk queue, not the old runtime's event IDs.
    try await journal.retryCapturedObservation(held, nowMS: now - 1000)
    let reopened = try TrackingStore(directory: directory, installationID: installation)
    let restarted = TrackingRuntime(journal: reopened)
    await restarted.replayCapturedObservations()
    let after = try await reopened.summary()
    XCTAssertEqual(after.folds, 2)
    XCTAssertEqual(after.cycles, 1)
    let empty = try await reopened.captureRetryStatus()
    XCTAssertEqual(empty.pending, 0)
  }

  func testCapturedReplayProcessesBoundedBatchesAcrossSubsequentRuns() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let installation = UUID()
    let journal = try TrackingStore(directory: directory, installationID: installation)
    let now = TrackingRuntime.nowMS
    for n in 0..<30 {
      _ = try await journal.capture(
        n.isMultiple(of: 2) ? .open : .close,
        observedAtMS: now - 100 + Int64(n), timezoneID: "UTC", nowMS: now)
    }
    let runtime = TrackingRuntime(journal: journal)
    await runtime.replayCapturedObservations()
    let partial = try await journal.captureRetryStatus()
    XCTAssertEqual(partial.pending, 5)
    await runtime.replayCapturedObservations()
    let completed = try await journal.captureRetryStatus()
    XCTAssertEqual(completed.pending, 0)
    let result = try await journal.summary()
    XCTAssertEqual(result.folds, 30)
  }

  func testRuntimeSetupReceiptsFeedRealScreensWithoutCountingTests() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
      "folding-app-test-\(UUID())")
    let suite = "folding.tests.\(UUID())"
    let preferences = UserDefaults(suiteName: suite)!
    preferences.set(true, forKey: "folding.didPresentInitialSetup")
    defer {
      try? FileManager.default.removeItem(at: directory)
      preferences.removePersistentDomain(forName: suite)
    }
    let journal = try TrackingStore(directory: directory, installationID: UUID())
    let runtime = TrackingRuntime(journal: journal)
    let controller = AppController(runtime: runtime, preferencesStore: preferences)
    try await controller.refresh()
    XCTAssertEqual(controller.presentation.setup?.step, .welcome)
    XCTAssertTrue(controller.presentation.hasLoadedInitialState)
    XCTAssertTrue(controller.presentation.showInitialSetup)
    XCTAssertEqual(controller.presentation.analytics?.lifetime.folds, 0)
    _ = try await controller.actions.setup(.next)
    _ = try await controller.actions.setup(.next)
    _ = try await controller.actions.setup(.test)
    try await runtime.record(.open)
    try await controller.refresh()
    XCTAssertEqual(controller.presentation.setup?.step, .openingPassed)
    XCTAssertEqual(controller.presentation.analytics?.lifetime.folds, 0)
    _ = try await controller.actions.setup(.next)
    _ = try await controller.actions.setup(.next)
    _ = try await controller.actions.setup(.test)
    try await runtime.record(.close)
    _ = try await controller.actions.setup(.next)
    try await controller.refresh()
    XCTAssertEqual(controller.presentation.setup?.step, .complete)
    let relaunched = AppController(runtime: runtime, preferencesStore: preferences)
    try await relaunched.refresh()
    XCTAssertFalse(relaunched.presentation.showInitialSetup)
    XCTAssertEqual(controller.presentation.analytics?.lifetime.folds, 0)
    try await runtime.record(.open)
    try await runtime.record(.close)
    try await controller.refresh()
    XCTAssertEqual(controller.presentation.analytics?.lifetime.folds, 2)
    let history = try await controller.actions.loadHistory!(.day, 0)
    XCTAssertEqual(history.folds, 2)
    XCTAssertTrue((23...25).contains(history.bins.count))
    await controller.presentation.requestHistory(using: controller.actions)
    XCTAssertEqual(controller.presentation.history?.folds, 2)
    try await runtime.record(.open)
    await controller.refreshVisible()
    XCTAssertEqual(controller.presentation.history?.folds, 3)
    try await controller.actions.reset!()
    XCTAssertEqual(controller.presentation.analytics?.lifetime.folds, 0)
    XCTAssertEqual(controller.presentation.setup?.step, .openingReady)
  }

  func testPrivatePhoneSelectionExcludesUnknownOldPhoneEvents() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let suite = "folding.transfer.test.\(UUID())"
    let defaults = UserDefaults(suiteName: suite)!
    defer {
      try? FileManager.default.removeItem(at: directory)
      defaults.removePersistentDomain(forName: suite)
    }
    let local = UUID()
    let other = UUID()
    let journal = try TrackingStore(directory: directory, installationID: local)
    let runtime = TrackingRuntime(journal: journal)
    let controller = AppController(runtime: runtime, preferencesStore: defaults)
    try await runtime.record(.open)
    let now = TrackingRuntime.nowMS
    try await journal.importEvent(
      TrackingEvent(
        schemaVersion: 1, eventID: UUID(), deviceID: other, sequence: 1, generation: .initial,
        observedAtMS: now, timezoneID: "UTC", transition: .open, isTest: false,
        competitionEpochID: nil))
    try await controller.refresh()
    XCTAssertTrue(controller.presentation.analytics!.needsDeviceSelection)
    XCTAssertEqual(controller.presentation.analytics?.lifetime.folds, 2)
    try await controller.actions.useThisPhone!()
    XCTAssertEqual(controller.presentation.localDeviceID, local)
    XCTAssertEqual(controller.presentation.analytics?.selectedDeviceID, local)
    try await journal.importEvent(
      TrackingEvent(
        schemaVersion: 1, eventID: UUID(), deviceID: other, sequence: 2, generation: .initial,
        observedAtMS: now + 1, timezoneID: "UTC", transition: .close, isTest: false,
        competitionEpochID: nil))
    await controller.refreshVisible()
    XCTAssertEqual(controller.presentation.analytics?.lifetime.folds, 2)
    XCTAssertFalse(controller.presentation.analytics!.needsDeviceSelection)
    let retained = try await journal.retainedEvents()
    XCTAssertEqual(retained.count, 3)
  }

  func testForegroundWatcherNoticesAnotherJournalConnection() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let suite = "folding.foreground.test.\(UUID())"
    let defaults = UserDefaults(suiteName: suite)!
    defer {
      try? FileManager.default.removeItem(at: directory)
      defaults.removePersistentDomain(forName: suite)
    }
    let source = UUID()
    let journal = try TrackingStore(directory: directory, installationID: source)
    let otherConnection = try TrackingStore(directory: directory, installationID: source)
    let controller = AppController(
      runtime: TrackingRuntime(journal: journal), preferencesStore: defaults)
    try await controller.refresh()
    let watcher = Task { await controller.watchJournalChanges() }
    let now = TrackingRuntime.nowMS
    _ = try await otherConnection.record(
      Observation(
        generation: .initial, transition: .open,
        observedAtMS: now, timezoneID: "UTC", competitionEpochID: nil), nowMS: now)
    for _ in 0..<40 {
      if controller.presentation.analytics?.lifetime.folds == 1 { break }
      try await Task.sleep(for: .milliseconds(100))
    }
    watcher.cancel()
    await watcher.value
    XCTAssertEqual(controller.presentation.analytics?.lifetime.folds, 1)
  }

  func testSignedOutResultPreferencesAreRejectedBeforeTheyAreSaved() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let suite = "folding.notifications.test.\(UUID())"
    let defaults = UserDefaults(suiteName: suite)!
    defer {
      try? FileManager.default.removeItem(at: directory)
      defaults.removePersistentDomain(forName: suite)
    }
    let journal = try TrackingStore(directory: directory, installationID: UUID())
    let controller = AppController(
      runtime: TrackingRuntime(journal: journal), preferencesStore: defaults)
    var requested = NotificationPreferences()
    requested.weeklyResult = .all
    do {
      _ = try await controller.actions.saveNotifications?(requested)
      XCTFail("Signed-out result preferences must be unavailable")
    } catch CompetitionTransportError.unauthorized {} catch {
      XCTFail("Unexpected error: \(error)")
    }
    XCTAssertNil(defaults.data(forKey: "folding.notifications.v1"))
  }

  func testDevelopmentCompositionOpensRealSandboxAndKeychain() async throws {
    let first = TrackingRuntime()
    let firstJournal = try await first.store()
    let generation = try await firstJournal.currentGeneration()
    let reopened = TrackingRuntime()
    let secondJournal = try await reopened.store()
    let reopenedGeneration = try await secondJournal.currentGeneration()
    XCTAssertEqual(generation, reopenedGeneration)
  }

  func testExportCleanupFailureDoesNotHideHealthyTracking() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let suite = "folding.cleanup.test.\(UUID())"
    let defaults = UserDefaults(suiteName: suite)!
    defer {
      try? FileManager.default.removeItem(at: directory)
      defaults.removePersistentDomain(forName: suite)
    }
    let journal = try TrackingStore(directory: directory, installationID: UUID())
    let runtime = TrackingRuntime(journal: journal)
    try await runtime.record(.open)
    // An invalid export-directory entry must not turn healthy journal reads into a failure.
    try Data("invalid export directory".utf8).write(to: directory.appendingPathComponent("exports"))
    let controller = AppController(runtime: runtime, preferencesStore: defaults)
    await controller.refreshVisible()
    XCTAssertEqual(controller.presentation.analytics?.lifetime.folds, 1)
    XCTAssertNil(controller.presentation.personalFailure)
    XCTAssertNil(controller.presentation.error)
  }

  func testExportUsesJournalAndResetRevokesPreparedShare() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let suite = "folding.export.test.\(UUID())"
    let defaults = UserDefaults(suiteName: suite)!
    defer {
      try? FileManager.default.removeItem(at: directory)
      defaults.removePersistentDomain(forName: suite)
    }
    let journal = try TrackingStore(directory: directory, installationID: UUID())
    let runtime = TrackingRuntime(journal: journal)
    let controller = AppController(runtime: runtime, preferencesStore: defaults)
    try await runtime.record(.open)
    try await controller.refresh()
    XCTAssertNotNil(controller.presentation.lastEventAt)
    let ticket = try await controller.actions.export!(.json)
    let file = try await controller.actions.exportURL!(ticket)
    let json = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
    XCTAssertEqual((json["events"] as? [[String: Any]])?.count, 1)
    controller.presentation.present(.export(ticket))
    try await controller.actions.reset!()
    XCTAssertNotEqual(controller.presentation.sheet, .export(ticket))
    XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    do {
      _ = try await controller.actions.exportURL!(ticket)
      XCTFail("Reset must revoke the prepared export")
    } catch {}
    await controller.actions.exportFinished!(ticket)
  }

  func testInitialHomeTimezoneSurvivesTravelWithoutEditingSettings() {
    let suite = "folding.timezone.test.\(UUID())"
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }
    var initial = FoldingPreferences()
    initial.homeTimezone = "Europe/London"
    let first = AppController(preferencesStore: defaults, initialPreferences: initial)
    XCTAssertEqual(first.presentation.preferences.homeTimezone, "Europe/London")
    var afterTravel = FoldingPreferences()
    afterTravel.homeTimezone = "Asia/Tokyo"
    let reopened = AppController(preferencesStore: defaults, initialPreferences: afterTravel)
    XCTAssertEqual(reopened.presentation.preferences.homeTimezone, "Europe/London")
  }

  func testAppearancePreferencesPersistWithoutAffectingHistory() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    let suite = "folding.preferences.test.\(UUID())"
    let defaults = UserDefaults(suiteName: suite)!
    defer {
      try? FileManager.default.removeItem(at: directory)
      defaults.removePersistentDomain(forName: suite)
    }
    let journal = try TrackingStore(directory: directory, installationID: UUID())
    let runtime = TrackingRuntime(journal: journal)
    let first = AppController(runtime: runtime, preferencesStore: defaults)
    var value = first.presentation.preferences
    value.appearance = .dark
    value.homeTimezone = "UTC"
    try await first.actions.savePreferences(value)
    let reopened = AppController(runtime: runtime, preferencesStore: defaults)
    XCTAssertEqual(reopened.presentation.preferences, value)
    let events = try await journal.retainedEvents()
    XCTAssertTrue(events.isEmpty)
  }
}
