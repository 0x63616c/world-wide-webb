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
