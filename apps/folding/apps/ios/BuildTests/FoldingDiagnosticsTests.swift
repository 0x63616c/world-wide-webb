import FoldingData
import Foundation
import XCTest

@testable import Folding

private actor DiagnosticGate {
  private var continuation: CheckedContinuation<Void, Never>?
  private var released = false
  func wait() async {
    guard !released else { return }
    await withCheckedContinuation { continuation = $0 }
  }
  func release() {
    released = true
    continuation?.resume()
    continuation = nil
  }
}

@MainActor final class FoldingDiagnosticsTests: XCTestCase {
  func testSharedReportIsNamedJSONFileWithVersionBuildAndCapturedDate() throws {
    let snapshot = TrackingDiagnosticSnapshot(
      capturedAtMS: 1_800_000_000_000,
      context: ["marketing_version": "1.0.0", "build_number": "19"],
      events: [
        TrackingDiagnosticEntry(
          atMS: 1_800_000_000_000, event: .uploadRetryScheduled,
          reason: .busy, attempt: 3, retryDelayMS: 2000)
      ])
    let file = try DiagnosticReportExport(snapshot: snapshot).fileURL()
    defer { try? FileManager.default.removeItem(at: file.deletingLastPathComponent()) }
    XCTAssertTrue(file.lastPathComponent.hasPrefix("Folding-Diagnostics-v1.0.0-b19-"))
    XCTAssertEqual(file.pathExtension, "json")
    let object = try XCTUnwrap(
      JSONSerialization.jsonObject(with: Data(contentsOf: file)) as? [String: Any])
    XCTAssertEqual(object["format_version"] as? Int, 1)
    XCTAssertEqual((object["events"] as? [[String: Any]])?.first?["retry_delay_ms"] as? Int, 2000)
  }

  func testDiagnosticReportDoesNotWaitForBlockedUploader() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try TrackingStore(directory: directory, installationID: UUID())
    let gate = DiagnosticGate()
    let started = expectation(description: "upload started")
    let runtime = TrackingRuntime(
      journal: store,
      uploadOverride: {
        started.fulfill()
        await gate.wait()
      })
    let uploader = Task { await runtime.uploadCompetition() }
    await fulfillment(of: [started], timeout: 2)
    let reported = expectation(description: "diagnostics return while upload waits")
    let report = Task {
      let value = await runtime.diagnosticReport()
      reported.fulfill()
      return value
    }
    await fulfillment(of: [reported], timeout: 2)
    await gate.release()
    _ = await uploader.value
    let value = await report.value
    XCTAssertTrue(value.contains("Folding diagnostics"))
    XCTAssertTrue(value.contains("worker=preparing"))
  }

  func testDiagnosticsDiscardErrorDescriptionsAndDynamicURLIdentity() async throws {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try TrackingStore(directory: directory, installationID: UUID())
    let error = NSError(
      domain: "private.example", code: 123,
      userInfo: [NSLocalizedDescriptionKey: "Bearer synthetic-private-token alice@example.test"])
    await FoldingDiagnostics.record(store, .uploadRuntimeFailed, error: error)
    XCTAssertEqual(
      FoldingDiagnostics.route("/v1/participants/private-subject?token=secret"), .profile)
    let report = try await store.diagnosticReport(nowMS: TrackingRuntime.nowMS)
    XCTAssertTrue(report.contains("reason=unknown detail=123"))
    for secret in [
      "private.example", "synthetic-private-token", "alice@example.test", "private-subject",
      "token=",
    ] {
      XCTAssertFalse(report.contains(secret))
    }
  }
}
