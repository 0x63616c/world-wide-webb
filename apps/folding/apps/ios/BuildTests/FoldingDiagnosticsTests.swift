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
