import FoldingDomain
import Foundation
import Testing

@testable import FoldingData

private func analyticsStore() throws -> (TrackingStore, URL, UUID) {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent("analytics-\(UUID())")
  let device = UUID()
  return (try TrackingStore(directory: root, installationID: device), root, device)
}

private func fold(_ store: TrackingStore, _ transition: Transition, at ms: Int64) async throws
  -> TrackingEvent
{
  try await store.record(
    Observation(
      generation: store.currentGeneration(), transition: transition, observedAtMS: ms,
      timezoneID: "Europe/London"), nowMS: ms
  ).event
}

@Test func capturedFoldsQueueOnceAndSetupTestsAreExcluded() async throws {
  let (store, root, _) = try analyticsStore()
  defer { try? FileManager.default.removeItem(at: root) }
  _ = try await store.beginSetupTest(expected: .open, nowMS: 1)
  _ = try await fold(store, .open, at: 2)
  let close = try await fold(store, .close, at: 3)
  let batch = try #require(try await store.nextAnalyticsBatch())
  #expect(batch.events.map(\.kind) == ["fold_close"])
  #expect(batch.events[0].eventID == close.eventID.uuidString.lowercased())
  #expect(batch.events[0].backfill == false)
  #expect(batch.events[0].timezoneID == "Europe/London")
}

@Test func backfillRunsOnceWithoutDuplicatesAndAcknowledgeDrains() async throws {
  let (store, root, device) = try analyticsStore()
  defer { try? FileManager.default.removeItem(at: root) }
  let old = TrackingEvent(
    schemaVersion: 1, eventID: UUID(), deviceID: device, sequence: 1, generation: .initial,
    observedAtMS: 1000, timezoneID: "UTC", transition: .open, isTest: false,
    competitionEpochID: nil)
  let other = TrackingEvent(
    schemaVersion: 1, eventID: UUID(), deviceID: UUID(), sequence: 1, generation: .initial,
    observedAtMS: 1500, timezoneID: "UTC", transition: .open, isTest: false,
    competitionEpochID: nil)
  try await store.importEvent(old)
  try await store.importEvent(other)
  let live = try await fold(store, .close, at: 2000)
  try await store.enqueueAnalytics(
    kind: "tab_viewed", detail: "history", atMS: 2500, timezoneID: "UTC")
  let first = try #require(try await store.nextAnalyticsBatch())
  #expect(first.events.count == 3)
  #expect(
    Set(first.events.map(\.eventID))
      == Set([old.eventID, live.eventID].map { $0.uuidString.lowercased() }).union(
        [first.events.first { $0.kind == "tab_viewed" }!.eventID]))
  #expect(
    first.events.first { $0.eventID == old.eventID.uuidString.lowercased() }?.backfill == true)
  #expect(
    first.events.first { $0.eventID == live.eventID.uuidString.lowercased() }?.backfill == false)
  #expect(try await store.nextAnalyticsBatch() == first)
  try await store.acknowledgeAnalytics(throughSeq: first.throughSeq)
  #expect(try await store.nextAnalyticsBatch() == nil)
}

@Test func purgeForgetsQueueAndRebackfills() async throws {
  let (store, root, _) = try analyticsStore()
  defer { try? FileManager.default.removeItem(at: root) }
  let open = try await fold(store, .open, at: 1000)
  try await store.purgeAnalytics()
  try await store.enqueueAnalytics(kind: "app_opened", atMS: 1100, timezoneID: "UTC")
  try await store.purgeAnalytics()
  let batch = try #require(try await store.nextAnalyticsBatch())
  #expect(batch.events.map(\.eventID) == [open.eventID.uuidString.lowercased()])
  #expect(batch.events[0].backfill)
}

@Test func resetInterruptionAndDeletionQueueEventsAndResetKeepsQueue() async throws {
  let (store, root, _) = try analyticsStore()
  defer { try? FileManager.default.removeItem(at: root) }
  _ = try await store.nextAnalyticsBatch()  // Complete the empty backfill.
  let open = try await fold(store, .open, at: 1000)
  let marker = try await store.interruption(reason: .deviceRestart, nowMS: 1500)
  try await store.recordInterruption(marker)
  let session = try #require(
    try await store.summary().sessions.first { $0.completeness == .incomplete })
  let deletion = try await store.deleteIncompleteEntry(
    SessionDeletionTarget(session), participantID: nil, nowMS: 1600)
  let reset = try await store.reset(nowMS: 2000)
  let batch = try #require(try await store.nextAnalyticsBatch())
  #expect(batch.events.map(\.kind) == ["fold_open", "interruption", "entry_deleted", "reset"])
  #expect(batch.events[1].detail == "device_restart")
  #expect(batch.events[2].eventID == deletion.deletionID.uuidString.lowercased())
  #expect(batch.events[2].refs == [open.eventID.uuidString.lowercased()])
  #expect(batch.events[3].eventID == reset.resetID.uuidString.lowercased())
}

@Test func invalidDetailIsRejectedAndSanitized() async throws {
  let (store, root, _) = try analyticsStore()
  defer { try? FileManager.default.removeItem(at: root) }
  await #expect(throws: StoreError.invalidInput) {
    try await store.enqueueAnalytics(
      kind: "error", detail: "Bad Detail", atMS: 1, timezoneID: "UTC")
  }
  #expect(UsageAnalyticsEvent.detail("NSURLErrorDomain -1009") == "nsurlerrordomain__1009")
  let json = try JSONEncoder().encode(
    UsageAnalyticsEvent(eventID: UUID(), kind: "export", atMS: 1, timezoneID: "UTC"))
  #expect(String(decoding: json, as: UTF8.self).contains("\"detail\":null"))
}

@Test func uploadOutcomeAcknowledgesDropsAndBacksOff() {
  #expect(
    UsageAnalyticsUploadOutcome.decide(status: 202, retryAfterSeconds: nil, failures: 0)
      == .acknowledge)
  #expect(
    UsageAnalyticsUploadOutcome.decide(status: 400, retryAfterSeconds: nil, failures: 1) == .drop)
  #expect(
    UsageAnalyticsUploadOutcome.decide(status: 413, retryAfterSeconds: nil, failures: 1) == .drop)
  #expect(
    UsageAnalyticsUploadOutcome.decide(status: nil, retryAfterSeconds: nil, failures: 1)
      == .retry(afterSeconds: 30))
  #expect(
    UsageAnalyticsUploadOutcome.decide(status: 503, retryAfterSeconds: nil, failures: 3)
      == .retry(afterSeconds: 120))
  #expect(
    UsageAnalyticsUploadOutcome.decide(status: 429, retryAfterSeconds: 900, failures: 1)
      == .retry(afterSeconds: 900))
  #expect(
    UsageAnalyticsUploadOutcome.decide(status: 500, retryAfterSeconds: nil, failures: 40)
      == .retry(afterSeconds: 3600))
  #expect(
    UsageAnalyticsUploadOutcome.decide(status: 429, retryAfterSeconds: 99_999, failures: 1)
      == .retry(afterSeconds: 3600))
}
