import FoldingDomain
import Foundation
import Testing

@testable import FoldingData

private func deletionEvent(_ source: UUID, _ sequence: Int64, _ transition: Transition)
  -> TrackingEvent
{
  TrackingEvent(
    schemaVersion: 1, eventID: UUID(), deviceID: source, sequence: sequence,
    generation: .initial, observedAtMS: sequence * 1000, timezoneID: "UTC", transition: transition,
    isTest: false, competitionEpochID: nil)
}
private let deletionDay = PersonalDateRange(startMS: 0, endMS: 86_400_000)

@Test func deletingIncompleteEntryPreservesCausalityCacheAndRelaunch() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent("deletion-\(UUID())")
  defer { try? FileManager.default.removeItem(at: root) }
  let source = UUID()
  let events = [
    deletionEvent(source, 1, .open), deletionEvent(source, 2, .open),
    deletionEvent(source, 3, .close),
  ]
  let store = try TrackingStore(directory: root, installationID: source)
  for event in events { try await store.importEvent(event) }
  let before = try await store.compactAnalytics(
    homeTimezone: "UTC", asOfMS: 4000, range: deletionDay)
  #expect(before.lifetime.folds == 2)
  let session = try #require(
    try await store.summary().sessions.first { $0.completeness == .incomplete })
  let target = SessionDeletionTarget(session)
  let marker = try await store.deleteIncompleteEntry(target, participantID: nil, nowMS: 4000)
  #expect(marker.eventIDs == [events[0].eventID])
  #expect(try await store.deleteIncompleteEntry(target, participantID: nil, nowMS: 5000) == marker)
  #expect(try await store.summary().folds == 1)
  #expect(try await store.summary().incompleteSessions == 0)
  let cached = try await store.compactAnalytics(
    homeTimezone: "UTC", asOfMS: 6000, range: deletionDay)
  #expect(cached.lifetime.folds == 1)
  #expect(cached.days.reduce(0) { $0 + $1.folds } == 1)
  let reopened = try TrackingStore(directory: root, installationID: source)
  try await reopened.importEvent(events[0])
  #expect(try await reopened.summary().folds == 1)
  let snapshot = try await reopened.captureExportSnapshot()
  let export = try PersonalExport.document(
    events: snapshot.events, interruptions: snapshot.interruptions,
    generation: snapshot.generation, homeTimezone: "UTC", exportedAtMS: 7000,
    deletions: snapshot.deletions)
  #expect(!export.events.contains { $0.event.eventID == events[0].eventID })
  #expect(export.dailySummaries.reduce(0) { $0 + $1.folds } == 1)
}

@Test func deletionImportedBeforeEventsCannotResurrectInAppendCache() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent("deletion-\(UUID())")
  defer { try? FileManager.default.removeItem(at: root) }
  let source = UUID()
  let events = [
    deletionEvent(source, 1, .open), deletionEvent(source, 2, .open),
    deletionEvent(source, 3, .close),
  ]
  let summary = try TrackingReducer.reduce(events: events, generation: .initial)
  let target = SessionDeletionTarget(
    try #require(summary.sessions.first { $0.completeness == .incomplete }))
  let marker = TrackingDeletion(
    target: target, eventIDs: [events[0].eventID], createdAtMS: 4000, participantID: nil)
  let store = try TrackingStore(directory: root, installationID: source)
  try await store.importMirrorBatch(
    [.deletion(marker), .event(events[0])], storeID: "first", checkpoint: nil)
  let partial = try await store.compactAnalytics(
    homeTimezone: "UTC", asOfMS: 4000, range: deletionDay)
  #expect(partial.lifetime.folds == 0)
  #expect(partial.runningSessions.isEmpty)
  for event in events.dropFirst() { try await store.importEvent(event) }
  let complete = try await store.compactAnalytics(
    homeTimezone: "UTC", asOfMS: 5000, range: deletionDay)
  #expect(complete.lifetime.folds == 1)
  #expect(complete.lifetime.incompleteSessions == 0)
  #expect(try await store.entryDeletions() == [marker])
  let mirrored = try await store.leaseMirrorWork(nowMS: 6000)
  #expect(mirrored.isEmpty, "Import must not enqueue a new public or cloud write")
}

