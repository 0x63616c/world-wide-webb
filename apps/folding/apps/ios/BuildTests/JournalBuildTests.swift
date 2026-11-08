import FoldingData
import FoldingDomain
import Foundation
import XCTest

final class JournalBuildTests: XCTestCase {
  func testAppHostedJournalPersistsAcrossHandles() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let installation = UUID()
    let first = try TrackingStore(directory: directory, installationID: installation)
    let receipt = try await first.record(
      Observation(generation: .initial, transition: .open, observedAtMS: 1000, timezoneID: "UTC"),
      nowMS: 1000)
    let reopened = try TrackingStore(directory: directory, installationID: installation)
    let events = try await reopened.retainedEvents()
    XCTAssertEqual(events, [receipt.event])
    let summary = try await reopened.summary()
    XCTAssertEqual(summary.folds, 1)
  }
}
