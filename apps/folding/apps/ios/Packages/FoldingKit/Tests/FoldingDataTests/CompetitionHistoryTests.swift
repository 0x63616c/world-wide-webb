import FoldingDomain
import Foundation
import Testing

@testable import FoldingData

private func historyDirectory() throws -> URL {
  let path = FileManager.default.temporaryDirectory.appendingPathComponent(
    "folding-history-\(UUID())")
  try FileManager.default.createDirectory(at: path, withIntermediateDirectories: true)
  return path
}

@Test func existingHistoryJoinsCompetitionWithoutChangingOriginalRecords() async throws {
  let directory = try historyDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let installation = UUID()
  let epoch = UUID()
  let store = try TrackingStore(directory: directory, installationID: installation)
  for index in 0..<41 {
    _ = try await store.record(
      Observation(
        id: UUID(), generation: .initial,
        transition: index.isMultiple(of: 2) ? .open : .close, observedAtMS: Int64(index + 1),
        timezoneID: "UTC", competitionEpochID: nil), nowMS: Int64(index + 1))
  }
  try await store.setCompetitionEpoch(epoch)
  // Older services have no import boundary, so the new path stays inactive.
  #expect(try await store.leaseCompetitionUpload(nowMS: 1000) == nil)
  try await store.configureCompetitionHistory(beforeJoinedAtMS: 100)
  for index in 0..<18 {
    _ = try await store.record(
      Observation(
        id: UUID(), generation: .initial,
        transition: index.isMultiple(of: 2) ? .close : .open, observedAtMS: Int64(101 + index),
        timezoneID: "UTC", competitionEpochID: epoch), nowMS: Int64(101 + index))
  }
  let history = try #require(await store.leaseCompetitionUpload(nowMS: 1001))
  #expect(history.isHistory == true)
  #expect(history.eventIDs.count == 41)
  let json = try #require(JSONSerialization.jsonObject(with: history.body) as? [String: Any])
  let events = try #require(json["events"] as? [[String: Any]])
  #expect(events.allSatisfy { $0["competition_epoch_id"] is NSNull })
  #expect(try await store.summary().folds == 59)
  try await store.retryCompetitionUpload(history, atMS: 90_000)
  let reopened = try TrackingStore(directory: directory, installationID: installation)
  let retry = try #require(await reopened.leaseCompetitionUpload(nowMS: 90_000))
  #expect(retry.operationID == history.operationID && retry.body == history.body)
  try await reopened.acknowledgeCompetitionUpload(
    retry, dispositions: Array(repeating: "accepted", count: 41))
  let live = try #require(await reopened.leaseCompetitionUpload(nowMS: 151_000))
  #expect(live.isHistory != true && live.eventIDs.count == 18)
  try await reopened.acknowledgeCompetitionUpload(
    live, dispositions: Array(repeating: "accepted", count: 18))
  #expect(try await reopened.leaseCompetitionUpload(nowMS: 212_000) == nil)
  #expect(try await reopened.retainedEvents().filter { $0.competitionEpochID == nil }.count == 41)
}

@Test func historyImportIsBoundedAndFencedByResetAndServiceRollback() async throws {
  let directory = try historyDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let store = try TrackingStore(directory: directory, installationID: UUID())
  for index in 1...300 {
    _ = try await store.record(
      Observation(
        id: UUID(), generation: .initial,
        transition: index.isMultiple(of: 2) ? .close : .open, observedAtMS: Int64(index),
        timezoneID: "UTC", competitionEpochID: nil), nowMS: Int64(index))
  }
  try await store.setCompetitionEpoch(UUID())
  try await store.configureCompetitionHistory(beforeJoinedAtMS: 1000)
  let first = try #require(await store.leaseCompetitionUpload(nowMS: 1001))
  #expect(first.eventIDs.count == 256)
  try await store.acknowledgeCompetitionUpload(
    first, dispositions: Array(repeating: "accepted", count: 256))
  let second = try #require(await store.leaseCompetitionUpload(nowMS: 61_001))
  #expect(second.eventIDs.count == 44)
  try await store.configureCompetitionHistory(beforeJoinedAtMS: nil)
  try await store.acknowledgeCompetitionUpload(
    second, dispositions: Array(repeating: "accepted", count: 44))
  #expect(try await store.leaseCompetitionUpload(nowMS: 122_001) == nil)
  try await store.configureCompetitionHistory(beforeJoinedAtMS: 1000)
  let resumed = try #require(await store.leaseCompetitionUpload(nowMS: 183_001))
  #expect(resumed.eventIDs.count == 256)
  _ = try await store.reset(nowMS: 183_002)
  try await store.acknowledgeCompetitionUpload(
    resumed, dispositions: Array(repeating: "accepted", count: 256))
  let reset = try #require(await store.leaseCompetitionUpload(nowMS: 183_003))
  #expect(reset.isReset && reset.eventIDs.isEmpty)
  #expect(try await store.summary().folds == 0)
}

