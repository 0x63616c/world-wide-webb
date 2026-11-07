import FoldingData
import FoldingDomain
import XCTest

@testable import Folding

@MainActor final class AppIntegrationTests: XCTestCase {
  func testRuntimeSetupReceiptsFeedRealScreensWithoutCountingTests() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(
      "folding-app-test-\(UUID())")
    let suite = "folding.tests.\(UUID())"
    let preferences = UserDefaults(suiteName: suite)!
    defer {
      try? FileManager.default.removeItem(at: directory)
      preferences.removePersistentDomain(forName: suite)
    }
    let journal = try TrackingStore(directory: directory, installationID: UUID())
    let runtime = TrackingRuntime(journal: journal)
    let controller = AppController(runtime: runtime, preferencesStore: preferences)
    try await controller.refresh()
    XCTAssertEqual(controller.presentation.setup?.step, .welcome)
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
    XCTAssertNotNil(controller.presentation.error)
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
    value.accent = .purple
    value.homeTimezone = "UTC"
    try await first.actions.savePreferences(value)
    let reopened = AppController(runtime: runtime, preferencesStore: defaults)
    XCTAssertEqual(reopened.presentation.preferences, value)
    let events = try await journal.retainedEvents()
    XCTAssertTrue(events.isEmpty)
  }
}