@Test func completeSessionsCannotBeDeletedAsIncomplete() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent("deletion-\(UUID())")
  defer { try? FileManager.default.removeItem(at: root) }
  let source = UUID()
  let store = try TrackingStore(directory: root, installationID: source)
  for event in [deletionEvent(source, 1, .open), deletionEvent(source, 2, .close)] {
    try await store.importEvent(event)
  }
  let session = try #require(try await store.summary().sessions.first)
  await #expect(throws: StoreError.invalidInput) {
    _ = try await store.deleteIncompleteEntry(
      SessionDeletionTarget(session), participantID: nil, nowMS: 3000)
  }
  #expect(try await store.summary().folds == 2)
}

@Test func sameTimestampNeighbourSessionKeepsItsOwnIdentity() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent("deletion-\(UUID())")
  defer { try? FileManager.default.removeItem(at: root) }
  let source = UUID()
  let first = deletionEvent(source, 1, .open)
  let second = TrackingEvent(
    schemaVersion: 1, eventID: UUID(), deviceID: source, sequence: 2,
    generation: .initial, observedAtMS: first.observedAtMS, timezoneID: "UTC", transition: .open,
    isTest: false, competitionEpochID: nil)
  let close = deletionEvent(source, 3, .close)
  let store = try TrackingStore(directory: root, installationID: source)
  for event in [first, second, close] { try await store.importEvent(event) }
  let target = SessionDeletionTarget(
    try #require(try await store.summary().sessions.first { $0.completeness == .incomplete }))
  _ = try await store.deleteIncompleteEntry(target, participantID: nil, nowMS: 4000)
  let result = try await store.summary()
  #expect(result.folds == 1)
  #expect(result.sessions.count == 1)
  #expect(result.sessions[0].openingEventID == second.eventID)
  let cached = try await store.sessionPage(homeTimezone: "UTC", range: deletionDay)
  #expect(cached.sessions.count == 1)
  #expect(cached.sessions[0].openingEventID == second.eventID)
}

@Test func offlineDeletionSurvivesMirrorAndAccountRetryUntilAcknowledged() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent("deletion-\(UUID())")
  defer { try? FileManager.default.removeItem(at: root) }
  let source = UUID()
  let epoch = UUID()
  let first = TrackingEvent(
    schemaVersion: 1, eventID: UUID(), deviceID: source, sequence: 1,
    generation: .initial, observedAtMS: 1000, timezoneID: "UTC", transition: .open,
    isTest: false, competitionEpochID: epoch)
  let store = try TrackingStore(directory: root, installationID: source)
  for event in [first, deletionEvent(source, 2, .open)] { try await store.importEvent(event) }
  let target = SessionDeletionTarget(
    try #require(try await store.summary().sessions.first { $0.completeness == .incomplete }))
  let marker = try await store.deleteIncompleteEntry(target, participantID: nil, nowMS: 3000)
  #expect(marker.epochIDs == [epoch])
  #expect(try await store.hasPendingEntryDeletions())
  let otherAccount = UUID().uuidString.lowercased()
  let owner = UUID().uuidString.lowercased()
  try await store.deferEntryDeletionForDifferentAccount(marker, participantID: otherAccount)
  #expect(try await store.pendingEntryDeletions(participantID: otherAccount).isEmpty)
  #expect(try await store.pendingEntryDeletions(participantID: owner) == [marker])
  let reopened = try TrackingStore(directory: root, installationID: source)
  #expect(try await reopened.pendingEntryDeletions(participantID: owner) == [marker])
  let mirror = try await PrivateCloudMirror(
    directory: root.appendingPathComponent("mirror"), containerIdentifier: nil)
  try await mirror.save(.deletion(marker))
  let imported = try await mirror.history(after: nil)
  #expect(imported.records == [.deletion(marker)])
  let receiver = try TrackingStore(
    directory: root.appendingPathComponent("receiver"), installationID: UUID())
  try await receiver.importMirrorBatch(imported.records, storeID: mirror.storeID, checkpoint: nil)
  #expect(try await receiver.pendingEntryDeletions(participantID: owner) == [marker])
  try await reopened.acknowledgeEntryDeletion(marker)
  #expect(try await reopened.pendingEntryDeletions(participantID: owner).isEmpty)
  #expect(try await reopened.hasPendingEntryDeletions() == false)
  _ = try await receiver.reset(nowMS: 4000)
  #expect(try await receiver.entryDeletions().isEmpty)
  #expect(try await receiver.hasPendingEntryDeletions() == false)
  try await mirror.close()
}
