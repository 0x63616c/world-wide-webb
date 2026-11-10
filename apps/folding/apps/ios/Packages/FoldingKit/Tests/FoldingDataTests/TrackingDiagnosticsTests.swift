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

@Test(arguments: [
  (TrackingDiagnosticEntry.Reason.busy, nil as Int?), (.busy, 503), (.rateLimited, nil),
  (.network, nil),
])
func foregroundRecoversOnlyProvenLegacyLocalBusyRetry(
  reason: TrackingDiagnosticEntry.Reason, detail: Int?
)
  async throws
{
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try TrackingStore(directory: directory, installationID: UUID())
  let epoch = UUID()
  try await store.setCompetitionEpoch(epoch)
  _ = try await store.record(
    Observation(
      generation: .initial, transition: .open,
      observedAtMS: 1000, timezoneID: "UTC", competitionEpochID: epoch), nowMS: 1000)
  let work = try #require(await store.leaseCompetitionUpload(nowMS: 1000))
  try await store.appendDiagnostic(
    TrackingDiagnosticEntry(atMS: 1001, event: .uploadDeferred, reason: reason, detail: detail))
  // Represents the old-client format, which had no durable retry reason.
  try await store.retryCompetitionUpload(work, atMS: 3_601_000)
  try await store.resumeLocalCompetitionUpload(nowMS: 2000)
  #expect(
    try await store.competitionUploadQueueState(nowMS: 2000)
      == (reason == .busy && detail == nil ? .ready : .retryWait))
  if reason == .busy && detail == nil {
    let recovered = try #require(await store.leaseCompetitionUpload(nowMS: 2000))
    #expect(recovered.operationID == work.operationID)
    #expect(recovered.body == work.body)
    #expect(recovered.attempts == 1)
  }
  #expect(try await store.summary().folds == 1)
}

@Test func diagnosticJSONPreservesTypedEventsAndRetryDecision() async throws {
  let snapshot = TrackingDiagnosticSnapshot(
    capturedAtMS: 2000, context: ["queue": "retry_wait"],
    events: [
      TrackingDiagnosticEntry(
        atMS: 1000, event: .uploadRetryScheduled, reason: .busy, attempt: 20, retryDelayMS: 2000)
    ])
  let data = Data(try snapshot.json().utf8)
  let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
  #expect(object["format_version"] as? Int == 1)
  let events = try #require(object["events"] as? [[String: Any]])
  #expect(events.first?["event"] as? String == "upload_retry_scheduled")
  #expect(events.first?["attempt"] as? Int == 20)
  #expect(events.first?["retry_delay_ms"] as? Int == 2000)
  #expect(events.first?["reason"] as? String == "busy")
}

@Test func localRetryMigrationAndManualRefreshPreserveBatchAndServerCooldowns() async throws {
  for reason in [
    TrackingDiagnosticEntry.Reason.network, .unauthorized, .unavailable, .rateLimited, .service,
  ] {
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let store = try TrackingStore(directory: directory, installationID: UUID())
    let epoch = UUID()
    try await store.setCompetitionEpoch(epoch)
    _ = try await store.record(
      Observation(
        generation: .initial, transition: .open,
        observedAtMS: 1000, timezoneID: "UTC", competitionEpochID: epoch), nowMS: 1000)
    let work = try #require(await store.leaseCompetitionUpload(nowMS: 1000))
    try await store.retryCompetitionUpload(work, atMS: 3_601_000, reason: reason)
    try await store.resumeLocalCompetitionUpload(nowMS: 2000)
    let local = [.network, .unauthorized, .unavailable].contains(reason)
    #expect(
      try await store.competitionUploadQueueState(nowMS: 62_000) == (local ? .ready : .retryWait))
    try await store.resumeLocalCompetitionUpload(nowMS: 3000, retryNow: true)
    #expect(
      try await store.competitionUploadQueueState(nowMS: 3000) == (local ? .ready : .retryWait))
    if local {
      let recovered = try #require(await store.leaseCompetitionUpload(nowMS: 3000))
      #expect(recovered.operationID == work.operationID)
      #expect(recovered.body == work.body)
      #expect(recovered.attempts == 1)
    }
    #expect(try await store.summary().folds == 1)
  }
}

@Test func exportedDiagnosticsIncludeUTCAndLocalTimesWithExplicitTimezoneOffset() throws {
  let snapshot = TrackingDiagnosticSnapshot(
    capturedAtMS: 1_794_279_184_511,
    events: [TrackingDiagnosticEntry(atMS: 1_794_278_957_624, event: .network)])
  let data = Data(try snapshot.json(timeZone: TimeZone(identifier: "America/Los_Angeles")!).utf8)
  let object = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
  #expect(object["captured_at_utc"] as? String == "2026-11-10T02:53:04.511Z")
  #expect(object["captured_at_local"] as? String == "2026-11-09T18:53:04.511-08:00")
  #expect(object["local_timezone"] as? String == "America/Los_Angeles")
  let events = try #require(object["events"] as? [[String: Any]])
  #expect(events[0]["at_utc"] as? String == "2026-11-10T02:49:17.624Z")
  #expect(events[0]["at_local"] as? String == "2026-11-09T18:49:17.624-08:00")
}