@Test func historyImportRespectsSelectedPhoneWatermarksAndLateMirrorArrivals() async throws {
  let directory = try historyDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let installation = UUID()
  let remote = UUID()
  let store = try TrackingStore(directory: directory, installationID: installation)
  func event(_ sequence: Int64) -> TrackingEvent {
    TrackingEvent(
      schemaVersion: 1, eventID: UUID(), deviceID: remote, sequence: sequence,
      generation: .initial, observedAtMS: sequence * 10, timezoneID: "UTC",
      transition: sequence.isMultiple(of: 2) ? .close : .open, isTest: false,
      competitionEpochID: nil)
  }
  let known = [event(1), event(2)]
  for item in known { try await store.importEvent(item) }
  _ = try await store.record(
    Observation(
      id: UUID(), generation: .initial, transition: .open,
      observedAtMS: 50, timezoneID: "UTC", competitionEpochID: nil), nowMS: 50)
  _ = try await store.selectTrackingDevice(installation, nowMS: 60)
  try await store.importEvent(event(3))
  try await store.setCompetitionEpoch(UUID())
  try await store.configureCompetitionHistory(beforeJoinedAtMS: 100)
  let work = try #require(await store.leaseCompetitionUpload(nowMS: 101))
  #expect(work.eventIDs.count == 3)
  #expect(Set(known.map(\.eventID)).isSubset(of: Set(work.eventIDs)))
  try await store.acknowledgeCompetitionUpload(
    work, dispositions: Array(repeating: "accepted", count: 3))
  // A newly mirrored pre-join event from the selected source is discovered without resetting a cursor.
  let late = TrackingEvent(
    schemaVersion: 1, eventID: UUID(), deviceID: installation, sequence: 2,
    generation: .initial, observedAtMS: 70, timezoneID: "UTC", transition: .close,
    isTest: false, competitionEpochID: nil)
  try await store.importEvent(late)
  let next = try #require(await store.leaseCompetitionUpload(nowMS: 61_101))
  #expect(next.eventIDs == [late.eventID])
}

@Test func deletingAnImportedIncompleteEntryAlsoQueuesItsPublicTombstone() async throws {
  let directory = try historyDirectory()
  defer { try? FileManager.default.removeItem(at: directory) }
  let source = UUID()
  let epoch = UUID()
  let store = try TrackingStore(directory: directory, installationID: source)
  for sequence: Int64 in [1, 2, 3] {
    try await store.importEvent(
      TrackingEvent(
        schemaVersion: 1, eventID: UUID(), deviceID: source,
        sequence: sequence, generation: .initial, observedAtMS: sequence * 10,
        timezoneID: "UTC", transition: sequence == 3 ? .close : .open,
        isTest: false, competitionEpochID: nil))
  }
  try await store.setCompetitionEpoch(epoch)
  try await store.configureCompetitionHistory(beforeJoinedAtMS: 100)
  let inFlight = try #require(await store.leaseCompetitionUpload(nowMS: 101))
  let incomplete = try #require(
    try await store.summary().sessions.first { $0.completeness == .incomplete })
  let deletion = try await store.deleteIncompleteEntry(
    SessionDeletionTarget(incomplete), participantID: nil, nowMS: 102)
  #expect(deletion.epochIDs == [epoch])
  #expect(try await store.pendingEntryDeletions(participantID: UUID().uuidString).count == 1)
  try await store.acknowledgeCompetitionUpload(
    inFlight, dispositions: Array(repeating: "accepted", count: 3))
  #expect(try await store.summary().folds == 1)
  try await store.setCompetitionEpoch(nil)
  try await store.setCompetitionEpoch(UUID())
  try await store.configureCompetitionHistory(beforeJoinedAtMS: 100)
  let remaining = try #require(await store.leaseCompetitionUpload(nowMS: 61_101))
  #expect(Set(remaining.eventIDs).isDisjoint(with: Set(deletion.eventIDs)))
}
