import FoldingDomain
import Foundation
import Testing

@testable import FoldingData

@Test func diagnosticHistoryIsBoundedDurableAndDoesNotChangeTracking() async throws {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let installation = UUID()
  let store = try TrackingStore(directory: directory, installationID: installation)
  let receipt = try await store.record(
    Observation(generation: .initial, transition: .open, observedAtMS: 1000, timezoneID: "UTC"),
    nowMS: 1000)
  let revision = try await store.journalRevisionToken()
  for index in 0..<140 {
    try await store.appendDiagnostic(
      TrackingDiagnosticEntry(
        atMS: Int64(10_000 + index), event: .network, reason: .service, status: 503, detail: index))
  }
  #expect(try await store.journalRevisionToken() == revision)
  let reopened = try TrackingStore(directory: directory, installationID: installation)
  let report = try await reopened.diagnosticReport(nowMS: 20_000)
  #expect(report.contains("Recent activity (128)"))
  #expect(!report.contains("detail=0\n"))
  #expect(report.contains("detail=139"))
  #expect(!report.contains(receipt.event.eventID.uuidString.lowercased()))
  #expect(!report.contains(installation.uuidString.lowercased()))
  #expect(try await reopened.summary().folds == 1)
  try await reopened.clearDiagnostics()
  #expect(try await reopened.diagnosticReport(nowMS: 20_000).contains("Recent activity (0)"))
  #expect(try await reopened.summary().folds == 1)
  try await reopened.appendDiagnostic(TrackingDiagnosticEntry(atMS: 21_000, event: .foreground))
  let generation = try await reopened.reset(nowMS: 22_000)
  #expect(try await reopened.diagnosticReport(nowMS: 22_000).contains("Recent activity (0)"))
  try await reopened.appendDiagnostic(TrackingDiagnosticEntry(atMS: 23_000, event: .foreground))
  try await reopened.importReset(generation, createdAtMS: 22_000)
  #expect(try await reopened.diagnosticReport(nowMS: 23_000).contains("Recent activity (1)"))
}

@Test func diagnosticReportShowsQueueOwnershipWithoutPrintingUntrustedPauseTextOrEventIDs()
  async throws
{
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try TrackingStore(directory: directory, installationID: UUID())
  let epoch = UUID()
  try await store.setCompetitionEpoch(epoch)
  let receipt = try await store.record(
    Observation(
      generation: .initial, transition: .open, observedAtMS: 1000, timezoneID: "UTC",
      competitionEpochID: epoch), nowMS: 1000)
  let work = try #require(await store.leaseCompetitionUpload(nowMS: 1000))
  #expect(try await store.competitionUploadQueueState(nowMS: 1001) == .leased)
  try await store.stopCompetitionUpload(work, reason: "Bearer synthetic-private-token")
  let report = try await store.diagnosticReport(nowMS: 2000)
  #expect(report.contains("queue=paused"))
  #expect(report.contains("pause_reason=service"))
  #expect(report.contains("pending_uploads=1"))
  for forbidden in [
    "synthetic-private-token", "Bearer", epoch.uuidString.lowercased(),
    receipt.event.eventID.uuidString.lowercased(), work.operationID.uuidString.lowercased(),
  ] {
    #expect(!report.contains(forbidden))
  }
  // A support read cannot steal or acknowledge this worker's lease.
  try await store.acknowledgeCompetitionUpload(work, dispositions: ["accepted"])
  #expect(try await store.pendingCompetitionEventCount() == 0)
}
